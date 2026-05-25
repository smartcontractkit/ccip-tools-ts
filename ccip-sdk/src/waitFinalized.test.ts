import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PickDeep } from 'type-fest'

import { type BlockInfo, type LogFilter, Chain } from './chain.ts'
import { CCIPTransactionNotFinalizedError, CCIPTransactionNotFoundError } from './errors/index.ts'
import { ChainFamily, networkInfo } from './networks.ts'
import { waitFinalized } from './requests.ts'
import type { CCIPRequest, ChainLog, ChainTransaction } from './types.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal log fixture for waitFinalized */
function makeLog(overrides: Partial<ChainLog> = {}): ChainLog {
  return {
    address: '0xOnRamp',
    blockNumber: 100,
    blockTimestamp: Math.floor(Date.now() / 1e3), // "just happened"
    transactionHash: '0xTxHash',
    topics: ['0xTopic0'],
    index: 0,
    data: '0x',
    ...overrides,
  }
}

/** Wrap a log into the shape expected by waitFinalized */
function makeRequest(
  log: ChainLog,
): PickDeep<
  CCIPRequest,
  `log.${'address' | 'blockNumber' | 'transactionHash' | 'topics' | 'blockTimestamp'}`
> {
  return { log }
}

// ---------------------------------------------------------------------------
// Mock chain with controllable getBlockInfo / getTransaction / getLogs
// ---------------------------------------------------------------------------

class WaitFinalizedMockChain extends Chain {
  static family = ChainFamily.EVM
  static decimals = 18 as const

  /** Sequence of values returned by successive getBlockInfo calls */
  blockInfoQueue: BlockInfo[] = []
  /** Default block info when queue is empty */
  defaultBlockInfo: BlockInfo = { number: 100, timestamp: 1_700_000_000 }

  /** If set, getTransaction returns this; if a function, it's called each time */
  txResult: ChainTransaction | ((hash: string) => ChainTransaction) | null = null
  /** If set, getTransaction throws this error */
  txError: Error | null = null

  /** Logs yielded by getLogs (watch mode will keep looping after these until aborted) */
  logsToYield: ChainLog[] = []

  constructor() {
    super(networkInfo(1))
  }

  async getBlockInfo(_block: number | 'finalized' | 'latest'): Promise<BlockInfo> {
    if (this.blockInfoQueue.length > 0) return this.blockInfoQueue.shift()!
    return this.defaultBlockInfo
  }

  async getTransaction(hash: string): Promise<ChainTransaction> {
    if (this.txError) throw this.txError
    if (typeof this.txResult === 'function') return this.txResult(hash)
    return (
      this.txResult ?? {
        hash,
        logs: [],
        blockNumber: 100,
        timestamp: 1_700_000_000,
        from: '0xSender',
      }
    )
  }

