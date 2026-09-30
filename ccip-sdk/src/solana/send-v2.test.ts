import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type AccountMeta,
  type Connection,
  type VersionedTransaction,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SendTransactionError,
} from '@solana/web3.js'
import BN from 'bn.js'

import {
  CCIPArgumentInvalidError,
  CCIPSolanaRouterConfigNotFoundError,
  CCIPSolanaV2LaneUnavailableError,
} from '../errors/index.ts'
import '../evm/index.ts' // registers the EVM family, the destination of these messages
import {
  type ExtraArgs,
  type GenericExtraArgsV3,
  EVMExtraArgsV2Tag,
  GenericExtraArgsV3Tag,
} from '../extra-args.ts'
import { networkInfo } from '../networks.ts'
import { type AnyMessage, CCIPVersion } from '../types.ts'
import { sighash, sizedCoder } from './coder.ts'
import { IDL as CCIP_ROUTER_V2_IDL } from './idl/2.0.0/CCIP_ROUTER.ts'
import {
  type ResolveAccountsResponse,
  CCIP_SEND_V2_DISCRIMINATOR,
  GET_FEE_V2_DISCRIMINATOR,
  MAX_HEAP_FRAME_BYTES,
  RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
} from './resolution.ts'
import {
  type DestChainV2Observation,
  OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR,
  getFeeV2,
  observeDestChainV2,
  selectSendLane,
  toGenericExtraArgsV3,
} from './send-v2.ts'
import { SolanaChain } from './index.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const randomKey = () => Keypair.generate().publicKey
const routerV2Coder = sizedCoder(CCIP_ROUTER_V2_IDL)

const SEPOLIA = networkInfo('ethereum-testnet-sepolia').chainSelector
const STAGING_ROUTER = new PublicKey('CcipP6NhMw34e7hNJXmNytvzmSYrwQ1TcFgfQAxJhNqm')
const STAGING_SEND_LOOKUP_TABLE = '61yGrR9h9YU7wq5b3LiYSdePou1iAg5giaVMBig8fK6m'
const RECEIVER = '0x9eC0e4A4c411493773E01e2ABF4D42395788846b'

// `observe_dest_chain_v2` return data from the CCIP 2.0 staging router on Solana devnet, for its
// Sepolia lane (2026-09-28): pins the IDL layout against the program's own output
const STAGING_SEPOLIA_OBSERVATION = Buffer.from(
  'AQAVAAAAY2NpcC1yb3V0ZXIgMi4wLjAtZGV2Adka2clPukHe+C8AAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAqrP9/xjtfoHo/uM627bDkPLOn1AD0u3u1en80sNL1vwAAAAAz2m0emq6bEJQWd2XuYl2ULtp755IijYPP8xb+H7mG4QUAAAA66XXlFlITlQ70VYHpiHs4pspypkyAAAAlgAAAEANAwA=',
  'base64',
)

const LANE_DEFAULTS_V3: GenericExtraArgsV3 = {
  gasLimit: 0n,
  finality: 'finalized',
  ccvs: [],
  ccvArgs: [],
  executor: '',
  executorArgs: '0x',
  tokenReceiver: '',
  tokenArgs: '0x',
}

// Independent Borsh writer for the resolution response, as in resolution.test.ts
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const vec = (items: Buffer[]) => Buffer.concat([u32(items.length), ...items])
function encodeResponse(r: ResolveAccountsResponse): Buffer {
  return Buffer.concat([
    vec(r.askAgainWith.map((key) => key.toBuffer())),
    vec(
      r.accountsToSave.map((meta) =>
        Buffer.concat([meta.pubkey.toBuffer(), Buffer.from([+meta.isSigner, +meta.isWritable])]),
      ),
    ),
    vec(r.lookupTablesToSave.map((key) => key.toBuffer())),
    Buffer.from([0]),
    Buffer.concat([u32(r.metadata.length), r.metadata]),
  ])
}
function encodeFeeResult(amount: bigint, token: PublicKey): Buffer {
  const le = Buffer.alloc(8)
  le.writeBigUInt64LE(amount)
  return Buffer.concat([le, token.toBuffer()])
}

