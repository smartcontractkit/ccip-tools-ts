/**
 * Tests for the Solana CCIP 1.6 router entrypoints (`get_fee`, `ccip_send`) and the chain-level
 * lane routing that selects them over the 2.0 ones.
 */
import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type AccountMeta,
  type Connection,
  type VersionedTransaction,
  Keypair,
  PublicKey,
} from '@solana/web3.js'
import BN from 'bn.js'

import {
  CCIPSolanaLookupTableNotFoundError,
  CCIPSolanaRouterConfigNotFoundError,
} from '../errors/index.ts'
import '../evm/index.ts' // registers the EVM family, the destination of these messages
import { networkInfo } from '../networks.ts'
import type { AnyMessage } from '../types.ts'
import { toLeArray } from '../utils.ts'
import { sighash, sizedCoder } from './coder.ts'
import { IDL as CCIP_ROUTER_IDL } from './idl/1.6.0/CCIP_ROUTER.ts'
import { generateUnsignedCcipSend, getFee } from './send.ts'
import { SolanaChain } from './index.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const randomKey = () => Keypair.generate().publicKey
const DEST = networkInfo('ethereum-testnet-sepolia').chainSelector
const RECEIVER = '0x9eC0e4A4c411493773E01e2ABF4D42395788846b'
const routerCoder = sizedCoder(CCIP_ROUTER_IDL)

const message = (overrides: Partial<AnyMessage> = {}): AnyMessage => ({
  receiver: RECEIVER,
  data: '0x1234',
  extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
  ...overrides,
})

/** The last instruction of a simulated tx, with the keys the program receives. */
function lastInstruction(tx: VersionedTransaction) {
  const msg = tx.message
  const keys = msg.staticAccountKeys
  const ix = msg.compiledInstructions.at(-1)!
  return {
    programId: keys[ix.programIdIndex]!,
    keys: ix.accountKeyIndexes.map((i) => keys[i]!),
    data: Buffer.from(ix.data),
  }
}

function encodeFeeResult(amount: bigint) {
  return routerCoder.types.encode('GetFeeResult', {
    amount: new BN(amount.toString()),
    juels: new BN(0),
    token: PublicKey.default,
  })
}

function encodeDeriveResponse(
  accountsToSave: AccountMeta[],
  {
    nextStage = '',
    currentStage = 'Start',
    lookupTables = [] as PublicKey[],
  }: { nextStage?: string; currentStage?: string; lookupTables?: PublicKey[] } = {},
) {
  return routerCoder.types.encode('DeriveAccountsResponse', {
    askAgainWith: [],
    accountsToSave,
    lookUpTablesToSave: lookupTables,
    currentStage,
    nextStage,
  })
}

type DeriveStep = { accounts: AccountMeta[]; currentStage?: string; lookupTables?: PublicKey[] }

/**
 * A connection answering the 1.6 router's account reads and simulations: a config account with
 * `feeQuoter`/`linkTokenMint`, a `get_fee` quote, and one or more derivation stages.
 */
function routerConnection(
  router: PublicKey,
  {
    feeQuoter = randomKey(),
    linkTokenMint = randomKey(),
    fee = 123n,
    derive = [] as DeriveStep[],
    config = true,
  } = {},
) {
  const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], router)[0]
  const configData = routerCoder.accounts.encode('config', {
    version: 1,
    defaultCodeVersion: { default: {} },
    svmChainSelector: new BN(1),
    owner: randomKey(),
    proposedOwner: PublicKey.default,
    feeQuoter,
    rmnRemote: randomKey(),
    linkTokenMint,
    feeAggregator: randomKey(),
  })
  let stage = 0
  const simulateTransaction = mock.fn(async (tx: VersionedTransaction) => {
    const { data } = lastInstruction(tx)
    const discriminator = data.subarray(0, 8)
    let returnData: Buffer
    if (discriminator.equals(sighash('global', 'getFee'))) {
      returnData = encodeFeeResult(fee)
    } else if (discriminator.equals(sighash('global', 'deriveAccountsCcipSend'))) {
      const step = derive[Math.min(stage++, derive.length - 1)] ?? { accounts: [] }
      returnData = encodeDeriveResponse(step.accounts, {
        currentStage: step.currentStage,
        lookupTables: step.lookupTables,
        nextStage: stage < derive.length ? `Stage${stage}` : '',
      })
    } else {
      throw new Error(`unexpected simulation of ${discriminator.toString('hex')}`)
    }
    return {
      value: {
        err: null,
        logs: [],
        unitsConsumed: 1000,
        returnData: {
          programId: router.toBase58(),
          data: [returnData.toString('base64'), 'base64'],
        },
      },
    }
  })
  const getAccountInfo = mock.fn(async (key: PublicKey) =>
    config && key.equals(configPda)
      ? { owner: router, data: await configData, lamports: 1, executable: false }
      : null,
  )
  const lookup = new Map<PublicKey, PublicKey>()
  const getAddressLookupTable = mock.fn(async (key: PublicKey) => {
    const found = lookup.get(key)
    return { value: found ? { key, state: { addresses: [] } } : null }
  })
  const connection = {
    simulateTransaction,
    getAccountInfo,
    getAddressLookupTable,
    getSignaturesForAddress: mock.fn(async () => []),
  } as unknown as Connection
  return { connection, simulateTransaction, getAccountInfo, getAddressLookupTable, configPda }
}

