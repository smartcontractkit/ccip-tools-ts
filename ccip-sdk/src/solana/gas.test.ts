import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  type Connection,
  type VersionedTransaction,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import { concat, getBytes, hexlify, randomBytes, toBeArray, zeroPadValue } from 'ethers'

import '../index.ts' // registers the chain families
import { CCIPSolanaReceiverRegistryInvalidError } from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import { CCIPVersion } from '../types.ts'
import { parseTypeAndVersion } from '../utils.ts'
import { sighash } from './coder.ts'
import { SVMTokenReceiverUsage, encodeSVMExecutorArgsV1 } from './extra-args.ts'
import { estimateExecComputeUnits, getReceiverVersion } from './gas.ts'
import { SolanaChain } from './index.ts'

const randomPublicKey = () => Keypair.generate().publicKey.toBase58()

describe('estimateExecComputeUnits', () => {
  it('simulates a standard Solana ccip_receive callback', async () => {
    const simulateTransaction = mock.fn(async () => ({
      value: {
        err: null,
        logs: [],
        unitsConsumed: 123_456,
      },
    }))
    const connection = { simulateTransaction } as unknown as Connection

    const estimated = await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      message: {
        sourceChainSelector: 1n,
        messageId: hexlify(randomBytes(32)),
        receiver: randomPublicKey(),
        sender: '0x0000000000000000000000000000000000000001',
        data: '0x1234',
        accounts: [randomPublicKey(), randomPublicKey()],
        accountIsWritableBitmap: 2n,
        destTokenAmounts: [{ token: randomPublicKey(), amount: 100n }],
      },
    })

    assert.equal(estimated, 123_456)
    assert.equal(simulateTransaction.mock.calls.length, 1)
  })

  it('returns zero without simulation when there is no receiver callback', async () => {
    const simulateTransaction = mock.fn()
    const connection = { simulateTransaction } as unknown as Connection

    const estimated = await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      message: {
        sourceChainSelector: 1n,
        messageId: hexlify(randomBytes(32)),
        receiver: PublicKey.default.toBase58(),
      },
    })

    assert.equal(estimated, 0)
    assert.equal(simulateTransaction.mock.calls.length, 0)
  })
})

// little-endian fixed-width integer, as borsh encodes it
const le = (value: bigint | number, bytes: number) =>
  getBytes(zeroPadValue(toBeArray(BigInt(value)), bytes)).reverse()
const u32 = (value: number) => le(value, 4)

/** Mock connection whose simulateTransaction captures the receiver callback's instruction data */
function captureReceiveIx(extra: Partial<Record<keyof Connection, unknown>> = {}) {
  const simulated: VersionedTransaction[] = []
  const simulateTransaction = mock.fn(async (tx: VersionedTransaction) => {
    simulated.push(tx)
    return { value: { err: null, logs: [], unitsConsumed: 1 } }
  })
  const connection = { simulateTransaction, ...extra } as unknown as Connection
  const receiveIx = () => {
    const message = simulated.at(-1)!.message
    const { compiledInstructions, staticAccountKeys } = message
    // [setComputeUnitLimit, ...token setup, ccip_receive(_v2)]; the receiver callback is last
    const ix = compiledInstructions.at(-1)!
    return {
      programId: staticAccountKeys[ix.programIdIndex]!.toBase58(),
      data: hexlify(ix.data),
      accounts: ix.accountKeyIndexes.map((i) => ({
        pubkey: staticAccountKeys[i]!.toBase58(),
        isWritable: message.isAccountWritable(i),
      })),
    }
  }
  const instructions = () => {
    const { compiledInstructions, staticAccountKeys } = simulated.at(-1)!.message
    return compiledInstructions.map((ix) => ({
      programId: staticAccountKeys[ix.programIdIndex]!.toBase58(),
      keys: ix.accountKeyIndexes.map((i) => staticAccountKeys[i]!.toBase58()),
    }))
  }
  return { connection, receiveIx, instructions }
}

