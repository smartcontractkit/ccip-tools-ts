import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type AccountMeta,
  type Connection,
  type VersionedTransaction,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import { getBytes, hexlify, keccak256, randomBytes } from 'ethers'

import '../index.ts' // registers the chain families MessageV1 decoding needs
import {
  CCIPArgumentInvalidError,
  CCIPMessageNotVerifiedYetError,
  CCIPSolanaExecutionBufferIncompleteError,
  CCIPTransactionTooLargeError,
} from '../errors/index.ts'
import { encodeMessageV1 } from '../evm/messageCodec.ts'
import { networkInfo } from '../networks.ts'
import { type CCIPMessage, type CCIPRequest, type ExecutionInput, CCIPVersion } from '../types.ts'
import { sizedCoder } from './coder.ts'
import {
  type ExecutionInputV2,
  BUFFER_EXECUTION_INPUTS_DISCRIMINATOR,
  CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR,
  bufferExecutionInputsIxs,
  closeExecutionInputsBufferIx,
  executeV2,
  generateUnsignedExecuteV2,
  getVerificationPolicyV2,
  toExecutionInputsV2,
} from './exec-v2.ts'
import { IDL as CCIP_COMMON_IDL } from './idl/2.0.0/CCIP_COMMON.ts'
import {
  EXECUTE_V2_DISCRIMINATOR,
  GET_CCVS_FOR_MSG_DISCRIMINATOR,
  RESOLVE_ACCOUNTS_START_DISCRIMINATOR,
} from './resolution.ts'
import { SolanaChain } from './index.ts'

const silent = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Console
const randomKey = () => Keypair.generate().publicKey
const commonCoder = sizedCoder(CCIP_COMMON_IDL)

// Independent Borsh writer, so the layouts are checked against the Rust ones rather than the IDL
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(n)
  return b
}
const bytes = (data: Buffer) => Buffer.concat([u32(data.length), data])
const vec = (items: Buffer[]) => Buffer.concat([u32(items.length), ...items])

// `Buffer` account discriminator, from the program's IDL
const BUFFER_ACCOUNT_DISCRIMINATOR = Buffer.from([115, 5, 212, 192, 85, 30, 46, 41])

const pda = (program: PublicKey, ...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, program)[0]
const inputsBufferPda = (offramp: PublicKey, bufferId: Buffer, caller: PublicKey) =>
  pda(offramp, Buffer.from('execution_inputs_buffer'), bufferId, caller.toBuffer())

/** Borsh `ExecutionInputsV2`, independently encoded. */
function serializeInputs(encodedMessage: Buffer, ccvs: PublicKey[], results: Buffer[]) {
  return Buffer.concat([
    bytes(encodedMessage),
    vec(ccvs.map((ccv) => ccv.toBuffer())),
    vec(results.map(bytes)),
  ])
}

/** Parses a `buffer_execution_inputs` instruction's data. */
function parseChunk(data: Buffer) {
  assert.deepEqual(data.subarray(0, 8), BUFFER_EXECUTION_INPUTS_DISCRIMINATOR)
  const chunkLength = data.readUInt32LE(8 + 32 + 4)
  const chunkEnd = 8 + 32 + 4 + 4 + chunkLength
  assert.equal(data.length, chunkEnd + 2)
  return {
    bufferId: data.subarray(8, 40),
    totalLength: data.readUInt32LE(40),
    chunk: data.subarray(8 + 32 + 4 + 4, chunkEnd),
    chunkIndex: data[chunkEnd]!,
    numChunks: data[chunkEnd + 1]!,
  }
}

/** A `Buffer` account, as the offramp stores it. */
function bufferAccount(
  caller: PublicKey,
  {
    bitmap,
    numChunks,
    chunkLength,
    data,
  }: {
    bitmap: bigint
    numChunks: number
    chunkLength: number
    data: Buffer
  },
) {
  return {
    data: Buffer.concat([
      BUFFER_ACCOUNT_DISCRIMINATOR,
      Buffer.from([1, 254]), // version, bump
      Buffer.alloc(32, 9), // buffer_id
      caller.toBuffer(), // authority
      u64(bitmap),
      Buffer.from([numChunks]),
      u32(chunkLength),
      bytes(data),
    ]),
  }
}

