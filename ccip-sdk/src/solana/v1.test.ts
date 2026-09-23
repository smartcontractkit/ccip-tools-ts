import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type Connection,
  type MessageV1,
  ComputeBudgetProgram,
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  SolanaJSONRPCError,
  SystemProgram,
  TransactionExpiredTimeoutError,
  TransactionInstruction,
  TransactionMessage,
  V1_TRANSACTION_SIZE_LIMIT,
  VersionedTransaction,
} from '@solana/web3.js'
import nacl from 'tweetnacl'

import {
  CCIPArgumentInvalidError,
  CCIPPartialTransactionSubmissionError,
  CCIPTransactionTooLargeError,
} from '../errors/index.ts'
import type { Wallet } from './types.ts'
import { simulateAndSendTxs, simulateTransaction } from './utils.ts'
import {
  MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
  compileV1Message,
  serializeMessageV1,
  serializeV1Transaction,
} from './v1.ts'

// deterministic keypair for reproducible accounts
function keypairFromSeed(seed: string): Keypair {
  const seedBytes = Buffer.alloc(32)
  Buffer.from(seed).copy(seedBytes)
  return Keypair.fromSeed(seedBytes)
}

const PAYER = keypairFromSeed('payer')
const PROGRAM = new PublicKey('Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C')
const RECENT_BLOCKHASH = '11111111111111111111111111111112'
// v1 has no default resource limits; tests which don't care use these
const LIMITS = { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 1_000_000 }

function sampleInstruction(numAccounts: number, dataLength = 16): TransactionInstruction {
  const keys = Array.from({ length: numAccounts }, (_, i) => ({
    pubkey: i === 0 ? PAYER.publicKey : keypairFromSeed(`acct${i}`).publicKey,
    isSigner: i === 0,
    isWritable: i % 2 === 0,
  }))
  return new TransactionInstruction({
    keys,
    programId: PROGRAM,
    data: Buffer.alloc(dataLength, 7),
  })
}

/** Deserializes wire bytes with web3.js' own v1 codec (the test oracle). */
function deserializeV1(messageBytes: Uint8Array): { message: MessageV1; signatures: Uint8Array[] } {
  const tx = VersionedTransaction.deserialize(messageBytes) as VersionedTransaction
  assert.equal(tx.message.version, 1)
  return { message: tx.message as MessageV1, signatures: tx.signatures }
}