describe('estimateExecComputeUnits receiver interface', () => {
  const messageId = hexlify(randomBytes(32))
  const sender = '0x00000000000000000000000000000000000000aa'
  const mint = randomPublicKey()
  const tokenReceiver = randomPublicKey()
  const base = {
    sourceChainSelector: 16015286601757825753n,
    messageId,
    sender,
    data: '0x1234',
  }

  it('encodes v1 ccip_receive with a tokenAmounts Vec', async () => {
    const { connection, receiveIx } = captureReceiveIx()
    const receiver = randomPublicKey()
    await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      message: {
        ...base,
        receiver,
        tokenReceiver,
        destTokenAmounts: [{ token: mint, amount: 7n }],
      },
      logger: { debug: () => {} } as unknown as Console,
    })
    const ix = receiveIx()
    assert.equal(ix.programId, receiver)
    assert.equal(
      ix.data,
      hexlify(
        concat([
          sighash('global', 'ccip_receive'),
          messageId,
          le(base.sourceChainSelector, 8),
          u32(20),
          zeroPadValue(sender, 20),
          u32(2),
          '0x1234',
          u32(1), // Vec<SVMTokenAmount> length
          new PublicKey(mint).toBytes(),
          le(7, 8),
        ]),
      ),
    )
  })

  it('encodes v2 ccip_receive_v2 with an Option<TokenTransfer>', async () => {
    const { connection, receiveIx } = captureReceiveIx()
    const receiver = randomPublicKey()
    await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      receiverVersion: 2,
      tokenReceiverUsage: SVMTokenReceiverUsage.UseAsIs,
      message: {
        ...base,
        receiver,
        tokenReceiver,
        destTokenAmounts: [{ token: mint, amount: 7n }],
      },
      logger: { debug: () => {} } as unknown as Console,
    })
    const ix = receiveIx()
    assert.equal(ix.programId, receiver)
    assert.equal(
      ix.data,
      hexlify(
        concat([
          // `ccip_receive_v2` discriminator, from the example-ccip-receiver-v2 IDL
          new Uint8Array([193, 155, 158, 156, 161, 212, 122, 116]),
          messageId,
          le(base.sourceChainSelector, 8),
          u32(20),
          zeroPadValue(sender, 20),
          u32(2),
          '0x1234',
          '0x01', // Some(TokenTransfer)
          new PublicKey(mint).toBytes(),
          le(7, 8),
          new PublicKey(tokenReceiver).toBytes(),
          '0x02', // UseAsIs
        ]),
      ),
    )
  })

  it('encodes v2 ccip_receive_v2 without a token transfer', async () => {
    const { connection, receiveIx } = captureReceiveIx()
    await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      receiverVersion: 2,
      message: { ...base, receiver: randomPublicKey() },
    })
    assert.equal(
      receiveIx().data,
      hexlify(
        concat([
          new Uint8Array([193, 155, 158, 156, 161, 212, 122, 116]),
          messageId,
          le(base.sourceChainSelector, 8),
          u32(20),
          zeroPadValue(sender, 20),
          u32(2),
          '0x1234',
          '0x00', // None
        ]),
      ),
    )
  })
})

describe('getReceiverVersion', () => {
  const router = randomPublicKey()
  const receiver = randomPublicKey()
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('receiver_registry'), new PublicKey(receiver).toBuffer()],
    new PublicKey(router),
  )
  // `ReceiverRegistry` account discriminator, from the ccip-router IDL
  const registryData = (version: number, receiverVersion: number) =>
    Buffer.from(
      getBytes(
        concat([
          new Uint8Array([143, 191, 40, 192, 11, 255, 173, 235]),
          new Uint8Array([254, version]), // bump, schema version
          new PublicKey(receiver).toBytes(),
          new Uint8Array([receiverVersion]),
        ]),
      ),
    )
  const connectionWith = (info: { owner: PublicKey; data: Buffer } | null) => {
    const getAccountInfo = mock.fn(
      async (_address: PublicKey) => info && { ...info, executable: false, lamports: 1_000_000 },
    )
    return { connection: { getAccountInfo }, getAccountInfo }
  }

  it('reads the registry PDA and returns its receiver version', async () => {
    const { connection, getAccountInfo } = connectionWith({
      owner: new PublicKey(router),
      data: registryData(1, 2),
    })
    assert.equal(await getReceiverVersion(connection, router, receiver), 2)
    assert.equal(getAccountInfo.mock.calls[0]!.arguments[0].toBase58(), registryPda.toBase58())

    const v1 = connectionWith({ owner: new PublicKey(router), data: registryData(1, 1) })
    assert.equal(await getReceiverVersion(v1.connection, router, receiver), 1)
  })

  it('treats an absent or System-owned registry as v1', async () => {
    assert.equal(await getReceiverVersion(connectionWith(null).connection, router, receiver), 1)
    // a pre-funded PDA stays System-owned, and can't flip the version
    const prefunded = connectionWith({ owner: SystemProgram.programId, data: Buffer.alloc(0) })
    assert.equal(await getReceiverVersion(prefunded.connection, router, receiver), 1)
  })

  it('rejects an invalid registry account', async () => {
    const wrongDiscriminator = registryData(1, 2)
    wrongDiscriminator.writeUInt8(wrongDiscriminator.readUInt8(0) ^ 0xff, 0)
    for (const data of [wrongDiscriminator, registryData(2, 2)]) {
      const { connection } = connectionWith({ owner: new PublicKey(router), data })
      await assert.rejects(
        getReceiverVersion(connection, router, receiver),
        CCIPSolanaReceiverRegistryInvalidError,
      )
    }
  })
})

