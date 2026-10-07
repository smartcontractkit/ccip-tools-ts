/**
 * Nonce reservations must account for mempool txs, stay distinct under concurrency, cost no RPC
 * within a burst, and a failed reservation must never make a later (possibly broadcast) nonce
 * reusable, nor its own nonce while the network may still hold its tx.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type JsonRpcApiProvider, type Signer, keccak256, makeError } from 'ethers'

import { networkInfo } from '../networks.ts'
import { EVMChain, submitTransaction } from './index.ts'

const ADDR = '0x' + '55'.repeat(20)

/** Chain whose provider reports `state.pending` as the pending tx count. */
function stubChain(pending = 0, nonceCacheTtlMs?: number) {
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
  if (nonceCacheTtlMs != null) chain.nonceCacheTtlMs = nonceCacheTtlMs
  return { chain, state }
}

describe('EVMChain nonce allocation', () => {
  it('reads the pending transaction count once per burst', async () => {
    const { chain, state } = stubChain(3)
    const burst = await Promise.all([1, 2].map(() => chain.nextNonce(ADDR)))
    assert.deepEqual([...burst, await chain.nextNonce(ADDR)], [3, 4, 5])
    assert.deepEqual(state.tags, ['pending'])
  })

  it('does not reuse a nonce taken by an external pending tx once the cache expires', async () => {
    const { chain, state } = stubChain(0, 0)
    for (let i = 0; i < 3; i++) {
      assert.equal(await chain.nextNonce(ADDR), i)
      state.pending = i + 1
    }
    state.pending = 5 // two txs sent outside the SDK are now in the mempool
    assert.equal(await chain.nextNonce(ADDR), 5)
  })

  it('never moves back on a lagging pending count', async () => {
    const { chain } = stubChain(0, 0) // pending never advances
    assert.deepEqual(
      [await chain.nextNonce(ADDR), await chain.nextNonce(ADDR), await chain.nextNonce(ADDR)],
      [0, 1, 2],
    )
  })

  it('hands distinct, consecutive nonces to concurrent reservations', async () => {
    const { chain } = stubChain(7, 0)
    const nonces = await Promise.all([1, 2, 3].map(() => chain.nextNonce(ADDR)))
    assert.deepEqual(nonces, [7, 8, 9])
  })

  it('retries the pending count read after it fails', async () => {
    const { chain, state } = stubChain(2)
    const read = chain.provider.getTransactionCount.bind(chain.provider)
    chain.provider.getTransactionCount = () => Promise.reject(new Error('rpc down'))
    await assert.rejects(() => chain.nextNonce(ADDR), /rpc down/)
    chain.provider.getTransactionCount = read
    assert.equal(await chain.nextNonce(ADDR), 2)
    assert.deepEqual(state.tags, ['pending'])
  })

  it('failing N after N+1 was broadcast never re-issues N+1', async () => {
    const { chain, state } = stubChain(0, 0)
    const [a, b] = await Promise.all([chain.nextNonce(ADDR), chain.nextNonce(ADDR)])
    assert.deepEqual([a, b], [0, 1])
    // B broadcast nonce 1; it is queued behind the gap, so pending stays 0
    chain.rollbackNonce(ADDR, a, new Error('signer refused'))
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

  it('rolls back the latest nonce when none is given', async () => {
    const { chain } = stubChain()
    await chain.nextNonce(ADDR)
    chain.rollbackNonce(ADDR)
    assert.equal(await chain.nextNonce(ADDR), 0)
  })

  it('drops a released nonce the network has since consumed', async () => {
    const { chain, state } = stubChain(0, 0)
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

  describe('after an inconclusive failure', () => {
    const timeout = () => makeError('timeout', 'TIMEOUT')

    it('keeps the nonce while the cache is fresh', async () => {
      const { chain } = stubChain()
      const n = await chain.nextNonce(ADDR)
      chain.rollbackNonce(ADDR, n, timeout())
      assert.equal(await chain.nextNonce(ADDR), 1)
    })

    it('keeps the nonce once the network has it', async () => {
      const { chain, state } = stubChain(0, 0)
      const n = await chain.nextNonce(ADDR)
      chain.rollbackNonce(ADDR, n, timeout())
      state.pending = 1 // it did land
      assert.equal(await chain.nextNonce(ADDR), 1)
      state.pending = 2
      assert.equal(await chain.nextNonce(ADDR), 2)
    })

    it('releases the nonce when it is still the network next nonce on a later read', async () => {
      const { chain } = stubChain(0, 0) // pending stays 0: tx dropped (or never sent)
      const [a, b] = await Promise.all([chain.nextNonce(ADDR), chain.nextNonce(ADDR)])
      chain.rollbackNonce(ADDR, a, timeout())
      chain.rollbackNonce(ADDR, b, timeout())
      assert.equal(await chain.nextNonce(ADDR), 0, 'the gap is filled')
      assert.equal(await chain.nextNonce(ADDR), 2, 'b waits until it is the next nonce')
    })

    it('treats "already known" as possibly broadcast', async () => {
      const { chain } = stubChain()
      const n = await chain.nextNonce(ADDR)
      chain.rollbackNonce(ADDR, n, new Error('could not coalesce error ("already known")'))
      assert.equal(await chain.nextNonce(ADDR), 1)
    })
  })

  it('re-reads the pending count after a nonce conflict, without releasing', async () => {
    const { chain, state } = stubChain()
    const n = await chain.nextNonce(ADDR)
    state.pending = 4 // external txs took nonces 0..3
    chain.rollbackNonce(ADDR, n, makeError('nonce too low', 'NONCE_EXPIRED'))
    assert.equal(await chain.nextNonce(ADDR), 4)
    assert.deepEqual(state.tags, ['pending', 'pending'])
  })

  it('does not release the nonce of a mined (reverted) tx', async () => {
    const { chain } = stubChain()
    await chain.nextNonce(ADDR)
    await chain.nextNonce(ADDR)
    chain.rollbackNonce(
      ADDR,
      0,
      Object.assign(makeError('reverted', 'CALL_EXCEPTION'), { receipt: {} }),
    )
    assert.equal(await chain.nextNonce(ADDR), 2)
  })
})

describe('submitTransaction', () => {
  const SIGNED = '0x02f0'
  const HASH = keccak256(SIGNED)

  function stubProvider(opts: { known?: boolean; broadcastError?: Error } = {}) {
    const calls = { broadcast: 0 }
    const provider = {
      broadcastTransaction: () => {
        calls.broadcast++
        return opts.broadcastError
          ? Promise.reject(opts.broadcastError)
          : Promise.resolve({ hash: HASH })
      },
      getTransaction: (hash: string) =>
        Promise.resolve(opts.known && hash === HASH ? { hash } : null),
    } as unknown as JsonRpcApiProvider
    return { provider, calls }
  }

  function stubWallet(sendError: Error, signError?: Error) {
    const calls = { signed: 0 }
    const wallet = {
      sendTransaction: () => Promise.reject(sendError),
      signTransaction: () => {
        calls.signed++
        return signError ? Promise.reject(signError) : Promise.resolve(SIGNED)
      },
    } as unknown as Signer
    return { wallet, calls }
  }

  it('does not fall back to signing after the user rejects', async () => {
    const { wallet, calls } = stubWallet(makeError('rejected', 'ACTION_REJECTED'))
    await assert.rejects(
      () => submitTransaction(wallet, {}, stubProvider().provider),
      (err: unknown) => (err as { code?: string }).code === 'ACTION_REJECTED',
    )
    assert.equal(calls.signed, 0)
  })

  it('re-broadcasts after an inconclusive send', async () => {
    const { wallet } = stubWallet(makeError('timeout', 'TIMEOUT'))
    const { provider, calls } = stubProvider()
    assert.equal((await submitTransaction(wallet, {}, provider)).hash, HASH)
    assert.equal(calls.broadcast, 1)
  })

  it('returns the tx the node already has', async () => {
    const { wallet } = stubWallet(makeError('timeout', 'TIMEOUT'))
    const { provider } = stubProvider({
      known: true,
      broadcastError: new Error('already known'),
    })
    assert.equal((await submitTransaction(wallet, {}, provider)).hash, HASH)
  })

  it('surfaces the inconclusive send error when the signer cannot sign alone', async () => {
    const { wallet } = stubWallet(makeError('timeout', 'TIMEOUT'), new Error('unsupported'))
    await assert.rejects(
      () => submitTransaction(wallet, {}, stubProvider().provider),
      (err: unknown) => (err as { code?: string }).code === 'TIMEOUT',
    )
  })
})
