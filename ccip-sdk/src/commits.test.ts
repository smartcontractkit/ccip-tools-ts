import './index.ts' // Register supported chains
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'
import type { PickDeep } from 'type-fest'

import { Chain } from './chain.ts'
import { fetchCommitReport } from './commits.ts'
import CommitStore_1_2_ABI from './evm/abi/CommitStore_1_2.ts'
import OffRamp_1_6_ABI from './evm/abi/OffRamp_1_6.ts'
import {
  type AnyMessage,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionReport,
  type ExecutionState,
  type Lane,
  type Log_,
  CCIPVersion,
  ChainFamily,
} from './types.ts'
import { networkInfo } from './utils.ts'

// Mock Chain class for testing
class MockChain extends Chain {
  static family = ChainFamily.EVM
  private mockTypeAndVersion: string
  private mockLogs: Log_[] = []
  private mockBlockTimestamp = 1700000000

  constructor(chainId: number, typeAndVersion: string = 'EVM2EVMOffRamp 1.5.0') {
    super(networkInfo(chainId))
    this.mockTypeAndVersion = typeAndVersion
  }

  setLogs(logs: Log_[]) {
    this.mockLogs = logs
  }

  async getBlockTimestamp(_block: number | 'finalized'): Promise<number> {
    return this.mockBlockTimestamp
  }

  async getTransaction(_hash: string): Promise<ChainTransaction> {
    return {
      hash: _hash,
      logs: this.mockLogs,
      blockNumber: 1000,
      timestamp: this.mockBlockTimestamp,
      from: '0xSender',
    }
  }

  override async fetchRequestsInTx(_tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return []
  }