/** The last instruction of a simulated tx, with every program the tx calls. */
function lastInstruction(tx: VersionedTransaction) {
  const msg = tx.message
  const keys = msg.staticAccountKeys
  const ix = msg.compiledInstructions.at(-1)!
  return {
    programId: keys[ix.programIdIndex]!,
    keys: ix.accountKeyIndexes.map((i) => keys[i]!),
    data: Buffer.from(ix.data),
    programIds: msg.compiledInstructions.map(({ programIdIndex }) => keys[programIdIndex]!),
  }
}

type SimulationResult = Buffer | { err: unknown; logs?: string[] }

/**
 * A connection whose simulations of `router`'s instructions are answered per discriminator:
 * `observe_dest_chain_v2` with `observation`, resolution with a single terminal stage saving
 * `saved`, and `get_fee_v2` with a `fee` quote.
 */
function routerConnection(
  router: PublicKey,
  {
    observation = STAGING_SEPOLIA_OBSERVATION as SimulationResult,
    saved = [{ pubkey: randomKey(), isSigner: false, isWritable: false }] as AccountMeta[],
    lookupTablesToSave = [] as PublicKey[],
    fee = 12_345n,
    destChainAccount = undefined as Buffer | undefined,
    other = { err: { InstructionError: [1, { Custom: 9999 }] } } as SimulationResult,
  } = {},
) {
  const simulateTransaction = mock.fn(async (tx: VersionedTransaction) => {
    const { data } = lastInstruction(tx)
    const discriminator = data.subarray(0, 8)
    let result: SimulationResult = other
    if (discriminator.equals(OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR)) result = observation
    else if (discriminator.equals(RESOLVE_ACCOUNTS_START_DISCRIMINATOR))
      result = encodeResponse({
        askAgainWith: [],
        accountsToSave: saved,
        lookupTablesToSave,
        nextIxDiscriminator: null,
        metadata: Buffer.from([7]),
      })
    else if (discriminator.equals(GET_FEE_V2_DISCRIMINATOR))
      result = encodeFeeResult(fee, PublicKey.default)
    if (!Buffer.isBuffer(result)) return { value: { logs: [], unitsConsumed: 1, ...result } }
    return {
      value: {
        err: null,
        logs: [],
        unitsConsumed: 1000,
        returnData: { programId: router.toBase58(), data: [result.toString('base64'), 'base64'] },
      },
    }
  })
  const getAddressLookupTable = mock.fn(async (key: PublicKey) => ({
    value: { key, state: { addresses: [] } },
  }))
  const getAccountInfoAndContext = mock.fn(async () => ({
    context: { slot: 1 },
    value: destChainAccount && {
      data: destChainAccount,
      owner: router,
      lamports: 1,
      executable: false,
    },
  }))
  const connection = {
    simulateTransaction,
    getAddressLookupTable,
    getAccountInfoAndContext,
    getAccountInfo: mock.fn(async () => null),
    getSignaturesForAddress: mock.fn(async () => []),
  } as unknown as Connection
  return { connection, simulateTransaction, getAddressLookupTable, getAccountInfoAndContext }
}

/** Staging's Sepolia observation, with its allowlist enabled. */
function allowlistedObservation(): Buffer {
  const observation = routerV2Coder.types.decode<DestChainV2Observation>(
    'RouterDestChainV2Observation',
    STAGING_SEPOLIA_OBSERVATION,
  )
  return routerV2Coder.types.encode('RouterDestChainV2Observation', {
    ...observation,
    allowListEnabled: true,
    allowedSendersCount: 1,
  })
}

