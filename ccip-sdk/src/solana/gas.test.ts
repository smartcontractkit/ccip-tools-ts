import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

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
import { sighash } from './coder.ts'
import { SVMTokenReceiverUsage } from './extra-args.ts'
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
    const { compiledInstructions, staticAccountKeys } = simulated.at(-1)!.message
    // [setComputeUnitLimit, ccip_receive(_v2)]; token setup fails on the mock, so it's skipped
    const ix = compiledInstructions.at(-1)!
    return {
      programId: staticAccountKeys[ix.programIdIndex]!.toBase58(),
      data: hexlify(ix.data),
    }
  }
  return { connection, receiveIx }
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