describe('SolanaChain.estimateReceiveExecution receiver interface', () => {
  const router = randomPublicKey()
  const offRamp = randomPublicKey()
  const receiver = randomPublicKey()
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('receiver_registry'), new PublicKey(receiver).toBuffer()],
    new PublicKey(router),
  )
  const v2Registry = {
    owner: new PublicKey(router),
    executable: false,
    lamports: 1_000_000,
    data: Buffer.from(
      getBytes(
        concat([
          new Uint8Array([143, 191, 40, 192, 11, 255, 173, 235, 254, 1]),
          new PublicKey(receiver).toBytes(),
          new Uint8Array([2]),
        ]),
      ),
    ),
  }

  const evmSender = '0x00000000000000000000000000000000000000aa'

  /** the receiver callback simulated for a message from an EVM sender to a v2 receiver */
  const simulatedCallback = async (offRampVersion: string) => {
    const { connection, receiveIx } = captureReceiveIx({
      getAccountInfo: async (key: PublicKey) => (key.equals(registryPda) ? v2Registry : null),
      getSignaturesForAddress: async () => [],
    })
    const solana = new SolanaChain(connection, networkInfo('solana-devnet'), {
      apiClient: null,
      logger: { debug: () => {} } as unknown as Console,
    })
    Object.assign(solana, {
      typeAndVersion: async () => [
        'ccip-offramp',
        offRampVersion,
        `ccip-offramp ${offRampVersion}`,
      ],
      getRouterForOffRamp: async () => router,
    })
    await solana.estimateReceiveExecution({
      offRamp,
      message: {
        sourceChainSelector: networkInfo('ethereum-testnet-sepolia').chainSelector,
        receiver,
        sender: evmSender,
        data: '0x1234',
      },
    })
    const data = getBytes(receiveIx().data)
    // discriminator, then messageId (32), sourceChainSelector (8), sender (u32 length + bytes)
    const senderLength = new DataView(data.buffer, data.byteOffset + 48, 4).getUint32(0, true)
    return {
      discriminator: data.subarray(0, 8),
      sender: hexlify(data.subarray(52, 52 + senderLength)),
    }
  }

  it('calls ccip_receive_v2 on a receiver registered as v2, through a 2.0 OffRamp', async () => {
    const { discriminator, sender } = await simulatedCallback(CCIPVersion.V2_0)
    assert.deepEqual(discriminator, new Uint8Array([193, 155, 158, 156, 161, 212, 122, 116]))
    // as the EVM OnRamp 2.0 encodes it: abi.encode(address)
    assert.equal(sender, zeroPadValue(evmSender, 32))
  })

  it('calls ccip_receive through a 1.6 OffRamp, whatever the registry says', async () => {
    const { discriminator, sender } = await simulatedCallback(CCIPVersion.V1_6)
    assert.deepEqual(discriminator, new Uint8Array(sighash('global', 'ccip_receive')))
    assert.equal(sender, evmSender)
  })
})

const quiet = { debug: () => {}, warn: () => {} } as unknown as Console

function mintAccount(authority: PublicKey) {
  const data = Buffer.alloc(MINT_SIZE)
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: authority,
      supply: 0n,
      decimals: 9,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  )
  return { owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1_000_000, data }
}