describe('Solana 1.6 getFee', () => {
  it('quotes through the router config, fee quoter dest chain and billing PDAs', async () => {
    const router = randomKey()
    const feeQuoter = randomKey()
    const linkTokenMint = randomKey()
    const { connection, simulateTransaction, configPda } = routerConnection(router, {
      feeQuoter,
      linkTokenMint,
      fee: 42n,
    })

    const fee = await getFee({ connection, logger: silent }, router.toBase58(), DEST, message())

    assert.equal(fee, 42n)
    assert.equal(simulateTransaction.mock.calls.length, 1)
    const quote = lastInstruction(simulateTransaction.mock.calls[0]!.arguments[0])
    assert.ok(quote.programId.equals(router))
    assert.deepEqual(quote.data.subarray(0, 8), sighash('global', 'getFee'))

    const [destChainState] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain_state'), toLeArray(DEST, 8)],
      router,
    )
    const [feeQuoterConfig] = PublicKey.findProgramAddressSync([Buffer.from('config')], feeQuoter)
    const [feeQuoterDestChain] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain'), toLeArray(DEST, 8)],
      feeQuoter,
    )
    const [nativeBilling] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('fee_billing_token_config'),
        new PublicKey('So11111111111111111111111111111111111111112').toBuffer(),
      ],
      feeQuoter,
    )
    const [linkBilling] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee_billing_token_config'), linkTokenMint.toBuffer()],
      feeQuoter,
    )
    assert.deepEqual(
      quote.keys.map((key) => key.toBase58()),
      [
        configPda,
        destChainState,
        feeQuoter,
        feeQuoterConfig,
        feeQuoterDestChain,
        nativeBilling,
        linkBilling,
      ].map((key) => key.toBase58()),
    )
  })

  it('adds one billing and one per-chain account per transferred token', async () => {
    const router = randomKey()
    const feeQuoter = randomKey()
    const { connection, simulateTransaction } = routerConnection(router, { feeQuoter })
    const tokens = [randomKey(), randomKey()]

    await getFee(
      { connection, logger: silent },
      router.toBase58(),
      DEST,
      message({ tokenAmounts: tokens.map((token) => ({ token: token.toBase58(), amount: 1n })) }),
    )

    const quote = lastInstruction(simulateTransaction.mock.calls[0]!.arguments[0])
    // 7 fixed accounts, then billing and per-chain accounts, per token, in that order
    assert.equal(quote.keys.length, 7 + 2 * tokens.length)
    assert.deepEqual(
      quote.keys.slice(7).map((key) => key.toBase58()),
      tokens
        .map((token) =>
          PublicKey.findProgramAddressSync(
            [Buffer.from('fee_billing_token_config'), token.toBuffer()],
            feeQuoter,
          )[0]!.toBase58(),
        )
        .concat(
          tokens.map((token) =>
            PublicKey.findProgramAddressSync(
              [Buffer.from('per_chain_per_token_config'), toLeArray(DEST, 8), token.toBuffer()],
              feeQuoter,
            )[0]!.toBase58(),
          ),
        ),
    )
  })

  it('throws when the router has no config account', async () => {
    const { connection } = routerConnection(randomKey(), { config: false })

    await assert.rejects(
      getFee({ connection, logger: silent }, randomKey().toBase58(), DEST, message()),
      CCIPSolanaRouterConfigNotFoundError,
    )
  })
})