/** A `destChainCcipV2` account whose allowlist holds `allowedSenders`. */
function destChainAccount(allowedSenders: PublicKey[]): Promise<Buffer> {
  return routerV2Coder.accounts.encode('destChainCcipV2', {
    bump: 255,
    version: 1,
    chainSelector: new BN(SEPOLIA.toString()),
    state: {
      messageNumber: new BN(1),
      messageNumberToRestore: new BN(0),
      restoreOnAction: { none: {} },
    },
    config: {
      laneCodeVersion: { default: {} },
      addressBytesLength: 20,
      tokenReceiverAllowed: false,
      allowedSenders,
      allowListEnabled: true,
      defaultCcvs: [],
      laneMandatedCcvs: [],
      defaultExecutor: randomKey(),
      offramp: Buffer.alloc(20, 1),
      messageNetworkFee: 0,
      tokenTransferNetworkFee: 0,
      baseExecutionGasCost: 0,
      maxFeePerMessage: 0,
    },
  })
}

const simulationError = (custom: number): SimulationResult => ({
  err: { InstructionError: [1, { Custom: custom }] },
})

describe('observe_dest_chain_v2', () => {
  it('pins the upstream discriminator', () => {
    assert.deepEqual(
      [...OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR],
      [10, 114, 200, 19, 108, 52, 129, 170],
    )
  })

  it("decodes a live lane's observation, simulating the instruction over its PDA", async () => {
    const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER)
    const lane = await observeDestChainV2(
      { connection, logger: silent },
      { router: STAGING_ROUTER, destChainSelector: SEPOLIA },
    )

    assert.ok('observation' in lane)
    const { observation } = lane
    assert.equal(observation.typeVersion, 'ccip-router 2.0.0-dev')
    assert.equal(BigInt(observation.chainSelector.toString()), SEPOLIA)
    assert.equal(observation.allowListEnabled, false)
    assert.deepEqual(
      observation.defaultCcvs.map((ccv) => ccv.toBase58()),
      ['CVMVgsQYG7NHp7NY2XWCNkXjxAw5E14dnFHNu8e2Gt3M'],
    )
    assert.equal(
      observation.defaultExecutor.toBase58(),
      'Exet1XoEHNwruTsyjsB2v9JrgBQm8EPVzncJ3gkAP14w',
    )
    assert.equal(observation.offramp.length, 20, 'an EVM offramp address, raw')
    assert.equal(observation.baseExecutionGasCost, 200_000)

    const ix = lastInstruction(simulateTransaction.mock.calls[0]!.arguments[0])
    const selectorLe = Buffer.alloc(8)
    selectorLe.writeBigUInt64LE(SEPOLIA)
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('dest_chain_state_v2'), selectorLe],
      STAGING_ROUTER,
    )
    assert.ok(ix.programId.equals(STAGING_ROUTER))
    assert.deepEqual(ix.keys, [pda])
    assert.deepEqual(ix.data, Buffer.concat([OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR, selectorLe]))
  })

  it('reads a missing dest_chain_state_v2 as a lane not configured for 2.0', async () => {
    const { connection } = routerConnection(STAGING_ROUTER, { observation: simulationError(3012) })
    assert.deepEqual(
      await observeDestChainV2(
        { connection, logger: silent },
        { router: STAGING_ROUTER, destChainSelector: SEPOLIA },
      ),
      { reason: 'lane-not-configured' },
    )
  })

  it('reads an unknown instruction as a router without 2.0 support yet', async () => {
    const { connection } = routerConnection(STAGING_ROUTER, { observation: simulationError(101) })
    assert.deepEqual(
      await observeDestChainV2(
        { connection, logger: silent },
        { router: STAGING_ROUTER, destChainSelector: SEPOLIA },
      ),
      { reason: 'router-without-v2-support' },
    )
  })

  it('rethrows other program errors and RPC failures', async () => {
    const { connection } = routerConnection(STAGING_ROUTER, { observation: simulationError(2006) })
    await assert.rejects(
      observeDestChainV2(
        { connection, logger: silent },
        { router: STAGING_ROUTER, destChainSelector: SEPOLIA },
      ),
      SendTransactionError,
    )

    const rpcError = new Error('429 Too Many Requests')
    const failing = {
      simulateTransaction: mock.fn(async () => {
        throw rpcError
      }),
    } as unknown as Connection
    await assert.rejects(
      observeDestChainV2(
        { connection: failing, logger: silent },
        { router: STAGING_ROUTER, destChainSelector: SEPOLIA },
      ),
      (err: unknown) => err === rpcError,
    )
  })
})

