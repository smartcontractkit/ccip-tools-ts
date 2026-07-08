import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Message, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'

import { serializeUnsignedSolanaTx } from './serialize.ts'
import { CCTParamsInvalidError } from '../errors.ts'

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

describe('cct/solana serialize', () => {
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
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'serializeUnsignedTx' &&
        err.context.param === 'lookupTables',
    )
  })

  it('rejects unsupported transaction encodings', async () => {
    await assert.rejects(
      () => serializeUnsignedSolanaTx(connection, unsigned, KEY, 'base32'),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'serializeUnsignedTx' &&
        err.context.param === 'encoding',
    )
  })
})
