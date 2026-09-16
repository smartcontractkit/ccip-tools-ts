import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type Connection,
  type MessageV1,
  Keypair,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  V1_TRANSACTION_SIZE_LIMIT,
  VersionedTransaction,
} from '@solana/web3.js'
import nacl from 'tweetnacl'

import type { Wallet } from './types.ts'
import { simulateAndSendTxs, simulateTransaction } from './utils.ts'
import { compileV1Message, serializeMessageV1, serializeV1Transaction } from './v1.ts'

// deterministic keypair for reproducible accounts
function keypairFromSeed(seed: string): Keypair {
  const seedBytes = Buffer.alloc(32)
  Buffer.from(seed).copy(seedBytes)
  return Keypair.fromSeed(seedBytes)
}

const PAYER = keypairFromSeed('payer')
const PROGRAM = new PublicKey('Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C')
const RECENT_BLOCKHASH = '11111111111111111111111111111112'

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
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions: [sampleInstruction(2)],
    })
    assert.deepEqual(message.transactionConfig, {
      computeUnitLimit: null,
      heapSize: null,
      loadedAccountsDataSizeLimit: null,
      priorityFee: null,
    })
    const deserialized = deserializeV1(serializeV1Transaction(message, [null]))
    assert.deepEqual(deserialized.message.transactionConfig, message.transactionConfig)
  })

  it('uses the v1 envelope: message first, signatures at the tail, no count prefix', () => {
    const message = compileV1Message({
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

  it('rejects more than 255 static account keys (v1 format limit)', () => {
    const keys = Array.from({ length: 300 }, (_, i) => ({
      pubkey: i === 0 ? PAYER.publicKey : keypairFromSeed(`acct${i}`).publicKey,
      isSigner: i === 0,
      isWritable: true,
    }))
    assert.throws(
      () =>
        compileV1Message({
          payerKey: PAYER.publicKey,
          recentBlockhash: RECENT_BLOCKHASH,
          instructions: [
            new TransactionInstruction({ keys, programId: PROGRAM, data: Buffer.alloc(4) }),
          ],
        }),
      /max 255/,
    )
  })

  it('rejects more than 255 instructions (v1 format limit)', () => {
    const instructions = Array.from(
      { length: 300 },
      (_, i) =>
        new TransactionInstruction({
          keys: [{ pubkey: PAYER.publicKey, isSigner: true, isWritable: true }],
          programId: PROGRAM,
          data: Buffer.from([i % 256]),
        }),
    )
    const message = compileV1Message({
      payerKey: PAYER.publicKey,
      recentBlockhash: RECENT_BLOCKHASH,
      instructions,
    })
    assert.equal(message.compiledInstructions.length, 300)
    // the u8 instruction count would wrap (300 -> 44); serialize must reject it
    // instead of emitting a corrupt wire
    assert.throws(() => serializeV1Transaction(message, [null]), /max 255/)
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
      assert.ok(
        (tx.message as MessageV1).transactionConfig.computeUnitLimit,
        'compute-unit limit is inlined into the transactionConfig',
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

    it('simulateAndSendTxs signs and sends a v1 transaction when v0 is oversized', async () => {
      const { connection, captured } = mockConnection()
      const signature = await simulateAndSendTxs({ connection }, wallet, {
        instructions: OVERSIZED,
        mainIndex: 0,
      })
      assert.equal(signature, 'v1-signature')
      assert.equal(captured.sentV0, undefined, 'no v0 transaction was sent')
      assert.equal(captured.confirmedSignature, 'v1-signature')

      const wire = captured.sentWire as Uint8Array
      assert.ok(wire.length <= V1_TRANSACTION_SIZE_LIMIT)
      assert.equal(wire[0], 0x81, 'v1 envelope: message first')
      const tx = VersionedTransaction.deserialize(wire)
      assert.equal(tx.message.version, 1)
      // the tail signature must verify over the serialized v1 message bytes
      const messageBytes = wire.slice(0, wire.length - 64)
      assert.ok(
        nacl.sign.detached.verify(messageBytes, tx.signatures[0]!, PAYER.publicKey.toBytes()),
        'the payer signature verifies over the v1 message',
      )
    })

    it('simulateAndSendTxs keeps using the v0 path when the tx fits the packet', async () => {
      const { connection, captured } = mockConnection()
      const signature = await simulateAndSendTxs({ connection }, wallet, {
        instructions: SMALL,
        mainIndex: 0,
      })
      assert.equal(signature, 'v0-signature')
      assert.equal(captured.sentWire, undefined, 'no raw v1 transaction was sent')
      assert.equal((captured.sentV0 as VersionedTransaction).message.version, 0)
    })
  })
})