/** An execution input's `ExecutionInputsV2`, independently serialized. */
function serializedInputs({ encodedMessage, verifications }: ExecutionInputV2) {
  return serializeInputs(
    Buffer.from(getBytes(encodedMessage)),
    verifications.map(({ destAddress }) => new PublicKey(destAddress)),
    verifications.map(({ ccvData }) => Buffer.from(getBytes(ccvData))),
  )
}

/** A `Buffer` account holding all of an execution input's chunks. */
function completeBuffer(caller: PublicKey, execInput: ExecutionInputV2) {
  const data = serializedInputs(execInput)
  const numChunks = Math.ceil(data.length / 800)
  return bufferAccount(caller, {
    bitmap: (1n << BigInt(numChunks)) - 1n,
    numChunks,
    chunkLength: Math.min(data.length, 800),
    data,
  })
}

function encodeResponse(accountsToSave: AccountMeta[], metadata: Buffer): Buffer {
  return commonCoder.types.encode('ResolveAccountsResponse', {
    askAgainWith: [],
    accountsToSave,
    lookupTablesToSave: [],
    nextIxDiscriminator: null,
    metadata,
  })
}

type Ix = { programId: PublicKey; keys: AccountMeta[]; data: Buffer }

/** The instructions of a (v0) transaction, with account flags read back from the message. */
function instructionsOf(tx: VersionedTransaction): Ix[] {
  const msg = tx.message
  const keys = msg.staticAccountKeys
  return msg.compiledInstructions.map((ix) => ({
    programId: keys[ix.programIdIndex]!,
    keys: ix.accountKeyIndexes.map((i) => ({
      pubkey: keys[i]!,
      isSigner: msg.isAccountSigner(i),
      isWritable: msg.isAccountWritable(i),
    })),
    data: Buffer.from(ix.data),
  }))
}

/**
 * A connection to a fake offramp: resolution completes in one stage with `resolved` accounts,
 * `get_ccvs_for_msg` returns `policy`, and every other offramp instruction succeeds. Transactions
 * too large for v0 are rejected, as on a cluster without v1 support.
 */
function fakeOfframp(
  offramp: PublicKey,
  {
    resolved = [],
    metadata = Buffer.from([1, 2, 3]),
    policy = { requiredCcvs: [], optionalCcvs: [], optionalThreshold: 0 },
    accounts = {},
  }: {
    resolved?: AccountMeta[]
    metadata?: Buffer
    policy?: { requiredCcvs: PublicKey[]; optionalCcvs: PublicKey[]; optionalThreshold: number }
    accounts?: Record<string, { data: Buffer }>
  } = {},
) {
  const simulated: Ix[] = [] // the offramp instruction of each simulation
  const sent: Ix[][] = []
  const simulateTransaction = mock.fn(async (tx: VersionedTransaction) => {
    const ix = instructionsOf(tx).findLast(({ programId }) => programId.equals(offramp))!
    simulated.push(ix)
    const discriminator = ix.data.subarray(0, 8)
    let returnData
    if (discriminator.equals(RESOLVE_ACCOUNTS_START_DISCRIMINATOR)) {
      returnData = encodeResponse(resolved, metadata)
    } else if (discriminator.equals(GET_CCVS_FOR_MSG_DISCRIMINATOR)) {
      returnData = Buffer.concat([
        vec(policy.requiredCcvs.map((ccv) => ccv.toBuffer())),
        vec(policy.optionalCcvs.map((ccv) => ccv.toBuffer())),
        Buffer.from([policy.optionalThreshold]),
      ])
    }
    return {
      value: {
        err: null,
        logs: [],
        unitsConsumed: 1000,
        returnData: returnData && {
          programId: offramp.toBase58(),
          data: [returnData.toString('base64'), 'base64'],
        },
      },
    }
  })
  const connection = {
    rpcEndpoint: 'fake',
    simulateTransaction,
    // v1 transactions (the fallback for oversized v0 ones) are rejected
    _rpcRequest: mock.fn(async () => ({ error: { code: -32602, message: 'invalid params' } })),
    getAccountInfo: mock.fn(async (key: PublicKey) => accounts[key.toBase58()] ?? null),
    getAccountInfoAndContext: mock.fn(async (key: PublicKey) => ({
      context: { slot: 1 },
      value: accounts[key.toBase58()] ?? null,
    })),
    getSignaturesForAddress: mock.fn(async () => []),
    getAddressLookupTable: mock.fn(async () => ({ value: null })),
    getLatestBlockhash: mock.fn(async () => ({
      blockhash: '11111111111111111111111111111112',
      lastValidBlockHeight: 100,
    })),
    sendTransaction: mock.fn(async (tx: VersionedTransaction) => {
      sent.push(instructionsOf(tx))
      return `sig${sent.length}`
    }),
    confirmTransaction: mock.fn(async () => ({ value: { err: null } })),
  } as unknown as Connection
  return { connection, simulated, sent }
}