  override async fetchAllMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    _request: R,
    _commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    _opts?: { page?: number },
  ): Promise<R['message'][]> {
    return []
  }

  async *getLogs(opts: {
    startBlock?: number
    startTime?: number
    endBlock?: number
    address?: string
    topics?: string[] | string[][]
    page?: number
  }): AsyncIterableIterator<Log_> {
    for (const log of this.mockLogs) {
      // Filter by address if specified
      if (opts.address && log.address !== opts.address) {
        continue
      }
      // Filter by topics if specified - topics can be event names or topic hashes
      // For simplicity in tests, we just check if the log has any topics and yield it
      // Real implementation would check topic0 matches
      if (opts.topics && log.topics && log.topics.length > 0) {
        // If topics filter is provided, just yield the log (simplified for mock)
        // In a real implementation, this would check if log.topics[0] matches one of the requested topics
        yield log
      } else if (!opts.topics) {
        yield log
      }
    }
  }

  async typeAndVersion(_address: string): Promise<[string, string, string]> {
    const parts = this.mockTypeAndVersion.split(' ')
    return [parts[0], parts[1], this.mockTypeAndVersion]
  }

  async getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    return '0xRouter'
  }

  async getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return '0xRouter'
  }

  async getNativeTokenForRouter(_router: string): Promise<string> {
    return '0xNativeToken'
  }

  async getOffRampsForRouter(_router: string, _chainSelector: bigint): Promise<string[]> {
    return []
  }

  async getOnRampForOffRamp(_offRamp: string, _chainSelector: bigint): Promise<string> {
    return '0xOnRamp'
  }

  async getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    return '0xOnRamp'
  }

  async getCommitStoreForOffRamp(_offRamp: string): Promise<string> {
    return '0xCommitStore'
  }

  async getSupportedTokens(_address: string, _opts?: { page?: number }): Promise<string[]> {
    return []
  }

  async getRegistryTokenConfig(_registry: string, _token: string): Promise<any> {
    return {}
  }

  async getTokenPoolConfigs(_tokenPool: string): Promise<{
    token: string
    router: string
    typeAndVersion?: string
  }> {
    return { token: '0xToken', router: '0xRouter', typeAndVersion: 'TokenPool 1.5.0' }
  }

  async getTokenPoolRemotes(_pool: string, _remoteChainSelector: bigint): Promise<any> {
    return { remoteToken: '0xRemoteToken', remotePools: [] }
  }

  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return '0xToken'
  }

  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number; name?: string }> {
    return { symbol: 'TST', decimals: 18, name: 'Test Token' }
  }

  async getTokenAdminRegistryFor(_address: string): Promise<string> {
    return '0xTokenAdminRegistry'
  }

  async getFee(_router: string, _destChainSelector: bigint, _message: any): Promise<bigint> {
    return 1000n
  }

  async getFeeTokens() {
    return {}
  }

  generateUnsignedSendMessage(
    _sender: string,
    _router: string,
    _destChainSelector: bigint,
    _message: AnyMessage & { fee?: bigint },
    _opts?: { approveMax?: boolean },
  ): Promise<never> {
    return Promise.reject(new Error('not implemented'))
  }

  async sendMessage(
    _router: string,
    _destChainSelector: bigint,
    _message: any,
    _opts?: { wallet?: unknown; approveMax?: boolean },
  ): Promise<CCIPRequest> {
    return Promise.reject(new Error('not implemented'))
  }

  async fetchOffchainTokenData(_request: CCIPRequest): Promise<any[]> {
    return []
  }

  override generateUnsignedExecuteReport(
    _payer: string,
    _offRamp: string,
    _execReport: ExecutionReport,
    _opts: object,
  ): Promise<never> {
    return Promise.reject(new Error('not implemented'))
  }

  async executeReport(
    _offRamp: string,
    _execReport: any,
    _opts?: Record<string, unknown>,
  ): Promise<ChainTransaction> {
    return {
      hash: '0xHash',
      logs: [],
      blockNumber: 1000,
      timestamp: this.mockBlockTimestamp,
      from: '0xSender',
    }
  }

  static decodeMessage(_log: Log_): CCIPMessage | undefined {
    return undefined
  }

  static decodeCommits(log: Log_, lane?: Lane): CommitReport[] | undefined {
    const ifaceCommitStore = new Interface(CommitStore_1_2_ABI)
    const iface16 = new Interface(OffRamp_1_6_ABI)

    try {
      // Try v1.2/1.5 format first (ReportAccepted from CommitStore)
      const parsed12 = ifaceCommitStore.parseLog({
        topics: log.topics as string[],
        data: typeof log.data === 'string' ? log.data : '0x',
      })

      if (parsed12?.name === 'ReportAccepted') {
        if (!lane) return undefined
        // For v1.2, we don't have lane info in the event, so we just return it with the provided lane
        // The actual filtering happens in fetchCommitReport based on the commitStore address
        return [
          {
            merkleRoot: parsed12.args.report.merkleRoot as string,
            minSeqNr: parsed12.args.report.interval.min as bigint,
            maxSeqNr: parsed12.args.report.interval.max as bigint,
            sourceChainSelector: lane.sourceChainSelector,
            onRampAddress: lane.onRamp,
          },
        ]
      }
    } catch {
      // Not v1.2/1.5, try v1.6
    }

    try {
      // Try v1.6 format (CommitReportAccepted)
      const parsed16 = iface16.parseLog({
        topics: log.topics as string[],
        data: typeof log.data === 'string' ? log.data : '0x',
      })

      if (parsed16?.name === 'CommitReportAccepted') {
        const reports: CommitReport[] = []
        // CommitReportAccepted has blessedMerkleRoots (args[0]) and unblessedMerkleRoots (args[1])
        const blessedRoots = parsed16.args[0] as any[]
        const unblessedRoots = parsed16.args[1] as any[]
        const allRoots = [...blessedRoots, ...unblessedRoots]

        for (const root of allRoots) {
          // Filter by lane if provided
          if (lane && root.sourceChainSelector !== lane.sourceChainSelector) {
            continue
          }

          // onRampAddress is bytes in v1.6, extract the actual address
          let onRampAddress = root.onRampAddress as string
          // Remove '0x' prefix and get last 40 chars (20 bytes for EVM address)
          if (typeof onRampAddress === 'string' && onRampAddress.startsWith('0x')) {
            // Take the last 40 hex characters (20 bytes)
            const addrHex = onRampAddress.slice(2)
            onRampAddress = '0x' + addrHex.slice(-40)
          }

          if (lane && onRampAddress.toLowerCase() !== lane.onRamp.toLowerCase()) {
            continue
          }

          const report = root.toObject ? root.toObject() : root
          reports.push({
            sourceChainSelector: report.sourceChainSelector,
            onRampAddress,
            minSeqNr: report.minSeqNr,
            maxSeqNr: report.maxSeqNr,
            merkleRoot: report.merkleRoot,
          })
        }

        if (reports.length > 0) return reports
      }
    } catch {
      // Not v1.6 either
    }

    return undefined
  }

  static decodeReceipt(_log: Log_) {
    const iface = new Interface(OffRamp_1_6_ABI)
    try {
      const parsed = iface.parseLog({
        topics: _log.topics as string[],
        data: typeof _log.data === 'string' ? _log.data : '0x',
      })
      if (parsed?.name === 'ExecutionStateChanged') {
        return {
          sourceChainSelector: parsed.args[0] as bigint,
          sequenceNumber: parsed.args[1] as bigint,
          messageId: parsed.args[2] as string,
          messageHash: parsed.args[3] as string,
          state: Number(parsed.args[4]) as ExecutionState,
          returnData: parsed.args[5] as string,
          gasUsed: parsed.args[6] as bigint,
        }
      }
    } catch {
      // ignore
    }
    return undefined
  }

  static decodeExtraArgs(_extraArgs: any): any {
    return undefined
  }

  static encodeExtraArgs(_extraArgs: any): string {
    return '0x'
  }

  static getAddress(_bytes: any): string {
    return '0x0000000000000000000000000000000000000000'
  }

  static getDestLeafHasher(_lane: Lane): any {
    return () => '0x'
  }

  static parse(_data: unknown): Record<string, unknown> | undefined {
    return undefined
  }
}

