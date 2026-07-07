import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Message, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'

import { derivePda, serializeUnsignedSolanaTx } from './utils.ts'
import { CCIPCctParamsInvalidError } from '../../errors/index.ts'

const KEY = PublicKey.default
const connection = {
  getLatestBlockhash: async () => ({ blockhash: KEY.toBase58(), lastValidBlockHeight: 0 }),
}
const unsigned = {
  instructions: [
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.alloc(0),
    }),
  ],
}

describe('cct/solana utils', () => {
  it('derives PDAs from string and raw seeds', () => {
    assert.equal(derivePda('config', KEY).toBase58(), derivePda('config', KEY).toBase58())
    assert.notEqual(
      derivePda('config', KEY).toBase58(),
      derivePda('config', KEY, [KEY.toBuffer()]).toBase58(),
    )
  })

  it('serializes unsigned Solana txs as legacy messages in supported encodings', async () => {
    const base58 = await serializeUnsignedSolanaTx(connection, unsigned, KEY)
    const base64 = await serializeUnsignedSolanaTx(connection, unsigned, KEY, 'base64')
    const hex = await serializeUnsignedSolanaTx(connection, unsigned, KEY, 'hex')

    assert.ok(Message.from(bs58.decode(base58)))
    assert.ok(Message.from(Buffer.from(base64, 'base64')))
    assert.ok(Message.from(Buffer.from(hex, 'hex')))
  })

  it('rejects lookup tables for legacy message serialization', async () => {
    await assert.rejects(
      () =>
        serializeUnsignedSolanaTx(connection, { ...unsigned, lookupTables: [{} as never] }, KEY),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'serializeUnsignedTx' &&
        err.context.param === 'lookupTables',
    )
  })

  it('rejects unsupported transaction encodings', async () => {
    await assert.rejects(
      () => serializeUnsignedSolanaTx(connection, unsigned, KEY, 'base32' as never),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'serializeUnsignedTx' &&
        err.context.param === 'encoding',
    )
  })
})