const walletFor = (publicKey: PublicKey) => ({
  publicKey,
  signTransaction: async <T>(tx: T) => tx,
})

describe('toExecutionInputsV2', () => {
  it('pairs each CCV with its verifier result, whichever encoding its address comes in', () => {
    const [a, b] = [randomKey(), randomKey()]
    const inputs = toExecutionInputsV2({
      encodedMessage: '0xabcd',
      verifications: [
        { destAddress: a.toBase58(), ccvData: '0x01' },
        { destAddress: hexlify(b.toBytes()), ccvData: '0x0202' },
      ],
    })
    assert.equal(inputs.encodedMessage, '0xabcd')
    assert.deepEqual(
      inputs.ccvs.map((ccv) => ccv.toBase58()),
      [a.toBase58(), b.toBase58()],
    )
    assert.deepEqual(inputs.verifierResults, ['0x01', '0x0202'])
  })
})

describe('getVerificationPolicyV2', () => {
  it('reads the policy off a resolved get_ccvs_for_msg', async () => {
    const offramp = randomKey()
    const [required, optional] = [randomKey(), randomKey()]
    const resolved = [{ pubkey: randomKey(), isSigner: false, isWritable: false }]
    const { connection, simulated } = fakeOfframp(offramp, {
      resolved,
      policy: { requiredCcvs: [required], optionalCcvs: [optional], optionalThreshold: 1 },
    })
    const encodedMessage = encodeMessageV1({
      sourceChainSelector: networkInfo('ethereum-testnet-sepolia').chainSelector,
      destChainSelector: networkInfo('solana-devnet').chainSelector,
      ccipReceiveGasLimit: 0,
      finality: '0x00000000',
      sender: '0x' + '11'.repeat(32),
      receiver: '0x',
    })

    const policy = await getVerificationPolicyV2(
      { connection, logger: silent },
      offramp,
      encodedMessage,
    )

    assert.deepEqual(policy, {
      requiredCCVs: [required.toBase58()],
      optionalCCVs: [optional.toBase58()],
      optionalThreshold: 1,
    })
    // resolved first, then simulated with the resolved accounts
    const view = simulated[1]!
    assert.deepEqual(view.data.subarray(0, 8), GET_CCVS_FOR_MSG_DISCRIMINATOR)
    assert.deepEqual(view.keys, resolved)
  })
})