  async *getLogs(opts: LogFilter): AsyncIterableIterator<ChainLog> {
    for (const log of this.logsToYield) {
      yield log
    }
    // In watch mode, hang until the watch signal aborts
    if (opts.watch) {
      const signal = opts.watch instanceof AbortSignal ? opts.watch : this.abort
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) return reject(signal.reason as Error)
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
      }).catch(() => {})
    }
  }

  // -- stubs for remaining abstract methods (unused by waitFinalized) --
  async typeAndVersion(_a: string) {
    return ['Test', '1.0', 'Test 1.0'] as [string, string, string]
  }
  async getOnRampConfig(_a: string, _b: bigint): Promise<any> {
    return {}
  }
  async getOffRampConfig(_a: string, _b: bigint): Promise<any> {
    return {}
  }
  async getNativeTokenForRouter(_a: string) {
    return '0x0'
  }
  async getOffRampsForRouter(_a: string, _b: bigint) {
    return [] as string[]
  }
  async getOnRampForRouter(_a: string, _b: bigint) {
    return '0x0'
  }
  async getSupportedTokens() {
    return [] as string[]
  }
  async getRegistryTokenConfig(): Promise<any> {
    return {}
  }
  async getTokenPoolConfig(): Promise<any> {
    return { token: '0x', router: '0x' }
  }
  async getTokenPoolRemotes(): Promise<any> {
    return {}
  }
  async getTokenForTokenPool() {
    return '0x'
  }
  async getTokenInfo() {
    return { symbol: 'T', decimals: 18 }
  }
  async getBalance() {
    return 0n
  }
  async getTokenAdminRegistryFor() {
    return '0x'
  }
  async getFee() {
    return 0n
  }
  async getFeeTokens() {
    return {}
  }
  async generateUnsignedSendMessage(): Promise<never> {
    throw new Error('not implemented')
  }
  async sendMessage(): Promise<never> {
    throw new Error('not implemented')
  }
  async generateUnsignedExecute(): Promise<never> {
    throw new Error('not implemented')
  }
  async execute(): Promise<never> {
    throw new Error('not implemented')
  }
  static decodeMessage() {
    return undefined
  }
  static decodeExtraArgs() {
    return undefined
  }
  static encodeExtraArgs() {
    return ''
  }
  static decodeCommits() {
    return undefined
  }
  static decodeReceipt() {
    return undefined
  }
  static getAddress(b: any) {
    return String(b)
  }
  static isTxHash() {
    return true
  }
  static getDestLeafHasher(): any {
    return () => ''
  }
  override async getMessagesInBatch(): Promise<any[]> {
    return []
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('waitFinalized', () => {
  it('fast-path: returns true when tx timestamp <= finalized timestamp (old log)', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({
      blockTimestamp: Math.floor(Date.now() / 1e3) - 120, // 2 min ago, >60s
    })
    // tx.timestamp (1_700_000_000) <= finalized.timestamp (1_700_000_000)
    chain.defaultBlockInfo = { number: 200, timestamp: 1_700_000_000 }
    chain.txResult = {
      hash: log.transactionHash,
      logs: [],
      blockNumber: 100,
      timestamp: 1_700_000_000,
      from: '0xSender',
    }

    const result = await chain.waitFinalized({ request: makeRequest(log) })
    assert.equal(typeof result.number, 'number')
    assert.equal(typeof result.timestamp, 'number')
    chain.destroy()
  })

  it('fast-path: skipped when log is recent (<60s)', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({
      blockTimestamp: Math.floor(Date.now() / 1e3) - 10, // 10s ago
    })
    // getLogs will yield the matching tx, so it still succeeds
    chain.logsToYield = [log]

    const result = await chain.waitFinalized({ request: makeRequest(log) })
    assert.equal(typeof result.number, 'number')
    chain.destroy()
  })

  it('getLogs watch: returns BlockInfo when matching log appears', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog()
    // Keep finalized behind so fast-path doesn't trigger and poller doesn't fire
    chain.defaultBlockInfo = { number: 100, timestamp: 1_700_000_000 }
    chain.txResult = {
      hash: log.transactionHash,
      logs: [],
      blockNumber: 100,
      timestamp: 1_700_000_100, // newer than finalized
      from: '0xSender',
    }
    chain.logsToYield = [log] // getLogs yields the matching log

    const result = await chain.waitFinalized({ request: makeRequest(log) })
    assert.equal(typeof result.number, 'number')
    chain.destroy()
  })

  it('throws when getLogs yields a log at a later block without matching tx', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({ blockNumber: 100 })
    chain.defaultBlockInfo = { number: 100, timestamp: 1_700_000_000 }
    chain.txResult = {
      hash: log.transactionHash,
      logs: [],
      blockNumber: 100,
      timestamp: 1_700_000_100,
      from: '0xSender',
    }
    // getLogs yields a different log at a later block
    chain.logsToYield = [
      makeLog({
        transactionHash: '0xOtherTx',
        blockNumber: 101,
      }),
    ]

    await assert.rejects(
      () => chain.waitFinalized({ request: makeRequest(log) }),
      CCIPTransactionNotFinalizedError,
    )
    chain.destroy()
  })

  it('block-height poller throws when tx eventually disappears after deadline', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({ blockNumber: 100 })
    // Poll 1: finalized=200 → firstFinalized=200, tx found (txCallCount=1)
    // Poll 2: finalized=201 → tx throws, 201 > max(200,102) → true → abort
    chain.blockInfoQueue = [
      { number: 200, timestamp: 1_700_000_000 },
      { number: 201, timestamp: 1_700_000_001 },
    ]
    chain.defaultBlockInfo = { number: 201, timestamp: 1_700_000_001 }
    // getTransaction returns tx at same blockNumber once, then throws
    let txCallCount = 0
    chain.txResult = (hash: string) => {
      txCallCount++
      if (txCallCount >= 2) throw new CCIPTransactionNotFoundError(hash)
      return {
        hash,
        logs: [],
        blockNumber: 100,
        timestamp: 1_700_000_100,
        from: '0xSender',
      }
    }
    // no matching logs — getLogs will hang in watch mode until poller aborts
    chain.logsToYield = []

    await assert.rejects(
      () =>
        chain.waitFinalized({
          request: makeRequest(log),
          reorgSafetyBlocks: 3,
          pollIntervalMs: 10,
        }),
      CCIPTransactionNotFinalizedError,
    )
    assert.ok(txCallCount >= 2, 'getTransaction should have been called multiple times')
    chain.destroy()
  })

  it('block-height poller throws when tx is not found (reorged out)', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({ blockNumber: 100 })
    // Poll 1: finalized=200 → firstFinalized=200, tx throws, 200 > max(200,102) → false (need NEW block)
    // Poll 2: finalized=201 → tx throws, 201 > max(200,102) → true → abort
    chain.blockInfoQueue = [
      { number: 200, timestamp: 1_700_000_000 },
      { number: 201, timestamp: 1_700_000_001 },
    ]
    chain.defaultBlockInfo = { number: 201, timestamp: 1_700_000_001 }
    // getTransaction throws — tx gone
    chain.txError = new CCIPTransactionNotFoundError(log.transactionHash)
    chain.logsToYield = []

    await assert.rejects(
      () =>
        chain.waitFinalized({
          request: makeRequest(log),
          reorgSafetyBlocks: 3,
          pollIntervalMs: 10,
        }),
      CCIPTransactionNotFinalizedError,
    )
    chain.destroy()
  })

  it('block-height poller extends deadline when tx moves to a later block', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({ blockNumber: 100 })

    // First poll: finalized=113 → deadline reached (100+3=103).
    // getTransaction returns tx at block 200 → deadline slides to 200+3=203.
    // Second poll: finalized=150 → still under 203, so wait.
    // getLogs yields the matching log on second iteration → success
    chain.blockInfoQueue = [
      { number: 113, timestamp: 1_700_000_100 }, // triggers deadline check
      { number: 150, timestamp: 1_700_000_200 }, // under new deadline (203)
    ]
    // Keep returning a high default so poller doesn't re-trigger before getLogs wins
    chain.defaultBlockInfo = { number: 150, timestamp: 1_700_000_200 }

    let txCallCount = 0
    chain.txResult = (hash: string) => {
      txCallCount++
      // First call from deadline check: tx reorged to block 200
      return {
        hash,
        logs: [],
        blockNumber: 200,
        timestamp: 1_700_000_100,
        from: '0xSender',
      }
    }

    // getLogs yields the matching log (simulating it appearing in finalized set)
    chain.logsToYield = [log]

    const result = await chain.waitFinalized({
      request: makeRequest(log),
      reorgSafetyBlocks: 3,
    })
    assert.equal(typeof result.number, 'number')
    assert.ok(txCallCount >= 1, 'getTransaction should have been called for reorg check')
    chain.destroy()
  })

  it('respects abort signal', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({ blockNumber: 100 })
    // Keep finalized behind so poller never fires
    chain.defaultBlockInfo = { number: 100, timestamp: 1_700_000_000 }
    chain.txResult = {
      hash: log.transactionHash,
      logs: [],
      blockNumber: 100,
      timestamp: 1_700_000_100,
      from: '0xSender',
    }
    // No matching logs — will hang in watch mode
    chain.logsToYield = []

    const ac = new AbortController()
    // Abort after a short delay
    setTimeout(() => ac.abort(), 50)

    // Should exit without hanging; the abort causes the watch loop to end,
    // and since no match was found, it throws NotFinalized
    await assert.rejects(
      () =>
        chain.waitFinalized({
          request: makeRequest(log),
          abort: ac.signal,
        }),
      CCIPTransactionNotFinalizedError,
    )
    chain.destroy()
  })

  it('fast-path: does not return true when tx is newer than finalized', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({
      blockTimestamp: Math.floor(Date.now() / 1e3) - 120, // old enough for fast-path
    })
    // tx is newer than finalized → fast-path should not short-circuit
    chain.defaultBlockInfo = { number: 200, timestamp: 1_699_999_000 }
    chain.txResult = {
      hash: log.transactionHash,
      logs: [],
      blockNumber: 100,
      timestamp: 1_700_000_000, // > finalized.timestamp
      from: '0xSender',
    }
    // getLogs yields matching log so it eventually succeeds
    chain.logsToYield = [log]

    const result = await chain.waitFinalized({ request: makeRequest(log) })
    assert.equal(typeof result.number, 'number')
    chain.destroy()
  })

  it('standalone function returns BlockInfo directly', async () => {
    const chain = new WaitFinalizedMockChain()
    const log = makeLog({
      blockTimestamp: Math.floor(Date.now() / 1e3) - 120,
    })
    chain.defaultBlockInfo = { number: 200, timestamp: 1_700_000_000 }
    chain.txResult = {
      hash: log.transactionHash,
      logs: [],
      blockNumber: 100,
      timestamp: 1_700_000_000,
      from: '0xSender',
    }

    const result = await waitFinalized(chain, { request: makeRequest(log) })
    assert.equal(result.number, 200)
    assert.equal(result.timestamp, 1_700_000_000)
    chain.destroy()
  })
})
