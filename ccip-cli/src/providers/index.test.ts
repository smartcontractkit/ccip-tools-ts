import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type ChainTransaction,
  CCIPRpcNotFoundError,
  CCIPTransactionNotFoundError,
  ChainFamily,
  networkInfo,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'

import { fetchChainsFromRpcs } from './index.ts'
import type { Ctx } from '../commands/index.ts'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const TX_HASH = '0x' + '1'.repeat(64)
const FAKE_TX: ChainTransaction = {
  hash: TX_HASH,
  logs: [],
  blockNumber: 1,
  timestamp: 1,
  from: '0x' + '0'.repeat(40),
}

/**
 * Temporarily replaces the entire supportedChains registry with the provided
 * fakes and returns a restore callback for use in finally blocks.
 *
 * Without this, Object.values(supportedChains).filter(C =\> C.isTxHash(...))
 * inside fetchChainsFromRpcs picks up every real family whose isTxHash matches
 * (APTOS, CANTON, SUI, TON all claim EVM-format hashes), causing their real
 * fromUrl implementations to race against our fakes with live network I/O.
 */
function setupSupportedChains(fakes: Record<string, unknown>): () => void {
  const sc = supportedChains as Record<string, unknown>
  const saved = Object.fromEntries(Object.entries(sc))
  for (const key of Object.keys(saved)) delete sc[key]
  Object.assign(sc, fakes)
  return () => {
    for (const key of Object.keys(sc)) delete sc[key]
    Object.assign(sc, saved)
  }
}

function makeCtx(): [Ctx, AbortController] {
  const ac = new AbortController()
  return [
    {
      abort: ac.signal,
      output: { write: () => {}, table: () => {} },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    },
    ac,
  ]
}

/**
 * Builds a configurable fake chain class whose per-URL behaviour is
 * controlled by callback parameters, and returns it alongside a stats
 * object that records connections, destructions and getTransaction calls.
 *
 * The returned `FakeChain` must be assigned to `supportedChains[family]`
 * (cast `as never`) inside a try/finally that restores the original.
 */