describe('execution inputs buffer', () => {
  const offramp = randomKey()
  const caller = randomKey()
  const bufferId = Buffer.from(randomBytes(32))
  const buffer = inputsBufferPda(offramp, bufferId, caller)
  const ccv = randomKey()
  const encodedMessage = Buffer.from(randomBytes(1200))
  const results = [Buffer.from(randomBytes(100))]
  const inputs = { encodedMessage, ccvs: [ccv], verifierResults: results }
  // 1348 bytes: two chunks, the last one shorter
  const serialized = serializeInputs(encodedMessage, [ccv], results)

  const fixedAccounts = [
    { pubkey: buffer, isSigner: false, isWritable: true },
    { pubkey: pda(offramp, Buffer.from('config')), isSigner: false, isWritable: false },
    { pubkey: caller, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: pda(offramp, Buffer.from('__event_authority')), isSigner: false, isWritable: false },
    { pubkey: offramp, isSigner: false, isWritable: false },
  ]

  it('pins the upstream discriminators', () => {
    assert.deepEqual(
      [...BUFFER_EXECUTION_INPUTS_DISCRIMINATOR],
      [123, 142, 203, 67, 134, 9, 215, 26],
    )
    assert.deepEqual(
      [...CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR],
      [198, 228, 50, 91, 166, 43, 53, 198],
    )
  })

  it('writes the serialized inputs in chunks', async () => {
    const { connection } = fakeOfframp(offramp)
    const ixs = await bufferExecutionInputsIxs(
      { connection },
      { offramp, caller, bufferId, inputs },
    )

    assert.equal(ixs.length, 2)
    const chunks = ixs.map((ix) => {
      assert.ok(ix.programId.equals(offramp))
      assert.deepEqual(ix.keys, fixedAccounts)
      return parseChunk(ix.data)
    })
    chunks.forEach((chunk, i) => {
      assert.deepEqual(chunk.bufferId, bufferId)
      assert.equal(chunk.totalLength, serialized.length)
      assert.equal(chunk.chunkIndex, i)
      assert.equal(chunk.numChunks, ixs.length)
    })
    assert.deepEqual(Buffer.concat(chunks.map(({ chunk }) => chunk)), serialized)
  })

  it('skips the chunks a matching buffer already holds', async () => {
    const data = Buffer.alloc(serialized.length)
    serialized.copy(data, 0, 0, 800) // chunk 0 only
    const { connection } = fakeOfframp(offramp, {
      accounts: {
        [buffer.toBase58()]: bufferAccount(caller, {
          bitmap: 0b1n,
          numChunks: 2,
          chunkLength: 800,
          data,
        }),
      },
    })
    const ixs = await bufferExecutionInputsIxs(
      { connection },
      { offramp, caller, bufferId, inputs },
    )
    assert.deepEqual(
      ixs.map(({ data }) => parseChunk(data).chunkIndex),
      [1],
    )
  })

  it('writes nothing to a complete matching buffer', async () => {
    const { connection } = fakeOfframp(offramp, {
      accounts: {
        [buffer.toBase58()]: bufferAccount(caller, {
          bitmap: 0b11n,
          numChunks: 2,
          chunkLength: 800,
          data: serialized,
        }),
      },
    })
    assert.deepEqual(
      await bufferExecutionInputsIxs({ connection }, { offramp, caller, bufferId, inputs }),
      [],
    )
  })

  it('closes and rewrites a buffer holding other inputs', async () => {
    const other = Buffer.from(serialized)
    other[0]! ^= 0xff
    const { connection } = fakeOfframp(offramp, {
      accounts: {
        [buffer.toBase58()]: bufferAccount(caller, {
          bitmap: 0b1n,
          numChunks: 2,
          chunkLength: 800,
          data: other,
        }),
      },
    })
    const ixs = await bufferExecutionInputsIxs(
      { connection },
      { offramp, caller, bufferId, inputs },
    )

    assert.equal(ixs.length, 3)
    const close = ixs[0]!
    assert.deepEqual(close, closeExecutionInputsBufferIx(offramp, caller, bufferId))
    assert.deepEqual(close.keys, fixedAccounts)
    assert.deepEqual(
      close.data,
      Buffer.concat([CLOSE_EXECUTION_INPUTS_BUFFER_DISCRIMINATOR, bufferId]),
    )
    assert.deepEqual(
      ixs.slice(1).map(({ data }) => parseChunk(data).chunkIndex),
      [0, 1],
    )
  })

  it('rejects inputs over the 64 chunks a buffer holds', async () => {
    const { connection } = fakeOfframp(offramp)
    await assert.rejects(
      bufferExecutionInputsIxs(
        { connection },
        {
          offramp,
          caller,
          bufferId,
          inputs: { ...inputs, encodedMessage: Buffer.alloc(64 * 800) },
        },
      ),
      CCIPTransactionTooLargeError,
    )
  })
})