describe('Solana v1 transaction support (SIMD-0385)', () => {
  it('serializeMessageV1 round-trips through web3.js MessageV1 deserialization', () => {
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [sampleInstruction(5), sampleInstruction(3, 40)],
      computeUnitLimit: 350_000,
    })
    const wire = serializeV1Transaction(message, [null])

    // route through the versioned dispatcher to prove the wire is self-describing
    const deserialized = deserializeV1(wire).message

    assert.equal(deserialized.version, 1)
    assert.deepEqual(deserialized.header, message.header)
    assert.deepEqual(deserialized.staticAccountKeys, message.staticAccountKeys)
    assert.equal(deserialized.recentBlockhash, message.recentBlockhash)
    assert.deepEqual(deserialized.transactionConfig, message.transactionConfig)
    assert.equal(deserialized.compiledInstructions.length, 2)
    for (const [i, compiled] of deserialized.compiledInstructions.entries()) {
      const source = message.compiledInstructions[i]!
      assert.equal(compiled.programIdIndex, source.programIdIndex)
      assert.deepEqual([...compiled.accountKeyIndexes], [...source.accountKeyIndexes])
      assert.deepEqual([...compiled.data], [...source.data])
    }
    assert.ok(wire.length <= V1_TRANSACTION_SIZE_LIMIT)
  })

  it('serializes config fields present in the mask at their wire positions', () => {
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [sampleInstruction(2)],
    })
    assert.deepEqual(message.transactionConfig, {
      computeUnitLimit: 200_000,
      heapSize: null,
      loadedAccountsDataSizeLimit: 1_000_000,
      priorityFee: null,
    })
    const wire = Buffer.from(serializeV1Transaction(message, [null]))
    // compute-unit (bit 2) and loaded-accounts data-size (bit 3) limits: both are always set,
    // since v1 budgets 0 for an unset limit (SIMD-0385)
    assert.equal(wire.readUInt32LE(4), 0b01100)
    const configOffset = 42 + message.staticAccountKeys.length * 32
    assert.equal(wire.readUInt32LE(configOffset), 200_000)
    assert.equal(wire.readUInt32LE(configOffset + 4), 1_000_000)
    const deserialized = deserializeV1(wire)
    assert.deepEqual(deserialized.message.transactionConfig, message.transactionConfig)
  })

  it('uses the v1 envelope: message first, signatures at the tail, no count prefix', () => {
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [sampleInstruction(4)],
    })
    const signature = nacl.sign.detached(serializeMessageV1(message), PAYER.secretKey)
    const wire = serializeV1Transaction(message, [signature])

    assert.equal(wire[0], 0x81, 'v1 message prefix')
    const { message: deserialized, signatures } = deserializeV1(wire)
    assert.equal(signatures.length, 1)
    assert.deepEqual([...signatures[0]!], [...signature])
    assert.ok(deserialized.staticAccountKeys[0]!.equals(PAYER.publicKey))

    // the tail signature must verify against the payer for the serialized message bytes
    const messageLength = wire.length - 64
    const valid = nacl.sign.detached.verify(
      wire.slice(0, messageLength),
      signatures[0]!,
      PAYER.publicKey.toBytes(),
    )
    assert.ok(valid, 'tail signature verifies over the message bytes')
  })

  it('builds v1 when the v0 wire exceeds the 1232-byte packet limit', () => {
    // ~48 accounts × 32B keys plus instruction data: fits neither a v0 packet
    const instructions = [sampleInstruction(48, 300)]
    const messageV0 = new TransactionMessage({
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions,
    }).compileToV0Message()
    // v0 wire = signatures (count byte + 64B each) + message; MessageV0.serialize()
    // has a fixed 1232-byte buffer that overruns for oversized messages, so size the
    // wire arithmetically (all lengths here fit a single compact-u16 byte)
    const v0MessageSize =
      3 +
      32 +
      1 +
      messageV0.staticAccountKeys.length * 32 +
      1 +
      messageV0.compiledInstructions.reduce(
        (n, ix) => n + 1 + 1 + 2 + ix.data.length + ix.accountKeyIndexes.length,
        0,
      )
    const v0Wire = v0MessageSize + 65
    assert.ok(
      v0Wire > PACKET_DATA_SIZE,
      `v0 wire is ${v0Wire} bytes, expected > ${PACKET_DATA_SIZE}`,
    )

    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions,
      computeUnitLimit: 400_000,
    })
    const wire = serializeV1Transaction(message, [null])
    assert.ok(wire.length > v0Wire - 64, 'v1 carries all accounts statically')
    assert.ok(wire.length <= V1_TRANSACTION_SIZE_LIMIT, `v1 wire is ${wire.length} bytes`)
    const { message: deserialized } = deserializeV1(wire)
    assert.equal(deserialized.transactionConfig.computeUnitLimit, 400_000)
  })

  it('compiles accounts like web3.js does (payer first, dedupe, header split)', () => {
    const other = keypairFromSeed('acct1').publicKey
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: other, isSigner: false, isWritable: true },
        { pubkey: PAYER.publicKey, isSigner: true, isWritable: true },
        { pubkey: other, isSigner: false, isWritable: true }, // duplicate
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM,
      data: Buffer.alloc(4),
    })
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [ix],
    })
    const v0 = new TransactionMessage({
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message()
    assert.deepEqual(message.header, v0.header)
    assert.deepEqual(message.staticAccountKeys, v0.staticAccountKeys)
    assert.deepEqual(message.compiledInstructions, v0.compiledInstructions)
    assert.deepEqual(message.staticAccountKeys[0], PAYER.publicKey)
  })

  it('rejects invalid signatures and oversized v1 wires', () => {
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [sampleInstruction(4)],
    })
    assert.throws(() => serializeV1Transaction(message, []), /expected 1, got 0/)
    assert.throws(() => serializeV1Transaction(message, [new Uint8Array(32)]), /invalid length/)

    // pad instruction data until the 4096-byte v1 limit is exceeded
    let count = 4000
    for (;;) {
      count += 1000
      const padded = compileV1Message({
        ...LIMITS,
        payerKey: PAYER.publicKey,
        recentBlockhash: RECENT_BLOCKHASH,
        instructions: [sampleInstruction(4, count)],
      })
      assert.throws(
        () => serializeV1Transaction(padded, [null]),
        /Transaction too large/,
        `wire at data length ${count} should exceed the v1 limit`,
      )
      break
    }
  })

  it('rejects more than 64 static account keys (SIMD-0385 limit)', () => {
    const keys = Array.from({ length: 300 }, (_, i) => ({
      pubkey: i === 0 ? PAYER.publicKey : keypairFromSeed(`acct${i}`).publicKey,
      isSigner: i === 0,
      isWritable: true,
    }))
    assert.throws(
      () =>
        compileV1Message({
          ...LIMITS,
          payerKey: PAYER.publicKey,
          recentBlockhash: RECENT_BLOCKHASH,
          instructions: [
            new TransactionInstruction({ keys, programId: PROGRAM, data: Buffer.alloc(4) }),
          ],
        }),
      /max 64/,
    )
    // within v0's u8 account indexes, but above the v1 cap
    assert.throws(
      () =>
        compileV1Message({
          ...LIMITS,
          payerKey: PAYER.publicKey,
          recentBlockhash: RECENT_BLOCKHASH,
          instructions: [sampleInstruction(65)],
        }),
      /max 64/,
    )
  })

  it('rejects more than 12 signatures (SIMD-0385 limit)', () => {
    const signers = Array.from({ length: 13 }, (_, i) => ({
      pubkey: i === 0 ? PAYER.publicKey : keypairFromSeed(`signer${i}`).publicKey,
      isSigner: true,
      isWritable: true,
    }))
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [
        new TransactionInstruction({ keys: signers, programId: PROGRAM, data: Buffer.alloc(4) }),
      ],
    })
    assert.equal(message.header.numRequiredSignatures, 13)
    assert.throws(() => serializeV1Transaction(message, new Array(13).fill(null)), /max 12/)
  })

  it('rejects more than 64 instructions (SIMD-0385 limit)', () => {
    const instructions = Array.from(
      { length: 65 },
      (_, i) =>
        new TransactionInstruction({
          keys: [{ pubkey: PAYER.publicKey, isSigner: true, isWritable: true }],
          programId: PROGRAM,
          data: Buffer.from([i % 256]),
        }),
    )
    const message = compileV1Message({
      ...LIMITS,
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions,
    })
    assert.equal(message.compiledInstructions.length, 65)
    // the u8 instruction count still fits, but the cluster would fail sanitization;
    // serialize must reject it locally so callers can split it instead
    assert.throws(() => serializeV1Transaction(message, [null]), /max 64/)
  })

  describe('simulateTransaction / simulateAndSendTxs v1 fallback', () => {
    const OVERSIZED = [sampleInstruction(48, 300)] // v0 wire > 1232B, v1 wire < 4096B
    const SMALL = [sampleInstruction(4)]

    function mockConnection() {
      const captured: Record<string, unknown> = {}
      const connection = {
        getLatestBlockhash: async () => ({
          blockhash: RECENT_BLOCKHASH,
          lastValidBlockHeight: 999,
        }),
        simulateTransaction: async (tx: VersionedTransaction) => {
          captured.simulatedTx = tx
          return { value: { logs: [], unitsConsumed: 5 } }
        },
        _rpcRequest: async (method: string, args: unknown[]) => {
          captured.rpc = { method, args }
          return { result: { value: { logs: [], unitsConsumed: 7 } } }
        },
        sendTransaction: async (tx: VersionedTransaction) => {
          captured.sentV0 = tx
          return 'v0-signature'
        },
        sendRawTransaction: async (wire: Uint8Array) => {
          captured.sentWire = wire
          return 'v1-signature'
        },
        confirmTransaction: async (confirm: { signature: string }) => {
          captured.confirmedSignature = confirm.signature
        },
      } as unknown as Connection
      return { connection, captured }
    }

    // only VersionedTransactions are ever passed by the send/simulate paths
    const wallet = {
      publicKey: PAYER.publicKey,
      signTransaction: async (tx: VersionedTransaction) => {
        tx.sign([PAYER])
        return tx
      },
    } as unknown as Wallet

    it('simulateTransaction falls back to a raw v1 RPC simulation when v0 is oversized', async () => {
      const { connection, captured } = mockConnection()
      const result = await simulateTransaction(
        { connection },
        {
          payerKey: PAYER.publicKey,
          instructions: OVERSIZED,
        },
      )
      assert.equal(result.unitsConsumed, 7)
      assert.equal(captured.simulatedTx, undefined, 'no v0 simulation was attempted')
      const { method, args } = captured.rpc as { method: string; args: [string, unknown] }
      assert.equal(method, 'simulateTransaction')
      const wire = Buffer.from(args[0], 'base64')
      const tx = VersionedTransaction.deserialize(wire)
      assert.equal(tx.message.version, 1)
      // simulate at the per-tx maximums, like @solana/kit's resource-limit estimator
      assert.deepEqual((tx.message as MessageV1).transactionConfig, {
        computeUnitLimit: 1_400_000,
        heapSize: null,
        loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
        priorityFee: null,
      })
    })

    it('simulateTransaction reports a v1 envelope the RPC rejects as too large', async () => {
      const { connection } = mockConnection()
      ;(connection as unknown as { _rpcRequest: () => Promise<unknown> })._rpcRequest =
        async () => ({
          error: { code: -32602, message: 'failed to deserialize VersionedTransaction' },
        })
      await assert.rejects(
        simulateTransaction({ connection }, { payerKey: PAYER.publicKey, instructions: OVERSIZED }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransactionTooLargeError)
          assert.match(err.message, /too large/, 'execute() escalates to buffering on it')
          assert.ok(err.cause instanceof SolanaJSONRPCError)
          return true
        },
      )
    })

    it('simulateTransaction rethrows other v1 RPC errors as-is', async () => {
      const { connection } = mockConnection()
      ;(connection as unknown as { _rpcRequest: () => Promise<unknown> })._rpcRequest =
        async () => ({ error: { code: -32005, message: 'Node is unhealthy' } })
      await assert.rejects(
        simulateTransaction({ connection }, { payerKey: PAYER.publicKey, instructions: OVERSIZED }),
        (err: unknown) => err instanceof SolanaJSONRPCError && err.code === -32005,
      )
    })

    it('simulateTransaction keeps using the v0 path when the tx fits the packet', async () => {
      const { connection, captured } = mockConnection()
      const result = await simulateTransaction(
        { connection },
        {
          payerKey: PAYER.publicKey,
          instructions: SMALL,
        },
      )
      assert.equal(result.unitsConsumed, 5)
      assert.equal(captured.rpc, undefined, 'no raw v1 RPC simulation was attempted')
      assert.equal((captured.simulatedTx as VersionedTransaction).message.version, 0)
    })

    /** Replaces the v0 simulation mock; `impl` gets the simulated tx and the 1-based call count. */
    function mockSimulate(
      connection: Connection,
      impl: (tx: VersionedTransaction, call: number) => Record<string, unknown>,
    ) {
      const calls = { count: 0 }
      ;(
        connection as unknown as {
          simulateTransaction: (tx: VersionedTransaction) => Promise<unknown>
        }
      ).simulateTransaction = async (tx) => ({ value: impl(tx, ++calls.count) })
      return calls
    }

    /** Collects every sent v0 tx, returning `sig-1`, `sig-2`, ... */
    function mockSendV0(connection: Connection) {
      const sent: VersionedTransaction[] = []
      ;(
        connection as unknown as { sendTransaction: (tx: VersionedTransaction) => Promise<string> }
      ).sendTransaction = async (tx) => `sig-${sent.push(tx)}`
      return sent
    }

    const OK = { logs: [], unitsConsumed: 5 }
    // fails unless it's the first instruction of its tx, like one depending on an earlier tx
    const DEPENDENT = new TransactionInstruction({
      keys: [{ pubkey: PAYER.publicKey, isSigner: true, isWritable: true }],
      programId: PROGRAM,
      data: Buffer.from([0xee]),
    })
    // raw index of DEPENDENT in a simulated v0 tx (index 0 is the prepended compute-budget ix)
    const dependentIndex = (tx: VersionedTransaction) =>
      tx.message.compiledInstructions.findIndex(({ data }) => data[0] === 0xee)

    it('simulateAndSendTxs signs and sends a v1 transaction when v0 is oversized', async () => {
      const { connection, captured } = mockConnection()
      const { hash, slices } = await simulateAndSendTxs({ connection }, wallet, {
        instructions: OVERSIZED,
        mainIndex: 0,
      })
      assert.equal(hash, 'v1-signature')
      assert.deepEqual(slices, [{ signature: 'v1-signature', start: 0, end: 1 }])
      assert.equal(captured.sentV0, undefined, 'no v0 transaction was sent')
      assert.equal(captured.confirmedSignature, 'v1-signature')

      const wire = captured.sentWire as Uint8Array
      assert.ok(wire.length <= V1_TRANSACTION_SIZE_LIMIT)
      assert.equal(wire[0], 0x81, 'v1 envelope: message first')
      const tx = VersionedTransaction.deserialize(wire)
      assert.equal(tx.message.version, 1)
      // both limits are set even though the simulation used <= 200k CUs, as v1 budgets 0
      // for unset limits; the loaded-accounts one falls back to the max when unreported
      assert.deepEqual((tx.message as MessageV1).transactionConfig, {
        computeUnitLimit: Math.ceil(7 * 1.1),
        heapSize: null,
        loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES,
        priorityFee: null,
      })
      // the tail signature must verify over the serialized v1 message bytes
      const messageBytes = wire.slice(0, wire.length - 64)
      assert.ok(
        nacl.sign.detached.verify(messageBytes, tx.signatures[0]!, PAYER.publicKey.toBytes()),
        'the payer signature verifies over the v1 message',
      )
    })

    it('simulateAndSendTxs sizes the v1 loaded-accounts limit from the simulation', async () => {
      const { connection, captured } = mockConnection()
      ;(connection as unknown as { _rpcRequest: () => Promise<unknown> })._rpcRequest =
        async () => ({
          result: { value: { logs: [], unitsConsumed: 300_000, loadedAccountsDataSize: 100_000 } },
        })
      await simulateAndSendTxs({ connection }, wallet, { instructions: OVERSIZED, mainIndex: 0 })
      const tx = VersionedTransaction.deserialize(captured.sentWire as Uint8Array)
      const { computeUnitLimit, loadedAccountsDataSizeLimit } = (tx.message as MessageV1)
        .transactionConfig
      assert.equal(computeUnitLimit, Math.ceil(300_000 * 1.1))
      assert.equal(loadedAccountsDataSizeLimit, Math.ceil(100_000 * 1.1))
    })

    it('simulateAndSendTxs keeps using the v0 path when the tx fits the packet', async () => {
      const { connection, captured } = mockConnection()
      const { hash } = await simulateAndSendTxs({ connection }, wallet, {
        instructions: SMALL,
        mainIndex: 0,
      })
      assert.equal(hash, 'v0-signature')
      assert.equal(captured.sentWire, undefined, 'no raw v1 transaction was sent')
      assert.equal((captured.sentV0 as VersionedTransaction).message.version, 0)
    })

    it('simulateAndSendTxs returns the last signature when mainIndex is unset', async () => {
      const { connection } = mockConnection()
      const { hash } = await simulateAndSendTxs({ connection }, wallet, { instructions: SMALL })
      assert.equal(hash, 'v0-signature')
    })

    it('simulateAndSendTxs rejects an empty instruction list', async () => {
      const { connection } = mockConnection()
      await assert.rejects(
        simulateAndSendTxs({ connection }, wallet, { instructions: [] }),
        CCIPArgumentInvalidError,
      )
    })

    it('simulateAndSendTxs does not split a compute-budget failure in atomic mode', async () => {
      const { connection, captured } = mockConnection()
      const simulations = mockSimulate(connection, () => ({
        err: { InstructionError: [2, 'ComputationalBudgetExceeded'] },
        logs: [],
      }))

      await assert.rejects(
        simulateAndSendTxs(
          { connection },
          wallet,
          { instructions: [...SMALL, ...SMALL], mainIndex: 0 },
          { split: 'atomic' },
        ),
      )
      assert.equal(simulations.count, 1)
      assert.equal(captured.sentV0, undefined, 'nothing was sent')
    })

    it('simulateAndSendTxs rethrows a program error in resource mode', async () => {
      const { connection, captured } = mockConnection()
      const simulations = mockSimulate(connection, () => ({
        err: { InstructionError: [2, 'ProgramFailedToComplete'] },
        logs: [],
      }))

      await assert.rejects(
        simulateAndSendTxs(
          { connection },
          wallet,
          { instructions: [...SMALL, ...SMALL], mainIndex: 0 },
          { split: 'resource' },
        ),
      )
      assert.equal(simulations.count, 1)
      assert.equal(captured.sentV0, undefined, 'nothing was sent')
    })

    it('simulateAndSendTxs splits a metered program failure in resource mode', async () => {
      const { connection } = mockConnection()
      const simulations = mockSimulate(connection, (_, call) =>
        call === 1
          ? {
              err: { InstructionError: [2, 'ProgramFailedToComplete'] },
              logs: ['Program failed: exceeded CUs meter at BPF instruction'],
            }
          : OK,
      )
      mockSendV0(connection)

      const { slices } = await simulateAndSendTxs(
        { connection },
        wallet,
        { instructions: [...SMALL, ...SMALL], mainIndex: 0 },
        { split: 'resource' },
      )
      assert.equal(simulations.count, 3)
      assert.deepEqual(slices, [
        { signature: 'sig-1', start: 0, end: 1 },
        { signature: 'sig-2', start: 1, end: 2 },
      ])
    })

    it('simulateAndSendTxs cuts right before the failed instruction in partial mode', async () => {
      const { connection } = mockConnection()
      const simulations = mockSimulate(connection, (tx) => {
        const index = dependentIndex(tx)
        return index > 1 ? { err: { InstructionError: [index, { Custom: 1 }] }, logs: [] } : OK
      })
      mockSendV0(connection)

      const { hash, slices } = await simulateAndSendTxs({ connection }, wallet, {
        instructions: [...SMALL, ...SMALL, ...SMALL, DEPENDENT, ...SMALL],
        mainIndex: 3,
      })
      // one failed simulation per split point, instead of one per dropped instruction
      assert.equal(simulations.count, 3)
      assert.equal(hash, 'sig-2')
      assert.deepEqual(slices, [
        { signature: 'sig-1', start: 0, end: 3 },
        { signature: 'sig-2', start: 3, end: 5 },
      ])
    })

    it('simulateAndSendTxs does not shrink a slice whose first instruction fails', async () => {
      const { connection, captured } = mockConnection()
      const simulations = mockSimulate(connection, () => ({
        err: { InstructionError: [1, { Custom: 1 }] },
        logs: [],
      }))

      await assert.rejects(
        simulateAndSendTxs({ connection }, wallet, {
          instructions: [...SMALL, ...SMALL, ...SMALL],
          mainIndex: 0,
        }),
      )
      assert.equal(simulations.count, 1)
      assert.equal(captured.sentV0, undefined, 'nothing was sent')
    })

    it('simulateAndSendTxs maps v1 instruction errors without a compute-budget offset', async () => {
      const { connection, captured } = mockConnection()
      let v1Simulations = 0
      ;(connection as unknown as { _rpcRequest: () => Promise<unknown> })._rpcRequest =
        async () => ({
          result: {
            value:
              ++v1Simulations === 1
                ? { err: { InstructionError: [1, { Custom: 1 }] }, logs: [] }
                : { logs: [], unitsConsumed: 7 },
          },
        })

      const { slices } = await simulateAndSendTxs({ connection }, wallet, {
        instructions: [...OVERSIZED, ...SMALL],
        mainIndex: 1,
      })
      assert.equal(v1Simulations, 2)
      assert.deepEqual(slices, [
        { signature: 'v1-signature', start: 0, end: 1 },
        { signature: 'v0-signature', start: 1, end: 2 },
      ])
      assert.ok(captured.sentWire, 'the oversized instruction went out as v1')
    })

    it('simulateAndSendTxs splits in resource mode when the RPC rejects v1', async () => {
      const { connection, captured } = mockConnection()
      let v1Simulations = 0
      ;(connection as unknown as { _rpcRequest: () => Promise<unknown> })._rpcRequest =
        async () => {
          v1Simulations++
          return { error: { code: -32602, message: 'failed to deserialize VersionedTransaction' } }
        }
      const sent = mockSendV0(connection)

      // each fits a v0 packet alone, but not together: the pair only fits v1
      const MEDIUM = sampleInstruction(10, 450)
      const { slices } = await simulateAndSendTxs(
        { connection },
        wallet,
        { instructions: [MEDIUM, MEDIUM], mainIndex: 1 },
        { split: 'resource' },
      )
      assert.equal(v1Simulations, 1)
      assert.deepEqual(slices, [
        { signature: 'sig-1', start: 0, end: 1 },
        { signature: 'sig-2', start: 1, end: 2 },
      ])
      assert.equal(sent.length, 2)
      assert.equal(captured.sentWire, undefined, 'no v1 transaction was sent')
    })

    it('simulateAndSendTxs applies computeUnits only to the main instruction slice', async () => {
      const { connection } = mockConnection()
      mockSimulate(connection, (_, call) =>
        call === 1
          ? { err: { InstructionError: [2, 'ComputationalBudgetExceeded'] }, logs: [] }
          : OK,
      )
      const sent = mockSendV0(connection)

      await simulateAndSendTxs(
        { connection },
        wallet,
        { instructions: [...SMALL, ...SMALL], mainIndex: 1 },
        { computeUnits: 123_456 },
      )
      const computeUnitLimits = sent.map((tx) => {
        const { staticAccountKeys, compiledInstructions } = tx.message
        const ix = compiledInstructions.find(({ programIdIndex }) =>
          staticAccountKeys[programIdIndex]!.equals(ComputeBudgetProgram.programId),
        )
        return ix && Buffer.from(ix.data).readUInt32LE(1)
      })
      assert.deepEqual(computeUnitLimits, [undefined, 123_456])
    })

    it('simulateAndSendTxs reports confirmed slices when a later slice fails', async () => {
      const { connection } = mockConnection()
      mockSimulate(connection, (_, call) => {
        switch (call) {
          case 1:
            return { err: { InstructionError: [2, 'ComputationalBudgetExceeded'] }, logs: [] }
          case 2:
            return OK
          default:
            return { err: { InstructionError: [1, 'Custom'] }, logs: [] }
        }
      })

      await assert.rejects(
        simulateAndSendTxs({ connection }, wallet, {
          instructions: [...SMALL, ...SMALL],
          mainIndex: 0,
        }),
        (error: unknown) => {
          assert.ok(error instanceof CCIPPartialTransactionSubmissionError)
          assert.deepEqual(error.context.committedSlices, [
            { signature: 'v0-signature', start: 0, end: 1 },
          ])
          assert.deepEqual(error.context.committedHashes, ['v0-signature'])
          assert.equal(error.context.committedInstructionCount, 1)
          assert.equal(error.context.pendingSignature, undefined)
          return true
        },
      )
    })

    it('simulateAndSendTxs reports a sent but unconfirmed transaction', async () => {
      const { connection } = mockConnection()
      mockSimulate(connection, (_, call) =>
        call === 1
          ? { err: { InstructionError: [2, 'ComputationalBudgetExceeded'] }, logs: [] }
          : OK,
      )
      mockSendV0(connection)
      let confirmations = 0
      ;(connection as unknown as { confirmTransaction: () => Promise<void> }).confirmTransaction =
        async () => {
          if (++confirmations === 2) throw new TransactionExpiredTimeoutError('sig-2', 30)
        }

      await assert.rejects(
        simulateAndSendTxs({ connection }, wallet, {
          instructions: [...SMALL, ...SMALL],
          mainIndex: 1,
        }),
        (error: unknown) => {
          assert.ok(error instanceof CCIPPartialTransactionSubmissionError)
          assert.equal(error.context.pendingSignature, 'sig-2')
          assert.ok(error.cause instanceof TransactionExpiredTimeoutError)
          return true
        },
      )
    })
  })
})