describe('toGenericExtraArgsV3', () => {
  it('keeps GenericExtraArgsV3 as-is', () => {
    const v3: GenericExtraArgsV3 = { ...LANE_DEFAULTS_V3, gasLimit: 1n, finality: 'safe' }
    assert.equal(toGenericExtraArgsV3(v3), v3)
  })

  it('carries only the gasLimit of legacy EVM args over, dropping ordering', () => {
    for (const args of [
      { gasLimit: 200_000n },
      { gasLimit: 200_000n, allowOutOfOrderExecution: true },
      { gasLimit: 200_000n, allowOutOfOrderExecution: false },
    ]) {
      assert.deepEqual(toGenericExtraArgsV3(args), { ...LANE_DEFAULTS_V3, gasLimit: 200_000n })
    }
  })

  it('only converts gas limits that fit the uint32 V3 field', () => {
    assert.equal(toGenericExtraArgsV3({ gasLimit: 0xffff_ffffn })?.gasLimit, 0xffff_ffffn)
    assert.equal(toGenericExtraArgsV3({ gasLimit: 0x1_0000_0000n }), undefined)
    assert.equal(toGenericExtraArgsV3({ gasLimit: -1n }), undefined)
  })

  it('converts Sui args only when nothing but the gas limit is set', () => {
    const zero = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const sui = { gasLimit: 1n, allowOutOfOrderExecution: true, tokenReceiver: zero }
    assert.deepEqual(toGenericExtraArgsV3({ ...sui, receiverObjectIds: [] }), {
      ...LANE_DEFAULTS_V3,
      gasLimit: 1n,
    })
    assert.equal(
      toGenericExtraArgsV3({ ...sui, receiverObjectIds: [`0x${'11'.repeat(32)}`] }),
      undefined,
    )
    assert.equal(
      toGenericExtraArgsV3({
        ...sui,
        tokenReceiver: `0x${'22'.repeat(32)}`,
        receiverObjectIds: [],
      }),
      undefined,
    )
  })

  it("doesn't convert other families' args", () => {
    const svm: ExtraArgs = {
      computeUnits: 1n,
      accountIsWritableBitmap: 0n,
      allowOutOfOrderExecution: true,
      tokenReceiver: '',
      accounts: [],
    }
    assert.equal(toGenericExtraArgsV3(svm), undefined)
  })
})