describe('fetchCommitReport', () => {
  it('should return first matching commit report for v1.2', async () => {
    const dest = new MockChain(11155111, 'EVM2EVMOffRamp 1.2.0')

    const iface = new Interface(CommitStore_1_2_ABI)
    const encoded = iface.encodeEventLog('ReportAccepted', [
      {
        priceUpdates: { tokenPriceUpdates: [], gasPriceUpdates: [] },
        interval: { min: 1n, max: 2n },
        merkleRoot: '0x1234000000000000000000000000000000000000000000000000000000000000',
      },
    ])

    const log: Log_ = {
      address: '0xCommitStore',
      blockNumber: 12346,
      transactionHash: '0xTxHash',
      index: 0,
      topics: encoded.topics,
      data: encoded.data,
    }

    dest.setLogs([log])

    const lane: Lane = {
      sourceChainSelector: 5009297550715157269n,
      destChainSelector: 11155111n,
      onRamp: '0xOnRamp',
      version: CCIPVersion.V1_2,
    }

    const request = {
      lane,
      message: { sequenceNumber: 1n } as any,
      tx: { timestamp: 1700000000 },
    }

    const hints = { startBlock: 12345 }
    const result = await fetchCommitReport(dest, '0xCommitStore', request, hints)

    assert.ok(result.report)
    assert.equal(result.report.minSeqNr, 1n)
    assert.equal(result.report.maxSeqNr, 2n)
    assert.equal(
      result.report.merkleRoot,
      '0x1234000000000000000000000000000000000000000000000000000000000000',
    )
    assert.equal(result.report.sourceChainSelector, lane.sourceChainSelector)
    assert.equal(result.report.onRampAddress, lane.onRamp)
  })

  it('should throw when no matching commit found in range for v1.2', async () => {
    const dest = new MockChain(11155111, 'EVM2EVMOffRamp 1.2.0')

    const iface = new Interface(CommitStore_1_2_ABI)

    // Create a log with a report - but the test setup will use a different commitStore
    // which won't match, or we need different logic
    // Actually for v1.2, the lane info is not in the event, it comes from the CommitStore config
    // So we can't really test lane mismatch at the decode level - it happens at a higher level
    // Let's test that when no matching commit is found in range

    const encoded = iface.encodeEventLog('ReportAccepted', [
      {
        priceUpdates: { tokenPriceUpdates: [], gasPriceUpdates: [] },
        interval: { min: 10n, max: 20n }, // Out of range for sequenceNumber=1
        merkleRoot: '0x1234000000000000000000000000000000000000000000000000000000000000',
      },
    ])

    const log: Log_ = {
      address: '0xCommitStore',
      blockNumber: 12346,
      transactionHash: '0xTxHash',
      index: 0,
      topics: encoded.topics,
      data: encoded.data,
    }

    dest.setLogs([log])

    const lane: Lane = {
      sourceChainSelector: 5009297550715157269n,
      destChainSelector: 11155111n,
      onRamp: '0xOnRamp',
      version: CCIPVersion.V1_2,
    }

    const request = {
      lane,
      message: { sequenceNumber: 1n } as any,
      tx: { timestamp: 1700000000 },
    }

    const hints = { startBlock: 12345 }

    await assert.rejects(
      async () => await fetchCommitReport(dest, '0xCommitStore', request, hints),
      /Could not find commit after 12345 for sequenceNumber=1/,
    )
  })

  it('should return v1.6 commit report', async () => {
    const dest = new MockChain(11155111, 'OffRamp 1.6.0')

    const iface = new Interface(OffRamp_1_6_ABI)

    // Create a v1.6 CommitReportAccepted event with a matching report
    const encoded = iface.encodeEventLog('CommitReportAccepted', [
      [], // blessedMerkleRoots
      [
        // unblessedMerkleRoots - put the matching report first
        {
          sourceChainSelector: 5009297550715157269n,
          onRampAddress: '0x00000000000000000000000000004f6e52616d70', // 'OnRamp' as hex: 4f6e52616d70 (20 bytes)
          minSeqNr: 3n,
          maxSeqNr: 8n,
          merkleRoot: '0x1234000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      { tokenPriceUpdates: [], gasPriceUpdates: [] }, // priceUpdates
    ])

    const log: Log_ = {
      address: '0xOffRamp',
      blockNumber: 12346,
      transactionHash: '0xTxHash',
      index: 0,
      topics: encoded.topics,
      data: encoded.data,
    }

    dest.setLogs([log])

    const lane: Lane = {
      sourceChainSelector: 5009297550715157269n,
      destChainSelector: 11155111n,
      onRamp: '0x00000000000000000000000000004f6e52616d70',
      version: CCIPVersion.V1_6,
    }

    const request = {
      lane,
      message: { sequenceNumber: 4n } as any,
      tx: { timestamp: 1700000000 },
    }

    const hints = { startBlock: 12345 }
    const result = await fetchCommitReport(dest, '0xOffRamp', request, hints)

    assert.ok(result.report)
    assert.equal(result.report.minSeqNr, 3n)
    assert.equal(result.report.maxSeqNr, 8n)
    assert.equal(
      result.report.merkleRoot,
      '0x1234000000000000000000000000000000000000000000000000000000000000',
    )
    assert.equal(result.report.sourceChainSelector, lane.sourceChainSelector)
    assert.equal(result.report.onRampAddress, '0x00000000000000000000000000004f6e52616d70')
  })

  it('should stop searching when minSeqNr is greater than requested sequenceNumber', async () => {
    const dest = new MockChain(11155111, 'OffRamp 1.6.0')

    const iface = new Interface(OffRamp_1_6_ABI)

    // Create a report with minSeqNr > requested sequenceNumber (should stop iteration)
    const encoded = iface.encodeEventLog('CommitReportAccepted', [
      [],
      [
        {
          sourceChainSelector: 5009297550715157269n,
          onRampAddress: '0x00000000000000000000000000004f6e52616d70',
          minSeqNr: 10n, // Greater than requested
          maxSeqNr: 20n,
          merkleRoot: '0x5678000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      { tokenPriceUpdates: [], gasPriceUpdates: [] },
    ])

    const log: Log_ = {
      address: '0xOffRamp',
      blockNumber: 12346,
      transactionHash: '0xTxHash',
      index: 0,
      topics: encoded.topics,
      data: encoded.data,
    }

    dest.setLogs([log])

    const lane: Lane = {
      sourceChainSelector: 5009297550715157269n,
      destChainSelector: 11155111n,
      onRamp: '0x00000000000000000000000000004f6e52616d70',
      version: CCIPVersion.V1_6,
    }

    const request = {
      lane,
      message: { sequenceNumber: 5n } as any,
      tx: { timestamp: 1700000000 },
    }

    const hints = { startBlock: 12345 }

    await assert.rejects(
      async () => await fetchCommitReport(dest, '0xOffRamp', request, hints),
      /Could not find commit after 12345 for sequenceNumber=5/,
    )
  })

  it('should skip commits where maxSeqNr is less than requested sequenceNumber', async () => {
    const dest = new MockChain(11155111, 'OffRamp 1.6.0')

    const iface = new Interface(OffRamp_1_6_ABI)

    // First log with maxSeqNr < requested (should skip)
    const encoded1 = iface.encodeEventLog('CommitReportAccepted', [
      [],
      [
        {
          sourceChainSelector: 5009297550715157269n,
          onRampAddress: '0x00000000000000000000000000004f6e52616d70',
          minSeqNr: 1n,
          maxSeqNr: 3n, // Less than requested
          merkleRoot: '0xaaaa000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      { tokenPriceUpdates: [], gasPriceUpdates: [] },
    ])

    // Second log with correct range (should match)
    const encoded2 = iface.encodeEventLog('CommitReportAccepted', [
      [],
      [
        {
          sourceChainSelector: 5009297550715157269n,
          onRampAddress: '0x00000000000000000000000000004f6e52616d70',
          minSeqNr: 4n,
          maxSeqNr: 10n,
          merkleRoot: '0xbbbb000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      { tokenPriceUpdates: [], gasPriceUpdates: [] },
    ])

    const log1: Log_ = {
      address: '0xOffRamp',
      blockNumber: 12346,
      transactionHash: '0xTxHash1',
      index: 0,
      topics: encoded1.topics,
      data: encoded1.data,
    }

    const log2: Log_ = {
      address: '0xOffRamp',
      blockNumber: 12347,
      transactionHash: '0xTxHash2',
      index: 0,
      topics: encoded2.topics,
      data: encoded2.data,
    }

    dest.setLogs([log1, log2])

    const lane: Lane = {
      sourceChainSelector: 5009297550715157269n,
      destChainSelector: 11155111n,
      onRamp: '0x00000000000000000000000000004f6e52616d70',
      version: CCIPVersion.V1_6,
    }

    const request = {
      lane,
      message: { sequenceNumber: 5n } as any,
      tx: { timestamp: 1700000000 },
    }

    const hints = { startBlock: 12345 }
    const result = await fetchCommitReport(dest, '0xOffRamp', request, hints)

    assert.ok(result.report)
    assert.equal(result.report.minSeqNr, 4n)
    assert.equal(result.report.maxSeqNr, 10n)
    assert.equal(
      result.report.merkleRoot,
      '0xbbbb000000000000000000000000000000000000000000000000000000000000',
    )
  })

  it('should use startTime when startBlock is not provided', async () => {
    const dest = new MockChain(11155111, 'OffRamp 1.6.0')

    const iface = new Interface(OffRamp_1_6_ABI)
    const encoded = iface.encodeEventLog('CommitReportAccepted', [
      [],
      [
        {
          sourceChainSelector: 5009297550715157269n,
          onRampAddress: '0x00000000000000000000000000004f6e52616d70',
          minSeqNr: 1n,
          maxSeqNr: 5n,
          merkleRoot: '0xcccc000000000000000000000000000000000000000000000000000000000000',
        },
      ],
      { tokenPriceUpdates: [], gasPriceUpdates: [] },
    ])

    const log: Log_ = {
      address: '0xOffRamp',
      blockNumber: 12346,
      transactionHash: '0xTxHash',
      index: 0,
      topics: encoded.topics,
      data: encoded.data,
    }

    dest.setLogs([log])

    const lane: Lane = {
      sourceChainSelector: 5009297550715157269n,
      destChainSelector: 11155111n,
      onRamp: '0x00000000000000000000000000004f6e52616d70',
      version: CCIPVersion.V1_6,
    }

    const requestTimestamp = 1700000000
    const request = {
      lane,
      message: { sequenceNumber: 3n } as any,
      tx: { timestamp: requestTimestamp },
    }

    // No hints provided, should use timestamp
    const result = await fetchCommitReport(dest, '0xOffRamp', request)

    assert.ok(result.report)
    assert.equal(result.report.minSeqNr, 1n)
    assert.equal(result.report.maxSeqNr, 5n)
    assert.equal(
      result.report.merkleRoot,
      '0xcccc000000000000000000000000000000000000000000000000000000000000',
    )
  })
})
