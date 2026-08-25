import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TonClient } from '@ton/ton'

import { BoundedStringCache, boundTonClientCaches } from './ton-cache.ts'

describe('BoundedStringCache', () => {
  it('stores and retrieves by namespace+key; null deletes', async () => {
    const c = new BoundedStringCache()
    await c.set('ns', 'a', '1')
    assert.equal(await c.get('ns', 'a'), '1')
    assert.equal(await c.get('ns', 'b'), null)
    assert.equal(await c.get('other', 'a'), null)
    await c.set('ns', 'a', null)
    assert.equal(await c.get('ns', 'a'), null)
    assert.equal(c.size, 0)
  })

  it('evicts the oldest entries once maxEntries is exceeded', async () => {
    const c = new BoundedStringCache({ maxEntries: 3 })
    await c.set('n', 'k1', 'v') // byte-accounting disabled de-facto by huge byte cap
    await c.set('n', 'k2', 'v')
    await c.set('n', 'k3', 'v')
    await c.set('n', 'k4', 'v')
    assert.equal(await c.get('n', 'k1'), null)
    assert.equal(await c.get('n', 'k2'), 'v')
    assert.equal(c.size, 3)
  })

  it('get refreshes recency so hot entries outlive cold ones', async () => {
    const c = new BoundedStringCache({ maxEntries: 2 })
    await c.set('n', 'k1', 'v1')
    await c.set('n', 'k2', 'v2')
    assert.equal(await c.get('n', 'k1'), 'v1') // k1 becomes most recent
    await c.set('n', 'k3', 'v3') // evicts k2
    assert.equal(await c.get('n', 'k2'), null)
    assert.equal(await c.get('n', 'k1'), 'v1')
    assert.equal(await c.get('n', 'k3'), 'v3')
  })

  it('evicts the oldest entries once maxBytes is exceeded', async () => {
    const c = new BoundedStringCache({ maxBytes: 128 })
    // each entry: key 'n$$k#' + 20-byte value => (5 + 20) * 2 = 50 bytes
    await c.set('n', 'k1', 'x'.repeat(20))
    await c.set('n', 'k2', 'x'.repeat(20))
    await c.set('n', 'k3', 'x'.repeat(20)) // 150 > 128 -> evicts oldest
    assert.equal(await c.get('n', 'k1'), null)
    assert.equal(await c.get('n', 'k2'), 'x'.repeat(20))
    assert.equal(await c.get('n', 'k3'), 'x'.repeat(20))
    assert.equal(c.size, 2)
  })

  it('re-set of an existing key stays within the byte budget', async () => {
    const c = new BoundedStringCache({ maxBytes: 60 })
    await c.set('n', 'k1', 'x'.repeat(20)) // (4 + 20) * 2 = 48 bytes
    await c.set('n', 'k1', 'y'.repeat(20)) // replaces, not duplicates
    assert.equal(c.size, 1)
    assert.equal(await c.get('n', 'k1'), 'y'.repeat(20))
  })
})

describe('boundTonClientCaches', () => {
  it('re-points the TonClient HttpApi TypedCaches at bounded stores', async () => {
    // Constructor makes no network calls; we only touch its runtime internals.
    const client = new TonClient({ endpoint: 'https://invalid.example/jsonRPC' })

    boundTonClientCaches(client)

    const api = (
      client as unknown as {
        api?: {
          shardCache?: { cache: unknown; set(key: unknown, value: unknown): Promise<void> }
          shardTransactionsCache?: { cache: unknown }
        }
      }
    ).api
    assert.ok(api, 'TonClient exposes HttpApi at runtime')
    const shard = api.shardCache
    const shardTx = api.shardTransactionsCache
    assert.ok(shard && shardTx, 'TonClient exposes its TypedCaches at runtime')
    assert.ok(shard.cache instanceof BoundedStringCache)
    assert.ok(shardTx.cache instanceof BoundedStringCache)

    // TypedCache dispatches through its backing on every call: a set lands in
    // the bounded store keyed `ton-shard$$<seqno>`, proving the swap worked end
    // to end without depending on `@ton/ton` internals beyond those two fields.
    const backing = shard.cache
    await shard.set(123, [
      {
        '@type': 'ton.blockIdExt',
        workchain: 0,
        shard: '-9223372036854775808',
        seqno: 123,
        rootHash: '0'.repeat(64),
        fileHash: '0'.repeat(64),
      },
    ])
    const stored = await backing.get('ton-shard', '123')
    assert.ok(stored !== null && stored.startsWith('['))
    assert.equal(backing.size, 1)
  })
})