describe('executeV2', () => {
  const offramp = randomKey()
  const caller = randomKey()
  const ccv = randomKey()
  const resolved = [
    { pubkey: randomKey(), isSigner: false, isWritable: false },
    { pubkey: caller, isSigner: true, isWritable: true },
  ]
  const input = (size: number): ExecutionInputV2 => ({
    encodedMessage: hexlify(randomBytes(size)),
    verifications: [{ destAddress: ccv.toBase58(), ccvData: '0x' + 'cc'.repeat(100) }],
  })

  it('executes inline when the inputs fit', async () => {
    const { connection, sent } = fakeOfframp(offramp, { resolved })
    const hash = await executeV2({ connection, logger: silent }, walletFor(caller), {
      offramp,
      input: input(100),
    })

    assert.equal(hash, 'sig1')
    assert.equal(sent.length, 1)
    const exec = sent[0]!.at(-1)!
    assert.deepEqual(
      exec.data.subarray(0, 9),
      Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([1])]),
    )
    assert.deepEqual(exec.keys, resolved)
  })

  it('buffers inputs too large to go inline, then executes from the buffer', async () => {
    // 1348 bytes of inputs, two chunks
    const execInput = input(1200)
    const bufferId = Buffer.from(keccak256(execInput.encodedMessage).slice(2), 'hex')
    const metadata = Buffer.from([4, 5, 6])
    const { connection, simulated, sent } = fakeOfframp(offramp, { resolved, metadata })

    const hash = await executeV2({ connection, logger: silent }, walletFor(caller), {
      offramp,
      input: execInput,
    })

    // every chunk in its own transaction, then execute_v2
    assert.equal(sent.length, 3)
    assert.equal(hash, 'sig3')
    const chunks = sent.slice(0, 2).map((ixs) => parseChunk(ixs.at(-1)!.data))
    assert.deepEqual(
      Buffer.concat(chunks.map(({ chunk }) => chunk)),
      serializeInputs(
        Buffer.from(execInput.encodedMessage.slice(2), 'hex'),
        [ccv],
        [Buffer.alloc(100, 0xcc)],
      ),
    )
    chunks.forEach((chunk) => assert.deepEqual(chunk.bufferId, bufferId))

    // resolution of the buffered execute_v2 starts from the buffer
    const start = simulated.findLast(({ data }) =>
      data.subarray(0, 8).equals(RESOLVE_ACCOUNTS_START_DISCRIMINATOR),
    )!
    assert.deepEqual(
      start.keys.map(({ pubkey }) => pubkey.toBase58()),
      [pda(offramp, Buffer.from('config')), inputsBufferPda(offramp, bufferId, caller)].map((key) =>
        key.toBase58(),
      ),
    )
    // ExecuteParams { exec_inputs: None, resolution_metadata }
    const exec = sent[2]!.at(-1)!
    assert.deepEqual(
      exec.data,
      Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([0]), bytes(metadata)]),
    )
  })

  it('executes from a complete buffer an earlier attempt left, without rewriting it', async () => {
    const execInput = input(1200)
    const bufferId = Buffer.from(keccak256(execInput.encodedMessage).slice(2), 'hex')
    const { connection, sent } = fakeOfframp(offramp, {
      resolved,
      accounts: {
        [inputsBufferPda(offramp, bufferId, caller).toBase58()]: completeBuffer(caller, execInput),
      },
    })

    await executeV2({ connection, logger: silent }, walletFor(caller), {
      offramp,
      input: execInput,
    })

    assert.equal(sent.length, 1)
    assert.deepEqual(
      sent[0]!.at(-1)!.data.subarray(0, 9),
      Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([0])]),
    )
  })
})

