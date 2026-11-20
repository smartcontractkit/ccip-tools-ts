import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js'

import { LOOKUP_TABLE_SLOT_MARGIN, recentLookupTableSlot } from './alt.ts'

const SYSVAR_OWNER = new PublicKey('Sysvar1111111111111111111111111111111111111')

/** SlotHashes data with `slots`, newest first. */
function slotHashes(slots: number[]): Buffer {
  const data = Buffer.alloc(8 + slots.length * 40)
  data.writeBigUInt64LE(BigInt(slots.length), 0)
  slots.forEach((slot, i) => data.writeBigUInt64LE(BigInt(slot), 8 + i * 40))
  return data
}

function connection(sysvar: { owner: PublicKey; data: Buffer } | null) {
  const reads: [string, string][] = []
  return {
    reads,
    getAccountInfo: async (address: PublicKey, commitment: 'confirmed') => {
      reads.push([address.toBase58(), commitment])
      return sysvar
    },
    getSlot: async () => 9_999,
  }
}

describe('recentLookupTableSlot (cct/solana)', () => {
  it('picks the SlotHashes entry the margin back from the newest', async () => {
    const slots = Array.from({ length: 100 }, (_, i) => 1_000 - i)
    const conn = connection({ owner: SYSVAR_OWNER, data: slotHashes(slots) })
    assert.equal(await recentLookupTableSlot(conn), 1_000 - LOOKUP_TABLE_SLOT_MARGIN)
    assert.deepEqual(conn.reads, [[SYSVAR_SLOT_HASHES_PUBKEY.toBase58(), 'confirmed']])
  })

  it('picks the oldest entry of a short history, as on a fresh fork', async () => {
    const conn = connection({ owner: SYSVAR_OWNER, data: slotHashes([505, 504, 502]) })
    assert.equal(await recentLookupTableSlot(conn), 502)
  })

  it('falls back to the finalized slot without a readable SlotHashes', async () => {
    for (const sysvar of [
      null,
      { owner: SYSVAR_OWNER, data: slotHashes([]) },
      { owner: PublicKey.default, data: slotHashes([1_000]) },
    ])
      assert.equal(await recentLookupTableSlot(connection(sysvar)), 9_999)
  })
})