describe('selectSendLane', () => {
  const message = (extraArgs: ExtraArgs): AnyMessage => ({
    receiver: RECEIVER,
    data: '0x',
    extraArgs,
  })
  const select = (connection: Connection, extraArgs: ExtraArgs, sender?: PublicKey) =>
    selectSendLane(
      { connection, logger: silent },
      { router: STAGING_ROUTER, destChainSelector: SEPOLIA, message: message(extraArgs), sender },
    )

  it('prefers 2.0 for legacy args, converting them', async () => {
    const { connection } = routerConnection(STAGING_ROUTER)
    const lane = await select(connection, { gasLimit: 5n, allowOutOfOrderExecution: true })
    assert.equal(lane.version, CCIPVersion.V2_0)
    assert.deepEqual(lane.message.extraArgs, { ...LANE_DEFAULTS_V3, gasLimit: 5n })
    assert.equal(lane.message.receiver, RECEIVER)
  })

  it('sends GenericExtraArgsV3 over 2.0 unchanged', async () => {
    const { connection } = routerConnection(STAGING_ROUTER)
    const v3 = { ...LANE_DEFAULTS_V3, finality: 5 }
    const lane = await select(connection, v3)
    assert.equal(lane.version, CCIPVersion.V2_0)
    assert.equal(lane.message.extraArgs, v3)
  })

  for (const [custom, reason] of [
    [3012, 'lane-not-configured'],
    [101, 'router-without-v2-support'],
  ] as const) {
    it(`falls back to 1.6 for legacy args when ${reason}`, async () => {
      const { connection } = routerConnection(STAGING_ROUTER, {
        observation: simulationError(custom),
      })
      const legacy = { gasLimit: 5n, allowOutOfOrderExecution: true }
      const lane = await select(connection, legacy)
      assert.equal(lane.version, CCIPVersion.V1_6)
      assert.equal(lane.message.extraArgs, legacy, 'the legacy args should be kept')
    })

    it(`throws for GenericExtraArgsV3 when ${reason}`, async () => {
      const { connection } = routerConnection(STAGING_ROUTER, {
        observation: simulationError(custom),
      })
      await assert.rejects(
        select(connection, LANE_DEFAULTS_V3),
        (err: unknown) =>
          err instanceof CCIPSolanaV2LaneUnavailableError &&
          err.code === 'SOLANA_V2_LANE_UNAVAILABLE' &&
          err.context.reason === reason &&
          err.context.router === STAGING_ROUTER.toBase58() &&
          err.context.destChainSelector === SEPOLIA,
      )
    })
  }

  it('sends args without a V3 equivalent over 1.6, without observing the lane', async () => {
    const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER)
    const lane = await select(connection, { gasLimit: 0x1_0000_0000n })
    assert.equal(lane.version, CCIPVersion.V1_6)
    assert.equal(simulateTransaction.mock.calls.length, 0)
  })

  describe('with the lane allowlist enabled', () => {
    const allowed = randomKey()

    it('uses 2.0 for an allowlisted sender', async () => {
      const { connection } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
        destChainAccount: await destChainAccount([randomKey(), allowed]),
      })
      const lane = await select(connection, LANE_DEFAULTS_V3, allowed)
      assert.equal(lane.version, CCIPVersion.V2_0)
    })

    it('falls back to 1.6 for another sender with legacy args, and throws with V3', async () => {
      const { connection } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
        destChainAccount: await destChainAccount([allowed]),
      })
      const sender = randomKey()
      const lane = await select(connection, { gasLimit: 5n }, sender)
      assert.equal(lane.version, CCIPVersion.V1_6)
      await assert.rejects(
        select(connection, LANE_DEFAULTS_V3, sender),
        (err: unknown) =>
          err instanceof CCIPSolanaV2LaneUnavailableError &&
          err.context.reason === 'sender-not-allowed' &&
          err.context.sender === sender.toBase58() &&
          err.message.includes(sender.toBase58()),
      )
    })

    it('requires the sender, which decides the entrypoint', async () => {
      const { connection, getAccountInfoAndContext } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
      })
      for (const extraArgs of [LANE_DEFAULTS_V3, { gasLimit: 5n }]) {
        await assert.rejects(
          select(connection, extraArgs),
          (err: unknown) =>
            err instanceof CCIPArgumentInvalidError &&
            err.context.argument === 'sender' &&
            err.context.router === STAGING_ROUTER.toBase58() &&
            err.context.destChainSelector === SEPOLIA,
        )
      }
      assert.equal(getAccountInfoAndContext.mock.calls.length, 0)
    })

    it("doesn't require it for args without a V3 equivalent, which can only go over 1.6", async () => {
      const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
      })
      const lane = await select(connection, { gasLimit: 0x1_0000_0000n })
      assert.equal(lane.version, CCIPVersion.V1_6)
      assert.equal(simulateTransaction.mock.calls.length, 0)
    })
  })
})