describe('generateUnsignedExecuteV2', () => {
  const offramp = randomKey()
  const caller = randomKey()
  const ccv = randomKey()
  const resolved = [{ pubkey: caller, isSigner: true, isWritable: true }]
  const metadata = Buffer.from([4, 5, 6])
  const input = (size: number): ExecutionInputV2 => ({
    encodedMessage: hexlify(randomBytes(size)),
    verifications: [{ destAddress: ccv.toBase58(), ccvData: '0x' + 'cc'.repeat(100) }],
  })
  const bufferOf = (execInput: ExecutionInputV2) =>
    inputsBufferPda(
      offramp,
      Buffer.from(keccak256(execInput.encodedMessage).slice(2), 'hex'),
      caller,
    )
  const generate = (connection: Connection, execInput: ExecutionInputV2, forceBuffer?: boolean) =>
    generateUnsignedExecuteV2({ connection, logger: silent }, caller, offramp, execInput, {
      forceBuffer,
    })

  for (const forceBuffer of [true, false]) {
    it(`executes from a complete buffer${forceBuffer ? ', with forceBuffer' : ', over inline'}`, async () => {
      // inputs that'd fit inline, which a complete buffer is preferred over
      const execInput = input(forceBuffer ? 1200 : 100)
      const buffer = bufferOf(execInput)
      const { connection, simulated } = fakeOfframp(offramp, {
        resolved,
        metadata,
        accounts: { [buffer.toBase58()]: completeBuffer(caller, execInput) },
      })

      const unsigned = await generate(connection, execInput, forceBuffer)

      // ExecuteParams { exec_inputs: None, resolution_metadata }, resolved from the buffer
      const exec = unsigned.instructions[unsigned.mainIndex!]!
      assert.deepEqual(
        exec.data,
        Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([0]), bytes(metadata)]),
      )
      assert.deepEqual(exec.keys, resolved)
      const start = simulated.find(({ data }) =>
        data.subarray(0, 8).equals(RESOLVE_ACCOUNTS_START_DISCRIMINATOR),
      )!
      assert.ok(start.keys.some(({ pubkey }) => pubkey.equals(buffer)))
    })
  }

  it('refuses forceBuffer until the buffer is complete', async () => {
    const execInput = input(1200) // two chunks
    const buffer = bufferOf(execInput)
    const serialized = serializedInputs(execInput)
    const partial = Buffer.alloc(serialized.length)
    serialized.copy(partial, 0, 0, 800)
    const other = Buffer.from(serialized)
    other[0]! ^= 0xff

    for (const [account, missingChunks, stale] of [
      [undefined, 2, false],
      [
        bufferAccount(caller, { bitmap: 0b1n, numChunks: 2, chunkLength: 800, data: partial }),
        1,
        false,
      ],
      [
        bufferAccount(caller, { bitmap: 0b11n, numChunks: 2, chunkLength: 800, data: other }),
        2,
        true,
      ],
    ] as const) {
      const { connection, simulated } = fakeOfframp(offramp, {
        resolved,
        accounts: account ? { [buffer.toBase58()]: account } : {},
      })
      await assert.rejects(
        generate(connection, execInput, true),
        (err: unknown) =>
          err instanceof CCIPSolanaExecutionBufferIncompleteError &&
          err.context.buffer === buffer.toBase58() &&
          err.context.missingChunks === missingChunks &&
          err.context.stale === stale,
      )
      assert.equal(simulated.length, 0, 'nothing to resolve against an incomplete buffer')
    }
  })

  it('throws for inputs too large to go inline, pointing at their buffering', async () => {
    const { connection } = fakeOfframp(offramp, { resolved })
    await assert.rejects(
      generate(connection, input(1500)),
      (err: unknown) =>
        err instanceof CCIPTransactionTooLargeError &&
        err.message.includes('generateUnsignedExecuteBuffer'),
    )
  })
})