describe('estimateExecComputeUnits token setup, per token delivery mode', () => {
  const mint = Keypair.generate().publicKey
  const tokenReceiver = Keypair.generate().publicKey
  const ata = getAssociatedTokenAddressSync(mint, tokenReceiver, true, TOKEN_PROGRAM_ID)

  /** the token setup instructions simulated before the callback, for a receiver without an ATA */
  const setupFor = async (tokenReceiverUsage?: SVMTokenReceiverUsage) => {
    const { connection, instructions } = captureReceiveIx({
      getAccountInfo: async (key: PublicKey) =>
        key.equals(mint) ? mintAccount(Keypair.generate().publicKey) : null,
    })
    await estimateExecComputeUnits({
      connection,
      router: randomPublicKey(),
      offRamp: randomPublicKey(),
      receiverVersion: 2,
      tokenReceiverUsage,
      message: {
        sourceChainSelector: 1n,
        messageId: hexlify(randomBytes(32)),
        receiver: randomPublicKey(),
        tokenReceiver: tokenReceiver.toBase58(),
        destTokenAmounts: [{ token: mint.toBase58(), amount: 7n }],
      },
      logger: quiet,
    })
    return instructions().filter(
      ({ programId }) =>
        programId === TOKEN_PROGRAM_ID.toBase58() ||
        programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    )
  }

  it('credits the token receiver itself for UseAsIs', async () => {
    const setup = await setupFor(SVMTokenReceiverUsage.UseAsIs)
    // MintToChecked [mint, destination, authority]; no ATA to create
    assert.deepEqual(
      setup.map(({ programId, keys }) => [programId, keys[1]]),
      [[TOKEN_PROGRAM_ID.toBase58(), tokenReceiver.toBase58()]],
    )
  })

  it("creates and credits the token receiver's ATA for DeriveAtaAndCreate (the default)", async () => {
    for (const usage of [undefined, SVMTokenReceiverUsage.DeriveAtaAndCreate]) {
      const setup = await setupFor(usage)
      assert.deepEqual(
        setup.map(({ programId }) => programId),
        [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID.toBase58()],
      )
      assert.equal(setup[1]!.keys[1], ata.toBase58())
    }
  })

  it('credits nothing for DeriveAtaDontCreate when the ATA is missing', async () => {
    assert.deepEqual(await setupFor(SVMTokenReceiverUsage.DeriveAtaDontCreate), [])
  })
})