describe('getFeeV2', () => {
  const message: AnyMessage = { receiver: RECEIVER, data: '0x1337', extraArgs: LANE_DEFAULTS_V3 }

  it('simulates the resolved get_fee_v2 on a heap frame, with the fixed send lookup table', async () => {
    const resolvedLut = randomKey()
    const { connection, simulateTransaction, getAddressLookupTable } = routerConnection(
      STAGING_ROUTER,
      { fee: 42n, lookupTablesToSave: [resolvedLut] },
    )
    const sender = randomKey()

    const fee = await getFeeV2(
      { connection, logger: silent },
      { router: STAGING_ROUTER, destChainSelector: SEPOLIA, message, sender },
    )

    assert.equal(fee, 42n)
    const [start, quote] = simulateTransaction.mock.calls.map((call) =>
      lastInstruction(call.arguments[0]),
    )
    // resolution runs as the sender, then the quote runs with a heap frame
    assert.deepEqual(start!.data.subarray(8, 40), sender.toBuffer())
    assert.deepEqual(quote!.data.subarray(0, 8), GET_FEE_V2_DISCRIMINATOR)
    assert.deepEqual(
      quote!.programIds.map((id) => id.toBase58()),
      [
        ComputeBudgetProgram.programId.toBase58(),
        ComputeBudgetProgram.programId.toBase58(),
        STAGING_ROUTER.toBase58(),
      ],
    )
    assert.deepEqual(
      getAddressLookupTable.mock.calls.map((call) => call.arguments[0].toBase58()),
      [resolvedLut.toBase58(), STAGING_SEND_LOOKUP_TABLE],
    )
  })

  it("doesn't add a lookup table for routers without a known one", async () => {
    const router = randomKey()
    const { connection, getAddressLookupTable } = routerConnection(router)
    await getFeeV2({ connection, logger: silent }, { router, destChainSelector: SEPOLIA, message })
    assert.equal(getAddressLookupTable.mock.calls.length, 0)
  })
})