describe('SolanaChain CCIP 2.0 execution', () => {
  const offRamp = randomKey()
  const [required, optional] = [randomKey(), randomKey()]
  const encodedMessage = encodeMessageV1({
    sourceChainSelector: networkInfo('ethereum-testnet-sepolia').chainSelector,
    destChainSelector: networkInfo('solana-devnet').chainSelector,
    ccipReceiveGasLimit: 0,
    finality: '0x00000000',
    onRampAddress: '0x' + '00'.repeat(12) + '22'.repeat(20),
    offRampAddress: hexlify(offRamp.toBytes()),
    sender: '0x' + '00'.repeat(12) + '11'.repeat(20),
    receiver: hexlify(randomKey().toBytes()),
  })
  const messageId = keccak256(encodedMessage)
  const request = {
    lane: {
      sourceChainSelector: networkInfo('ethereum-testnet-sepolia').chainSelector,
      destChainSelector: networkInfo('solana-devnet').chainSelector,
      onRamp: '0x' + '22'.repeat(20),
      version: CCIPVersion.V2_0,
    },
    message: { messageId, encodedMessage } as unknown as CCIPMessage,
    log: { blockTimestamp: 0 },
  } as unknown as CCIPRequest

  const chain = (connection: Connection) =>
    new SolanaChain(connection, networkInfo('solana-devnet'), { apiClient: null, logger: silent })

  it('collects user-supplied verifier results against the offramp policy', async () => {
    const { connection } = fakeOfframp(offRamp, {
      policy: { requiredCcvs: [required], optionalCcvs: [optional], optionalThreshold: 1 },
    })
    const solana = chain(connection)

    const result = await solana.getVerifications({
      offRamp: offRamp.toBase58(),
      request,
      indexer: [],
      ccvData: { [required.toBase58()]: '0x01', [hexlify(optional.toBytes())]: '0x02' },
    })
    assert.ok('verificationPolicy' in result)
    assert.deepEqual(result.verificationPolicy, {
      requiredCCVs: [required.toBase58()],
      optionalCCVs: [optional.toBase58()],
      optionalThreshold: 1,
    })
    assert.deepEqual(
      result.verifications.map(({ destAddress, ccvData }) => [destAddress, ccvData]),
      [
        [required.toBase58(), '0x01'],
        [optional.toBase58(), '0x02'],
      ],
    )

    // and fails naming what's missing when they don't cover it
    await assert.rejects(
      solana.getVerifications({
        offRamp: offRamp.toBase58(),
        request,
        indexer: [],
        ccvData: { [optional.toBase58()]: '0x02' },
      }),
      (err: unknown) =>
        err instanceof CCIPMessageNotVerifiedYetError &&
        (err.context.missingCCVs as string[])[0] === required.toBase58(),
    )
  })

  it('generates an inline execute_v2 for a CCIP 2.0 input, or a buffered one once buffered', async () => {
    const payer = randomKey()
    const resolved = [{ pubkey: payer, isSigner: true, isWritable: true }]
    const input = {
      encodedMessage,
      verifications: [{ destAddress: required.toBase58(), ccvData: '0x01' }],
    }
    const buffer = inputsBufferPda(offRamp, Buffer.from(messageId.slice(2), 'hex'), payer)
    const opts = { offRamp: offRamp.toBase58(), input, payer: payer.toBase58() }

    const accounts: Record<string, { data: Buffer }> = {}
    const { connection } = fakeOfframp(offRamp, { resolved, accounts })
    const solana = chain(connection)
    const unsigned = await solana.generateUnsignedExecute(opts)
    const exec = unsigned.instructions[unsigned.mainIndex!]!
    assert.ok(exec.programId.equals(offRamp))
    assert.deepEqual(
      exec.data.subarray(0, 9),
      Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([1])]),
    )
    assert.deepEqual(exec.keys, resolved)

    // forceBuffer needs the buffering to land first
    await assert.rejects(
      solana.generateUnsignedExecute({ ...opts, forceBuffer: true }),
      (err: unknown) =>
        err instanceof CCIPSolanaExecutionBufferIncompleteError &&
        err.context.buffer === buffer.toBase58(),
    )
    const buffering = await solana.generateUnsignedExecuteBuffer(opts)
    assert.equal(buffering.mainIndex, undefined)
    assert.deepEqual(
      Buffer.concat(buffering.instructions.map(({ data }) => parseChunk(data).chunk)),
      serializedInputs(input),
    )

    // which, once landed, the execution is resolved from; right away, despite SolanaChain caching
    // account reads that saw no buffer
    accounts[buffer.toBase58()] = completeBuffer(payer, input)
    assert.deepEqual((await solana.generateUnsignedExecuteBuffer(opts)).instructions, [])
    const fromBuffer = await solana.generateUnsignedExecute({ ...opts, forceBuffer: true })
    assert.deepEqual(
      fromBuffer.instructions[fromBuffer.mainIndex!]!.data.subarray(0, 9),
      Buffer.concat([EXECUTE_V2_DISCRIMINATOR, Buffer.from([0])]),
    )
  })

  it('only buffers CCIP 2.0 execution inputs ahead of execution', async () => {
    const { connection } = fakeOfframp(offRamp)
    await assert.rejects(
      chain(connection).generateUnsignedExecuteBuffer({
        offRamp: offRamp.toBase58(),
        // a CCIP 1.6 report: its buffering is part of generateUnsignedExecute's output
        input: {
          message: { messageId, feeValueJuels: 0n },
          proofs: [],
        } as unknown as ExecutionInput,
        payer: randomKey().toBase58(),
      }),
      (err: unknown) => err instanceof CCIPArgumentInvalidError && err.context.argument === 'input',
    )
  })
})
