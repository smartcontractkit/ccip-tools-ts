/**
 * Nonce reservations must account for mempool txs, stay distinct under concurrency,
 * and a failed reservation must never make a later (possibly broadcast) nonce reusable.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { JsonRpcApiProvider } from 'ethers'

import { networkInfo } from '../networks.ts'
import { EVMChain } from './index.ts'

const ADDR = '0x' + '55'.repeat(20)

/** Chain whose provider reports `state.pending` as the pending tx count. */
function stubChain(pending = 0) {
  const state = { pending, tags: [] as unknown[] }
  const provider = {
    destroy: () => {},
    _getConnection: () => ({ url: 'http://stub.invalid' }),
    getTransactionCount: (_address: string, tag?: unknown) => {
      state.tags.push(tag)
      return Promise.resolve(state.pending)
    },
  } as unknown as JsonRpcApiProvider
  const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
  return { chain, state }
}

describe('EVMChain nonce allocation', () => {
  it('reads the pending transaction count', async () => {
    const { chain, state } = stubChain(3)
    assert.equal(await chain.nextNonce(ADDR), 3)
    assert.deepEqual(state.tags, ['pending'])
  })

  it('does not reuse a nonce taken by an external pending tx', async () => {
    const { chain, state } = stubChain()
    for (let i = 0; i < 3; i++) {
      assert.equal(await chain.nextNonce(ADDR), i)
      state.pending = i + 1
    }
    state.pending = 5 // two txs sent outside the SDK are now in the mempool
    assert.equal(await chain.nextNonce(ADDR), 5)
  })

  it('keeps sequential behavior unchanged, even with a lagging pending count', async () => {
    const { chain } = stubChain() // pending never advances
    assert.deepEqual(
      [await chain.nextNonce(ADDR), await chain.nextNonce(ADDR), await chain.nextNonce(ADDR)],
      [0, 1, 2],
    )
  })

  it('hands distinct, consecutive nonces to concurrent reservations', async () => {
    const { chain } = stubChain(7)
    const nonces = await Promise.all([1, 2, 3].map(() => chain.nextNonce(ADDR)))
    assert.deepEqual(nonces, [7, 8, 9])
  })

  it('failing N after N+1 was broadcast never re-issues N+1', async () => {
    const { chain, state } = stubChain()
    const [a, b] = await Promise.all([chain.nextNonce(ADDR), chain.nextNonce(ADDR)])
    assert.deepEqual([a, b], [0, 1])
    // B broadcast nonce 1; it is queued behind the gap, so pending stays 0
    chain.rollbackNonce(ADDR, a)
    assert.equal(await chain.nextNonce(ADDR), 0, 'the released nonce fills the gap')
    state.pending = 2 // gap filled, B executable
    assert.equal(await chain.nextNonce(ADDR), 2)
  })

  it('reuses a rolled-back latest nonce, collapsing released ones below it', async () => {
    const { chain } = stubChain()
    const [a, b] = await Promise.all([chain.nextNonce(ADDR), chain.nextNonce(ADDR)])
    chain.rollbackNonce(ADDR, a) // not the latest: kept aside
    chain.rollbackNonce(ADDR, b) // latest: counter steps back past both
    assert.deepEqual(chain.nonces[ADDR], 0)
    assert.deepEqual([await chain.nextNonce(ADDR), await chain.nextNonce(ADDR)], [0, 1])
  })

  it('drops a released nonce the network has since consumed', async () => {
    const { chain, state } = stubChain()
    const [a] = await Promise.all([chain.nextNonce(ADDR), chain.nextNonce(ADDR)])
    chain.rollbackNonce(ADDR, a)
    state.pending = 2 // nonce 0 was filled externally
    assert.equal(await chain.nextNonce(ADDR), 2)
  })

  it('ignores rollback of a nonce it never reserved', async () => {
    const { chain } = stubChain()
    chain.rollbackNonce(ADDR, 0) // uncached
    assert.equal(await chain.nextNonce(ADDR), 0)
    chain.rollbackNonce(ADDR, 5) // above the counter
    assert.equal(await chain.nextNonce(ADDR), 1)
  })
})