describe('SolanaChain.estimateReceiveExecution, one Router serving 1.6 and 2.0 OffRamps', () => {
  const router = randomPublicKey()
  const offRamp16 = randomPublicKey()
  const offRamp20 = randomPublicKey()
  const receiver = randomPublicKey()
  const tokenReceiver = randomPublicKey()
  const mint = randomPublicKey()
  const writable = randomPublicKey()
  const readonly = randomPublicKey()
  const messageId = hexlify(randomBytes(32))
  const evmSender = '0x00000000000000000000000000000000000000aa'
  const sourceChainSelector = networkInfo('ethereum-testnet-sepolia').chainSelector
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('receiver_registry'), new PublicKey(receiver).toBuffer()],
    new PublicKey(router),
  )
  const v2Registry = {
    owner: new PublicKey(router),
    executable: false,
    lamports: 1_000_000,
    data: Buffer.from(
      getBytes(
        concat([
          new Uint8Array([143, 191, 40, 192, 11, 255, 173, 235, 254, 1]),
          new PublicKey(receiver).toBytes(),
          new Uint8Array([2]),
        ]),
      ),
    ),
  }
  const receiverAccounts = { accounts: [writable, readonly], accountIsWritableBitmap: 0b01n }
  const v2Discriminator = new Uint8Array([193, 155, 158, 156, 161, 212, 122, 116])
  /** `ccip_receive_v2` data for this message, with its token transfer delivered per `usage` */
  const v2Callback = (usage: SVMTokenReceiverUsage) =>
    hexlify(
      concat([
        v2Discriminator,
        messageId,
        le(sourceChainSelector, 8),
        u32(32),
        zeroPadValue(evmSender, 32),
        u32(2),
        '0x1234',
        '0x01', // Some(TokenTransfer)
        new PublicKey(mint).toBytes(),
        le(7, 8),
        new PublicKey(tokenReceiver).toBytes(),
        new Uint8Array([usage]),
      ]),
    )

  const setup = () => {
    const registryReads = mock.fn()
    const { connection, receiveIx } = captureReceiveIx({
      getAccountInfo: async (key: PublicKey) => {
        if (!key.equals(registryPda)) return null
        registryReads()
        return v2Registry
      },
      getSignaturesForAddress: async () => [],
    })
    const solana = new SolanaChain(connection, networkInfo('solana-devnet'), {
      apiClient: null,
      logger: quiet,
    })
    Object.assign(solana, {
      typeAndVersion: async (address: string) =>
        parseTypeAndVersion(`ccip-offramp ${address === offRamp16 ? '1.6.0' : '2.0.0'}`),
      getRouterForOffRamp: async () => router,
      getTokenInfo: async () => ({ symbol: 'TKN', decimals: 9 }),
    })
    // the receiver's accounts, past the 3 fixed ones (authority, OffRamp, allowed-OffRamp PDA)
    const callback = () => {
      const { data, accounts } = receiveIx()
      return { data, remainingAccounts: accounts.slice(3) }
    }
    return { solana, registryReads, callback }
  }

  // as `send` passes it: extraArgs fields flat in the message
  const preSendMessage = {
    sourceChainSelector,
    messageId,
    receiver,
    sender: evmSender,
    data: '0x1234',
    tokenReceiver,
    tokenAmounts: [{ token: mint, amount: 7n }],
    executorArgs: encodeSVMExecutorArgsV1({
      useAta: SVMTokenReceiverUsage.UseAsIs,
      ...receiverAccounts,
    }),
  }

  it('before send, a 2.0 OffRamp reads the registry and uses the executorArgs', async () => {
    const { solana, registryReads, callback } = setup()
    await solana.estimateReceiveExecution({ offRamp: offRamp20, message: preSendMessage })
    assert.equal(registryReads.mock.calls.length, 1)
    const { data, remainingAccounts } = callback()
    assert.equal(data, v2Callback(SVMTokenReceiverUsage.UseAsIs))
    assert.deepEqual(remainingAccounts, [
      { pubkey: writable, isWritable: true },
      { pubkey: readonly, isWritable: false },
    ])
  })

  it('before send, a 1.6 OffRamp skips the registry and keeps the legacy accounts', async () => {
    const { solana, registryReads, callback } = setup()
    await solana.estimateReceiveExecution({ offRamp: offRamp16, message: preSendMessage })
    assert.equal(registryReads.mock.calls.length, 0)
    const { data, remainingAccounts } = callback()
    assert.equal(data.slice(0, 18), hexlify(sighash('global', 'ccip_receive')))
    // executorArgs is a 2.0 field: a 1.6 OffRamp takes the receiver's accounts from `accounts`
    assert.deepEqual(remainingAccounts, [])
    const legacy = setup()
    await legacy.solana.estimateReceiveExecution({
      offRamp: offRamp16,
      message: { ...preSendMessage, ...receiverAccounts },
    })
    assert.deepEqual(legacy.callback().remainingAccounts, [
      { pubkey: writable, isWritable: true },
      { pubkey: readonly, isWritable: false },
    ])
  })

  it('after send, uses the signed destBlob and token receiver of a 2.0 message', async () => {
    const { solana, registryReads, callback } = setup()
    Object.assign(solana, {
      getMessageById: async () => ({
        lane: { sourceChainSelector },
        message: {
          messageId,
          receiver,
          sender: evmSender,
          data: '0x1234',
          offRampAddress: offRamp20,
          destBlob: encodeSVMExecutorArgsV1({
            useAta: SVMTokenReceiverUsage.DeriveAtaDontCreate,
            ...receiverAccounts,
          }),
          tokenAmounts: [
            {
              amount: 7n,
              sourcePoolAddress: '0x00000000000000000000000000000000000000b0',
              sourceTokenAddress: '0x00000000000000000000000000000000000000b1',
              destTokenAddress: mint,
              tokenReceiver,
              extraData: '0x',
            },
          ],
        },
      }),
    })
    await solana.estimateReceiveExecution({ messageId })
    assert.equal(registryReads.mock.calls.length, 1)
    const { data, remainingAccounts } = callback()
    assert.equal(data, v2Callback(SVMTokenReceiverUsage.DeriveAtaDontCreate))
    assert.deepEqual(remainingAccounts, [
      { pubkey: writable, isWritable: true },
      { pubkey: readonly, isWritable: false },
    ])
  })
})