describe('SolanaChain send lane routing', () => {
  const chain = (connection: Connection) =>
    new SolanaChain(connection, networkInfo('solana-devnet'), { apiClient: null, logger: silent })
  const sender = randomKey()
  const opts = (extraArgs: Record<string, unknown>, fee?: bigint) => ({
    router: STAGING_ROUTER.toBase58(),
    destChainSelector: SEPOLIA,
    message: { receiver: RECEIVER, data: '0x1337', extraArgs, ...(fee != null && { fee }) },
    sender: sender.toBase58(),
  })

  it('builds a ccip_send_v2 with V3 extraArgs from legacy ones, on a heap frame', async () => {
    const saved: AccountMeta[] = [
      { pubkey: randomKey(), isSigner: false, isWritable: false },
      { pubkey: sender, isSigner: true, isWritable: true },
    ]
    const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER, {
      saved,
      fee: 77n,
    })

    const unsigned = await chain(connection).generateUnsignedSendMessage(
      opts({ gasLimit: 200_000n, allowOutOfOrderExecution: true }),
    )

    assert.equal(unsigned.mainIndex, 1)
    assert.equal(unsigned.instructions.length, 2, 'native fee and no tokens: no approvals')
    const [heapFrame, send] = unsigned.instructions
    assert.ok(heapFrame!.programId.equals(ComputeBudgetProgram.programId))
    assert.deepEqual(
      heapFrame!.data,
      ComputeBudgetProgram.requestHeapFrame({ bytes: MAX_HEAP_FRAME_BYTES }).data,
    )
    assert.ok(send!.programId.equals(STAGING_ROUTER))
    assert.deepEqual(send!.data.subarray(0, 8), CCIP_SEND_V2_DISCRIMINATOR)
    assert.deepEqual(send!.keys, saved)
    // the message went out with V3 extraArgs, carrying the gas limit over
    const { message } = routerV2Coder.types.decode<{ message: { extraArgs: Buffer } }>(
      'CcipSendV2Params',
      send!.data.subarray(8),
    )
    assert.equal(`0x${message.extraArgs.subarray(0, 4).toString('hex')}`, GenericExtraArgsV3Tag)
    assert.equal(message.extraArgs.readUInt32LE(4), 200_000)
    assert.deepEqual(
      unsigned.lookupTables?.map(({ key }) => key.toBase58()),
      [STAGING_SEND_LOOKUP_TABLE],
    )
    // one observation, then get_fee_v2 (start + quote) and ccip_send_v2 (start) as the sender
    const discriminators = simulateTransaction.mock.calls.map((call) =>
      lastInstruction(call.arguments[0]).data.subarray(0, 8),
    )
    assert.deepEqual(discriminators, [
      OBSERVE_DEST_CHAIN_V2_DISCRIMINATOR,
      RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
      GET_FEE_V2_DISCRIMINATOR,
      RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
    ])
  })

  it('uses a given fee instead of quoting', async () => {
    const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER)
    await chain(connection).generateUnsignedSendMessage(opts({ gasLimit: 0n }, 1n))
    const discriminators = simulateTransaction.mock.calls.map((call) =>
      lastInstruction(call.arguments[0]).data.subarray(0, 8),
    )
    assert.ok(!discriminators.some((d) => d.equals(GET_FEE_V2_DISCRIMINATOR)))
  })

  it('quotes over 2.0 through getFee', async () => {
    const { connection } = routerConnection(STAGING_ROUTER, { fee: 99n })
    const { sender: _, ...feeOpts } = opts({ gasLimit: 0n })
    assert.equal(await chain(connection).getFee(feeOpts), 99n)
  })

  describe('on a lane with its allowlist enabled', () => {
    it('quotes over 2.0 for an allowlisted sender, resolving get_fee_v2 as it', async () => {
      const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
        destChainAccount: await destChainAccount([sender]),
        fee: 99n,
      })
      assert.equal(await chain(connection).getFee(opts({ gasLimit: 0n })), 99n)
      const start = simulateTransaction.mock.calls
        .map((call) => lastInstruction(call.arguments[0]).data)
        .find((data) => data.subarray(0, 8).equals(RESOLVE_ACCOUNTS_START_DISCRIMINATOR))
      assert.deepEqual(start?.subarray(8, 40), sender.toBuffer())
    })

    it('quotes over 1.6 for another sender, as sendMessage would send it', async () => {
      const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
        destChainAccount: await destChainAccount([randomKey()]),
      })
      // the 1.6 quote reads the router config, which this mock doesn't have
      await assert.rejects(
        chain(connection).getFee(opts({ gasLimit: 0n })),
        CCIPSolanaRouterConfigNotFoundError,
      )
      assert.equal(simulateTransaction.mock.calls.length, 1, 'only the observation was simulated')
    })

    it('rejects a quote without the sender', async () => {
      const { connection } = routerConnection(STAGING_ROUTER, {
        observation: allowlistedObservation(),
      })
      const { sender: _, ...feeOpts } = opts({ gasLimit: 0n })
      await assert.rejects(chain(connection).getFee(feeOpts), CCIPArgumentInvalidError)
    })
  })

  it('falls back to the 1.6 ccip_send derivation when the lane has no 2.0', async () => {
    const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER, {
      observation: simulationError(3012),
    })
    // the 1.6 derivation is answered with a program error, which surfaces as-is
    await assert.rejects(
      chain(connection).generateUnsignedSendMessage(opts({ gasLimit: 0n }, 1n)),
      SendTransactionError,
    )
    const derive = lastInstruction(simulateTransaction.mock.calls[1]!.arguments[0])
    assert.deepEqual(derive.data.subarray(0, 8), sighash('global', 'derive_accounts_ccip_send'))
    // the 1.6 path keeps the legacy (EVMExtraArgsV2) args
    assert.ok(derive.data.includes(Buffer.from(EVMExtraArgsV2Tag.slice(2), 'hex')))
  })

  it('rejects GenericExtraArgsV3 on a router without 2.0 support, before quoting', async () => {
    const { connection, simulateTransaction } = routerConnection(STAGING_ROUTER, {
      observation: simulationError(101),
    })
    await assert.rejects(
      chain(connection).generateUnsignedSendMessage(opts({ finality: 'safe' })),
      (err: unknown) =>
        err instanceof CCIPSolanaV2LaneUnavailableError &&
        err.context.reason === 'router-without-v2-support' &&
        err.context.sender === sender.toBase58(),
    )
    assert.equal(simulateTransaction.mock.calls.length, 1, 'only the observation was simulated')
  })
})