describe('Solana 1.6 generateUnsignedCcipSend', () => {
  it('builds ccip_send against the 18 derived accounts', async () => {
    const router = randomKey()
    const sender = randomKey()
    const accounts: AccountMeta[] = Array.from({ length: 18 }, () => ({
      pubkey: randomKey(),
      isSigner: false,
      isWritable: true,
    }))
    const { connection } = routerConnection(router, { derive: [{ accounts }] })

    const unsigned = await generateUnsignedCcipSend(
      { connection, logger: silent },
      sender,
      router,
      DEST,
      { ...message(), fee: 1n },
    )

    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    const [send] = unsigned.instructions
    assert.ok(send!.programId.equals(router))
    assert.deepEqual(send!.data.subarray(0, 8), sighash('global', 'ccipSend'))
    assert.deepEqual(
      send!.keys.map((key) => key.pubkey.toBase58()),
      accounts.map(({ pubkey }) => pubkey.toBase58()),
    )
  })

  it('keeps the token indexes from a multi-stage derivation and returns its lookup tables', async () => {
    const router = randomKey()
    const sender = randomKey()
    const fixed: AccountMeta[] = Array.from({ length: 18 }, () => ({
      pubkey: randomKey(),
      isSigner: false,
      isWritable: false,
    }))
    const tokenAccounts: AccountMeta[] = Array.from({ length: 2 }, () => ({
      pubkey: randomKey(),
      isSigner: false,
      isWritable: true,
    }))
    const lookupTable = randomKey()
    // A token transfer derivation starts its own token index; the static token stage comes second.
    const { connection, getAddressLookupTable } = routerConnection(router, {
      derive: [
        { accounts: fixed, lookupTables: [lookupTable] },
        { accounts: tokenAccounts, currentStage: 'TokenTransferStaticAccounts/0/0' },
      ],
    })
    // resolution of the lookup table must succeed for the next simulation to run
    getAddressLookupTable.mock.mockImplementation(async (key: PublicKey) => ({
      value: { key, state: { addresses: [] } },
    }))

    const unsigned = await generateUnsignedCcipSend(
      { connection, logger: silent },
      sender,
      router,
      DEST,
      { ...message(), fee: 1n },
    )

    assert.deepEqual(
      unsigned.lookupTables?.map(({ key }) => key.toBase58()),
      [lookupTable.toBase58()],
    )
    const [send] = unsigned.instructions
    const decoded = routerCoder.instruction.decode(send!.data) as unknown as {
      data: { tokenIndexes: Buffer }
    }
    assert.deepEqual([...decoded.data.tokenIndexes], [0])
    assert.deepEqual(
      send!.keys.slice(18).map((key) => key.pubkey.toBase58()),
      tokenAccounts.map(({ pubkey }) => pubkey.toBase58()),
    )
  })

  it('throws when a derivation lookup table cannot be resolved', async () => {
    const router = randomKey()
    const missing = randomKey()
    const { connection } = routerConnection(router, {
      derive: [{ accounts: [], lookupTables: [missing] }],
    })

    await assert.rejects(
      generateUnsignedCcipSend({ connection, logger: silent }, randomKey(), router, DEST, {
        ...message(),
        fee: 1n,
      }),
      CCIPSolanaLookupTableNotFoundError,
    )
  })
})

describe('SolanaChain 1.6 lane routing', () => {
  const chain = (connection: Connection) =>
    new SolanaChain(connection, networkInfo('solana-devnet'), { apiClient: null, logger: silent })
  // Above u32, so the extraArgs have no GenericExtraArgsV3 equivalent and 1.6 is chosen without
  // observing the router's 2.0 lane.
  const v16Message = () => message({ extraArgs: { gasLimit: 0x1_0000_0000n } })

  it('quotes over 1.6 without probing the 2.0 lane', async () => {
    const router = randomKey()
    const { connection, simulateTransaction } = routerConnection(router, { fee: 99n })

    const fee = await chain(connection).getFee({
      router: router.toBase58(),
      destChainSelector: DEST,
      message: v16Message(),
    })

    assert.equal(fee, 99n)
    assert.equal(simulateTransaction.mock.calls.length, 1, 'only the quote was simulated')
    assert.deepEqual(
      lastInstruction(simulateTransaction.mock.calls[0]!.arguments[0]).data.subarray(0, 8),
      sighash('global', 'getFee'),
    )
  })

  it('sends over 1.6 and keeps the given fee', async () => {
    const router = randomKey()
    const sender = randomKey()
    const accounts: AccountMeta[] = Array.from({ length: 18 }, () => ({
      pubkey: randomKey(),
      isSigner: false,
      isWritable: false,
    }))
    const { connection } = routerConnection(router, { derive: [{ accounts }] })

    const unsigned = await chain(connection).generateUnsignedSendMessage({
      sender: sender.toBase58(),
      router: router.toBase58(),
      destChainSelector: DEST,
      message: { ...v16Message(), fee: 5n },
    })

    assert.deepEqual(unsigned.instructions[0]!.data.subarray(0, 8), sighash('global', 'ccipSend'))
  })
})