function makeChainClass({
  family,
  networkName,
  connectDelay = () => 0,
  connectReject = () => false,
  getTx = () => 'notfound',
  txDelay = () => 0,
}: {
  family: ChainFamily
  networkName: string
  /** Milliseconds before fromUrl resolves for a given url. */
  connectDelay?: (url: string) => number
  /** If true for a url, fromUrl rejects instead of resolving. */
  connectReject?: (url: string) => boolean
  /** Whether getTransaction succeeds ('found') or throws ('notfound'). */
  getTx?: (url: string) => 'found' | 'notfound'
  /** Extra delay (ms) before getTransaction settles. */
  txDelay?: (url: string) => number
}) {
  const stats = {
    connected: [] as string[],
    /** Urls whose destroy() was called (deduplicated to first call). */
    destroyed: [] as string[],
    txAttempted: [] as string[],
  }

  class FakeChain {
    static family = family
    static isTxHash = () => true

    network = networkInfo(networkName)
    url: string
    private _ac = new AbortController()
    abort = this._ac.signal
    destroy: () => void

    constructor(url: string) {
      this.url = url
      this.destroy = () => {
        if (!this._ac.signal.aborted) stats.destroyed.push(url)
        this._ac.abort()
      }
    }

    static async fromUrl(url: string, opts?: { abort?: AbortSignal }) {
      const ms = connectDelay(url)
      if (ms > 0) await delay(ms)
      if (connectReject(url)) throw new Error(`connection refused: ${url}`)
      const chain = new FakeChain(url)
      opts?.abort?.addEventListener('abort', () => chain.destroy(), { once: true })
      stats.connected.push(url)
      return chain
    }

    async getTransaction(hash: string): Promise<ChainTransaction> {
      stats.txAttempted.push(this.url)
      const ms = txDelay(this.url)
      if (ms > 0) await delay(ms)
      if (getTx(this.url) === 'notfound') throw new CCIPTransactionNotFoundError(hash)
      return FAKE_TX
    }
  }

  return { FakeChain: FakeChain as never, stats }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchChainsFromRpcs', () => {
  // -------------------------------------------------------------------------
  // Existing regression test (kept verbatim aside from the abort/destroy fix)
  // -------------------------------------------------------------------------

  it('lets duplicate tx-hash race endpoints query before aborting losers', async () => {
    const attempts: string[] = []
    const aborts: string[] = []
    const txHash = '0x'.padEnd(66, '1')

    class FakeEvmChain {
      static family = ChainFamily.EVM
      static isTxHash = () => true

      network = networkInfo('ethereum-testnet-sepolia')
      url = ''
      private _ac = new AbortController()
      abort = this._ac.signal
      destroy = () => this._ac.abort()

      constructor(url: string) {
        this.url = url
      }

      static async fromUrl(url: string, ctx?: { abort?: AbortSignal }) {
        ctx?.abort?.addEventListener('abort', () => aborts.push(url), { once: true })
        await new Promise((resolve) => setTimeout(resolve, url.includes('first') ? 0 : 10))
        const chain = new FakeEvmChain(url)
        ctx?.abort?.addEventListener('abort', () => chain.destroy(), { once: true })
        return chain
      }

      async getTransaction(hash: string): Promise<ChainTransaction> {
        attempts.push(this.url)
        if (!this.url.includes('second')) throw new CCIPTransactionNotFoundError(hash)
        return {
          hash,
          logs: [],
          blockNumber: 1,
          timestamp: 1,
          from: '0x0000000000000000000000000000000000000000',
        }
      }
    }

    const ac = new AbortController()
    const ctx: Ctx = {
      abort: ac.signal,
      output: { write: () => {}, table: () => {} },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeEvmChain })
    try {
      const [, tx$] = fetchChainsFromRpcs(
        ctx,
        { rpcs: ['http://first.example', 'http://second.example'], rpcsFile: '', api: false, cantonConfig: undefined },
        txHash,
      )

      const [chain, tx] = await tx$
      assert.equal((chain as unknown as FakeEvmChain).url, 'http://second.example')
      assert.equal(tx.hash, txHash)
      assert.deepEqual(attempts, ['http://first.example', 'http://second.example'])
    } finally {
      restore()
      ac.abort()
    }

    assert.ok(aborts.includes('http://first.example'))
  })

  // -------------------------------------------------------------------------
  // chainGetter — no txHash
  // -------------------------------------------------------------------------

  it('chainGetter: returns chain from first winning endpoint and destroys late arrivals', async () => {
    // fast.example wins the network race (Branch 1); slow.example arrives
    // afterwards and gets chain.destroy() via the !txHash branch.
    const { FakeChain, stats } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectDelay: (url) => (url.includes('slow') ? 30 : 0),
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const chainGetter = fetchChainsFromRpcs(ctx, {
        rpcs: ['http://fast.example', 'http://slow.example'],
        rpcsFile: '',
        api: false,
        cantonConfig: undefined,
      })
      const chain = await chainGetter('ethereum-testnet-sepolia')
      assert.equal(chain.network.name, 'ethereum-testnet-sepolia')
      assert.equal((chain as unknown as { url: string }).url, 'http://fast.example')
      // Give slow.example time to connect and be discarded
      await delay(50)
      assert.ok(
        stats.destroyed.includes('http://slow.example'),
        'loser is eagerly destroyed via !txHash branch',
      )
    } finally {
      restore()
      ac.abort()
    }
  })

  it('chainGetter: resolves a pending request once the endpoint connects (Branch 2)', async () => {
    // chainGetter is called before any chain has connected, creating a pending
    // entry in pendingChainsCbs. The chain resolves it via Branch 2.
    const { FakeChain, stats } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectDelay: () => 20,
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const chainGetter = fetchChainsFromRpcs(ctx, {
        rpcs: ['http://rpc.example'],
        rpcsFile: '',
        api: false,
        cantonConfig: undefined,
      })
      // Called synchronously — no chain has connected yet
      const chainPromise = chainGetter('ethereum-testnet-sepolia')
      assert.equal(stats.connected.length, 0, 'not connected at call time')
      const chain = await chainPromise
      assert.equal(stats.connected.length, 1, 'connected after await')
      assert.equal(chain.network.name, 'ethereum-testnet-sepolia')
    } finally {
      restore()
      ac.abort()
    }
  })

  it('chainGetter: rejects with CCIPRpcNotFoundError when all endpoints fail to connect', async () => {
    const { FakeChain } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectReject: () => true,
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const chainGetter = fetchChainsFromRpcs(ctx, {
        rpcs: ['http://bad1.example', 'http://bad2.example'],
        rpcsFile: '',
        api: false,
        cantonConfig: undefined,
      })
      await assert.rejects(chainGetter('ethereum-testnet-sepolia'), CCIPRpcNotFoundError)
    } finally {
      restore()
      ac.abort()
    }
  })

  it('chainGetter: rejects immediately with CCIPRpcNotFoundError once family is already exhausted', async () => {
    // After the first call exhausts the endpoint set and sets finished[F]=true,
    // a second call should hit the fast-path without making any new connections.
    const { FakeChain, stats } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectReject: () => true,
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const chainGetter = fetchChainsFromRpcs(ctx, {
        rpcs: ['http://bad.example'],
        rpcsFile: '',
        api: false,
        cantonConfig: undefined,
      })
      // First call drains the family
      await assert.rejects(chainGetter('ethereum-testnet-sepolia'), CCIPRpcNotFoundError)
      // Second call must use the finished[F] fast-path — no new connections
      const connectedBefore = stats.connected.length
      await assert.rejects(chainGetter('ethereum-testnet-sepolia'), CCIPRpcNotFoundError)
      assert.equal(stats.connected.length, connectedBefore, 'no new endpoints tried on second call')
    } finally {
      restore()
      ac.abort()
    }
  })

  // -------------------------------------------------------------------------
  // txHash search
  // -------------------------------------------------------------------------

  it('txHash: rejects with CCIPTransactionNotFoundError when tx not on any chain', async () => {
    const { FakeChain } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      // getTx defaults to 'notfound' for all urls
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const [, txResult] = fetchChainsFromRpcs(
        ctx,
        { rpcs: ['http://rpc1.example', 'http://rpc2.example'], rpcsFile: '', api: false, cantonConfig: undefined },
        TX_HASH,
      )
      await assert.rejects(txResult, CCIPTransactionNotFoundError)
    } finally {
      restore()
      ac.abort()
    }
  })

  it('txHash: Branch-4 (txOnlyRacer) is destroyed via catch when it loses the tx race', async () => {
    // a.example connects first → Branch 1 (network winner, finds tx after 10 ms).
    // b.example connects at 5 ms → Branch 4 (txOnlyRacers); its getTransaction
    // throws immediately, so the catch block destroys it before txResult resolves.
    const { FakeChain, stats } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectDelay: (url) => (url.includes('b.') ? 5 : 0),
      getTx: (url) => (url.includes('a.') ? 'found' : 'notfound'),
      txDelay: (url) => (url.includes('a.') ? 10 : 0),
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const [, txResult] = fetchChainsFromRpcs(
        ctx,
        { rpcs: ['http://a.example', 'http://b.example'], rpcsFile: '', api: false, cantonConfig: undefined },
        TX_HASH,
      )
      const [chain, tx] = await txResult
      assert.equal((chain as unknown as { url: string }).url, 'http://a.example')
      assert.equal(tx.hash, TX_HASH)
      // b.example's getTransaction failed → catch → destroy
      assert.ok(stats.destroyed.includes('http://b.example'), 'txOnlyRacer is eagerly destroyed')
      // b.example did attempt getTransaction (it connected before txFoundIn was set)
      assert.ok(
        stats.txAttempted.includes('http://b.example'),
        'txOnlyRacer did attempt getTransaction',
      )
    } finally {
      restore()
      ac.abort()
    }
  })

  it('txHash: chain connecting after txFoundIn is set is immediately destroyed without calling getTransaction', async () => {
    // a.example connects at T=0 and finds tx after 3 ms (txFoundIn set at ~T=3 ms).
    // b.example connects at T=15 ms → chain$.then sees txFoundIn set → Branch 3
    // destroy. chain.abort.throwIfAborted() then fires in the txs$ fn so
    // getTransaction is never reached.
    const { FakeChain, stats } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectDelay: (url) => (url.includes('b.') ? 15 : 0),
      getTx: (url) => (url.includes('a.') ? 'found' : 'notfound'),
      txDelay: () => 3,
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const [, txResult] = fetchChainsFromRpcs(
        ctx,
        { rpcs: ['http://a.example', 'http://b.example'], rpcsFile: '', api: false, cantonConfig: undefined },
        TX_HASH,
      )
      const [chain, tx] = await txResult
      assert.equal((chain as unknown as { url: string }).url, 'http://a.example')
      assert.equal(tx.hash, TX_HASH)
      // Wait for b.example to connect and be processed
      await delay(20)
      assert.ok(
        stats.destroyed.includes('http://b.example'),
        'late-arriving chain is immediately destroyed',
      )
      assert.ok(
        !stats.txAttempted.includes('http://b.example'),
        'late-arriving chain never calls getTransaction',
      )
    } finally {
      restore()
      ac.abort()
    }
  })

  it('txHash: Branch-2 chain given to a pending chainGetter is NOT destroyed when it cannot find the tx', async () => {
    // chainGetter(N) is called before any chain connects → pendingChainsCbs entry.
    // The single endpoint connects → Branch 2 (resolves the pending promise).
    // The same chain's getTransaction fails → catch: txOnlyRacers.has(chain) is
    // false (Branch 2 was never added), so destroy() must NOT be called.
    const { FakeChain, stats } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectDelay: () => 10,
      getTx: () => 'notfound',
    })
    const restore = setupSupportedChains({ [ChainFamily.EVM]: FakeChain })
    const [ctx, ac] = makeCtx()
    try {
      const [chainGetter, txResult] = fetchChainsFromRpcs(
        ctx,
        { rpcs: ['http://rpc.example'], rpcsFile: '', api: false, cantonConfig: undefined },
        TX_HASH,
      )
      // Call before chain connects → Branch 2 pending
      const chainPromise = chainGetter('ethereum-testnet-sepolia')
      // txResult will fail (tx not on this chain); chainPromise will succeed
      const [chain] = await Promise.all([
        chainPromise,
        txResult.catch((err) => {
          assert.ok(err instanceof CCIPTransactionNotFoundError)
          return null
        }),
      ])
      // Flush any remaining microtasks from the catch handler
      await delay(0)
      assert.equal(chain.network.name, 'ethereum-testnet-sepolia')
      assert.equal(
        stats.destroyed.length,
        0,
        'Branch-2 chain must not be destroyed before ctx.abort',
      )
    } finally {
      restore()
      ac.abort()
      await delay(0) // let ctx.abort propagate
      assert.equal(stats.destroyed.length, 1, 'chain is cleaned up after ctx.abort')
    }
  })

  it('txFoundIn shared across families: SVM txOnlyRacer is destroyed after EVM wins', async () => {
    // Both families search for the tx (isTxHash = true for both).
    // All three URLs are tried by both family factories (shared endpoints set).
    //
    // EVM factory:
    //   evm.example → connects fast, finds tx after 3 ms → txFoundIn set
    //   s1/s2       → connect at 50 ms (after txFoundIn) → Branch 3 immediate destroy
    //
    // SVM factory:
    //   s1.example  → connects fast → Branch 1 for solana-devnet
    //   s2.example  → connects at 20 ms → Branch 4 (txOnlyRacer)
    //                 txFoundIn is already set → early-exit → catch → destroy
    //   evm.example → connects at 50 ms (irrelevant, after everything settles)
    //
    // Key assertions: after EVM sets txFoundIn, s2's txs$ candidate sees it
    // immediately and destroys s2 without ever calling getTransaction.
    const { FakeChain: FakeEvmChain } = makeChainClass({
      family: ChainFamily.EVM,
      networkName: 'ethereum-testnet-sepolia',
      connectDelay: (url) => (url.includes('evm') ? 0 : 50),
      getTx: (url) => (url.includes('evm') ? 'found' : 'notfound'),
      txDelay: () => 3,
    })
    const { FakeChain: FakeSvmChain, stats: svmStats } = makeChainClass({
      family: ChainFamily.Solana,
      networkName: 'solana-devnet',
      connectDelay: (url) => (url.includes('s2') ? 20 : url.includes('evm') ? 50 : 0),
      getTx: () => 'notfound',
    })

    const restore = setupSupportedChains({
      [ChainFamily.EVM]: FakeEvmChain,
      [ChainFamily.Solana]: FakeSvmChain,
    })
    const [ctx, ac] = makeCtx()
    try {
      const [, txResult] = fetchChainsFromRpcs(
        ctx,
        {
          rpcs: ['http://evm.example', 'http://s1.example', 'http://s2.example'],
          rpcsFile: '',
          api: false,
          cantonConfig: undefined,
        },
        TX_HASH,
      )

      const [chain, tx] = await txResult
      assert.equal((chain as unknown as { url: string }).url, 'http://evm.example')
      assert.equal(tx.hash, TX_HASH)

      // Wait for s2 to connect at T=20 ms and be processed
      await delay(30)

      assert.ok(
        svmStats.destroyed.includes('http://s2.example'),
        'SVM txOnlyRacer is destroyed after EVM sets txFoundIn',
      )
      assert.ok(
        !svmStats.txAttempted.includes('http://s2.example'),
        'SVM txOnlyRacer never wastefully calls getTransaction',
      )
      assert.ok(
        !svmStats.destroyed.includes('http://s1.example'),
        'Branch-1 SVM chain (still useful) is not prematurely destroyed',
      )
    } finally {
      restore()
      ac.abort()
    }
  })
})
