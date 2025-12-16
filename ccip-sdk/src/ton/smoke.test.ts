import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import { TONChain } from './index.ts'
import type { CCIPMessage_V1_6_TON } from './types.ts'

// TON testnet endpoint
const TON_TESTNET_RPC = 'https://testnet-v4.tonhubapi.com'

// Chain selectors
const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n
const TON_TESTNET_CHAIN_SELECTOR = 1399300952838017768n

/**
 * These tests require real TON testnet contract addresses.
 * Replace these placeholders with real addresses:
 */
const ADDRESSES_TO_ASSERT = {
  tonOffRamp: 'EQCfLpla6865euCU2-TPlzy8vKQKT8rFKHoAvorKBC1RudIO',
  tonRouter: 'EQDrkhDYT8czFZuYNPlFMJ5ICD8FQoEW0b1KvITMVljC3ZTV',
  tonOnRamp: 'EQDTIBzONmN64tMmLymf0-jtc_AAWfDlXiZcr7ja5ri7ak53',
  evmOnramp: '0xfb34b9969dd201cc9a04e604a6d40af917b6c1e8',
}

describe('TONChain smoke tests', () => {
  let tonChain: TONChain

  before(async () => {
    tonChain = await TONChain.fromUrl(TON_TESTNET_RPC)
  })
  describe('TON RPC connectivity', () => {
    it('should create TONChain from URL', async () => {
      const chain = await TONChain.fromUrl(TON_TESTNET_RPC)
      assert.equal(chain.network.name, 'ton-testnet')
      assert.equal(chain.network.chainId, -3)
      assert.equal(chain.network.chainSelector, TON_TESTNET_CHAIN_SELECTOR)
    })
  })

  describe('OnRamp bindings', () => {
    it('TONChain.getRouterForOnRamp should return router address from OnRamp', async () => {
      const router = await tonChain.getRouterForOnRamp(
        ADDRESSES_TO_ASSERT.tonOnRamp,
        SEPOLIA_CHAIN_SELECTOR,
      )
      assert.ok(router, 'Should return router address')

      // Verify it matches the expected router
      assert.equal(
        Address.parse(router).toRawString(),
        Address.parse(ADDRESSES_TO_ASSERT.tonRouter).toRawString(),
        'Should match expected router address',
      )
    })
  })

  describe('OffRamp bindings', () => {
    it('TONChain.getRouterForOffRamp should get router address from OffRamp sourceChainConfig', async () => {
      const router = await tonChain.getRouterForOffRamp(
        ADDRESSES_TO_ASSERT.tonOffRamp,
        SEPOLIA_CHAIN_SELECTOR,
      )
      assert.ok(router, 'Should return router address')

      // Verify it matches the expected router
      assert.equal(
        Address.parse(router).toRawString(),
        Address.parse(ADDRESSES_TO_ASSERT.tonRouter).toRawString(),
        'Should match expected router address',
      )
    })

    it('TONChain.getOnRampForOffRamp should return source chain onRamp address', async () => {
      const onRamp = await tonChain.getOnRampForOffRamp(
        ADDRESSES_TO_ASSERT.tonOffRamp,
        SEPOLIA_CHAIN_SELECTOR,
      )
      assert.ok(onRamp, 'Should return onRamp address')

      // The onRamp is on the source chain, so it should be an EVM address
      assert.match(onRamp, /^0x[a-fA-F0-9]{40}$/, 'Should be a valid EVM address format')

      // Verify it matches the expected EVM OnRamp
      assert.equal(
        onRamp.toLowerCase(),
        ADDRESSES_TO_ASSERT.evmOnramp.toLowerCase(),
        'Should match expected EVM OnRamp address',
      )
    })

    it('TONChain.getCommitStoreForOffRamp should return offRamp address for v1.6', async () => {
      const commitStore = await tonChain.getCommitStoreForOffRamp(ADDRESSES_TO_ASSERT.tonOffRamp)

      assert.ok(commitStore, 'Should return commit store address')

      // For CCIP v1.6, CommitStore and OffRamp are the same contract
      assert.equal(
        Address.parse(commitStore).toRawString(),
        Address.parse(ADDRESSES_TO_ASSERT.tonOffRamp).toRawString(),
        'CommitStore should be the same as OffRamp for v1.6',
      )
    })
  })

  describe('Router bindings', () => {
    it('TONChain.getOffRampsForRouter should return offRamps for source chain', async () => {
      const offRamps = await tonChain.getOffRampsForRouter(
        ADDRESSES_TO_ASSERT.tonRouter,
        SEPOLIA_CHAIN_SELECTOR,
      )

      assert.ok(Array.isArray(offRamps), 'Should return an array')
      assert.ok(offRamps.length > 0, 'Should find at least one OffRamp')

      // Verify the known offRamp is in the list
      const expectedOffRamp = Address.parse(ADDRESSES_TO_ASSERT.tonOffRamp).toRawString()
      const found = offRamps.some((addr) => Address.parse(addr).toRawString() === expectedOffRamp)
      assert.ok(found, 'Should include the known OffRamp address')
    })
    it('TONChain.getOnRampForRouter should return onRamp for destination chain', async () => {
      const onRamp = await tonChain.getOnRampForRouter(
        ADDRESSES_TO_ASSERT.tonRouter,
        SEPOLIA_CHAIN_SELECTOR,
      )
      assert.ok(onRamp, 'Should return onRamp address')

      // Verify it matches the expected onRamp
      assert.equal(
        Address.parse(onRamp).toRawString(),
        Address.parse(ADDRESSES_TO_ASSERT.tonOnRamp).toRawString(),
        'Should match expected onRamp address',
      )
    })
  })

  describe('getLogs', () => {
    it('should find logs for OnRamp address with valid structure', async () => {
      const logs: any[] = []

      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 10,
      })) {
        logs.push(log)
        if (logs.length >= 3) break
      }

      assert.ok(logs.length > 0, 'Should find at least one log')

      // Verify log structure
      const log = logs[0]
      assert.ok(log.address, 'log should have address')
      assert.ok(log.data, 'log should have data')
      assert.ok(typeof log.data === 'string', 'log data should be base64 string')
      assert.ok(log.blockNumber > 0, 'log should have positive blockNumber')
      assert.ok(log.transactionHash, 'log should have transactionHash')
      assert.ok(log.transactionHash.includes(':'), 'transactionHash should be composite format')
      assert.ok(typeof log.index === 'number', 'log should have numeric index')
      assert.ok(Array.isArray(log.topics), 'log should have topics array')

      // Topics contain messageId for CCIP messages
      if (log.topics.length > 0) {
        assert.ok(log.topics[0].startsWith('0x'), 'topic should be hex messageId')
        assert.equal(log.topics[0].length, 66, 'messageId should be 32 bytes')
      }

      // Verify descending order if we have multiple logs
      if (logs.length > 1) {
        for (let i = 1; i < logs.length; i++) {
          assert.ok(
            logs[i - 1].blockNumber >= logs[i].blockNumber,
            'Logs should be in descending order by blockNumber',
          )
        }
      }
    })

    it('should find logs for OffRamp address', async () => {
      const logs: any[] = []

      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOffRamp,
        page: 10,
      })) {
        logs.push(log)
        if (logs.length >= 1) break
      }

      assert.ok(logs.length > 0, 'Should find at least one log for OffRamp')
    })

    it('should paginate through multiple transactions', async () => {
      const logs: any[] = []
      const seenTxHashes = new Set<string>()

      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 5,
      })) {
        logs.push(log)
        seenTxHashes.add(log.transactionHash)
        // Stop early once we've seen multiple txs
        if (seenTxHashes.size >= 3) break
      }

      assert.ok(seenTxHashes.size > 1, 'Should retrieve logs from multiple transactions')
    })

    it('should respect startBlock and endBlock filters', async () => {
      // First, get a couple of logs to determine a valid block range
      const recentLogs: any[] = []
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 5,
      })) {
        recentLogs.push(log)
        if (recentLogs.length >= 3) break
      }

      assert.ok(recentLogs.length >= 2, 'Need at least 2 logs to test filtering')

      // Use the range from fetched logs
      const highBlock = recentLogs[0].blockNumber
      const lowBlock = recentLogs[recentLogs.length - 1].blockNumber

      // Test startBlock: should only get logs >= startBlock
      const logsWithStartBlock: any[] = []
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        startBlock: lowBlock,
        page: 10,
      })) {
        logsWithStartBlock.push(log)
        if (logsWithStartBlock.length >= 5) break
      }

      for (const log of logsWithStartBlock) {
        assert.ok(
          log.blockNumber >= lowBlock,
          `log.blockNumber ${log.blockNumber} should be >= startBlock ${lowBlock}`,
        )
      }

      // Test endBlock: should only get logs <= endBlock
      const logsWithEndBlock: any[] = []
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        endBlock: highBlock,
        page: 10,
      })) {
        logsWithEndBlock.push(log)
        if (logsWithEndBlock.length >= 3) break
      }

      for (const log of logsWithEndBlock) {
        assert.ok(
          log.blockNumber <= highBlock,
          `log.blockNumber ${log.blockNumber} should be <= endBlock ${highBlock}`,
        )
      }
    })
  })

  describe('decodeMessage', () => {
    let message: CCIPMessage_V1_6_TON | undefined
    let ccipTxHash: string | undefined

    before(async () => {
      // Fetch a real CCIPMessageSent log from OnRamp
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 10,
      })) {
        const decoded = TONChain.decodeMessage(log)
        if (decoded) {
          message = decoded
          ccipTxHash = log.transactionHash
          break
        }
      }
    })

    it('should decode CCIPMessageSent from transaction log', () => {
      assert.ok(message, 'Should successfully decode message')
      assert.ok(ccipTxHash, 'Should have found a valid transaction')
    })

    it('should decode header.messageId as 32-byte hex', () => {
      assert.ok(message)
      assert.ok(message.header.messageId.startsWith('0x'), 'messageId should be hex prefixed')
      assert.equal(
        message.header.messageId.length,
        66,
        'messageId should be 32 bytes (66 chars with 0x)',
      )
      assert.match(message.header.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be valid hex')
    })

    it('should decode header.sourceChainSelector as TON testnet', () => {
      assert.ok(message)
      assert.equal(message.header.sourceChainSelector, TON_TESTNET_CHAIN_SELECTOR)
    })

    it('should decode header.destChainSelector as Sepolia', () => {
      assert.ok(message)
      assert.equal(message.header.destChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    it('should decode header.sequenceNumber as positive bigint', () => {
      assert.ok(message)
      assert.equal(typeof message.header.sequenceNumber, 'bigint')
      assert.ok(message.header.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    it('should decode header.nonce as bigint (typically 0 for out-of-order)', () => {
      assert.ok(message)
      assert.equal(typeof message.header.nonce, 'bigint')
      // nonce is 0 when allowOutOfOrderExecution is true
      if (message.allowOutOfOrderExecution) {
        assert.equal(message.header.nonce, 0n, 'nonce should be 0 for out-of-order execution')
      }
    })

    it('should decode sender as TON user-friendly address', () => {
      assert.ok(message)
      // TON user-friendly addresses start with EQ (mainnet) or kQ/0Q (testnet bounceable/non-bounceable)
      assert.match(
        message.sender,
        /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/,
        'sender should be TON user-friendly address',
      )
      // Verify it's a valid address by parsing
      assert.doesNotThrow(
        () => Address.parse(message!.sender),
        'sender should be parseable TON address',
      )
    })

    it('should decode receiver as padded EVM address (32 bytes)', () => {
      assert.ok(message)
      assert.ok(message.receiver.startsWith('0x'), 'receiver should be hex prefixed')
      assert.equal(message.receiver.length, 66, 'receiver should be 32 bytes (padded EVM address)')
      // First 12 bytes should be zero padding for EVM addresses
      assert.ok(
        message.receiver.startsWith('0x000000000000000000000000'),
        'receiver should have 12-byte zero padding',
      )
      // Last 20 bytes should be the actual EVM address
      const evmAddress = '0x' + message.receiver.slice(-40)
      assert.match(evmAddress, /^0x[a-fA-F0-9]{40}$/, 'extracted EVM address should be valid')
    })

    it('should decode data as hex bytes', () => {
      assert.ok(message)
      assert.ok(message.data.startsWith('0x'), 'data should be hex prefixed')
      assert.match(message.data, /^0x([a-f0-9]{2})*$/, 'data should be valid hex bytes')
    })

    it('should decode tokenAmounts as array', () => {
      assert.ok(message)
      assert.ok(Array.isArray(message.tokenAmounts), 'tokenAmounts should be array')
      // Each token amount should have required fields if present
      for (const ta of message.tokenAmounts) {
        assert.ok('sourcePoolAddress' in ta, 'tokenAmount should have sourcePoolAddress')
        assert.ok('destTokenAddress' in ta, 'tokenAmount should have destTokenAddress')
      }
    })

    it('should decode feeToken as TON address', () => {
      assert.ok(message)
      assert.ok(message.feeToken, 'feeToken should be present')
      assert.doesNotThrow(
        () => Address.parse(message!.feeToken),
        'feeToken should be parseable TON address',
      )
    })

    it('should decode feeTokenAmount as positive bigint', () => {
      assert.ok(message)
      assert.equal(typeof message.feeTokenAmount, 'bigint')
      assert.ok(message.feeTokenAmount > 0n, 'feeTokenAmount should be positive')
    })

    it('should decode feeValueJuels as positive bigint', () => {
      assert.ok(message)
      assert.equal(typeof message.feeValueJuels, 'bigint')
      assert.ok(message.feeValueJuels > 0n, 'feeValueJuels should be positive')
    })

    it('should decode extraArgs with EVMExtraArgsV2 tag', () => {
      assert.ok(message)
      assert.ok(
        message.extraArgs.startsWith('0x181dcf10'),
        'extraArgs should have EVMExtraArgsV2 tag (0x181dcf10)',
      )
      // EVMExtraArgsV2 tag (4 bytes) + gasLimit (32 bytes) + allowOutOfOrderExecution (1 byte) = 37 bytes = 74 hex chars + 2 for 0x
      assert.equal(message.extraArgs.length, 76, 'extraArgs should be 37 bytes for EVMExtraArgsV2')
    })

    it('should decode gasLimit as positive bigint', () => {
      assert.ok(message)
      assert.equal(typeof message.gasLimit, 'bigint')
      assert.ok(message.gasLimit > 0n, 'gasLimit should be positive')
      assert.ok(
        message.gasLimit >= 100_000n,
        'gasLimit should be at least 100k for cross-chain calls',
      )
    })

    it('should decode allowOutOfOrderExecution as boolean', () => {
      assert.ok(message)
      assert.equal(typeof message.allowOutOfOrderExecution, 'boolean')
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeMessage({ data: '' }), undefined, 'empty string')
      assert.equal(TONChain.decodeMessage({ data: undefined as any }), undefined, 'undefined')
      assert.equal(
        TONChain.decodeMessage({ data: 'not-valid-base64!!!' }),
        undefined,
        'invalid base64',
      )
      assert.equal(
        TONChain.decodeMessage({ data: 'SGVsbG8gV29ybGQ=' }),
        undefined,
        'valid base64 but not BOC',
      )
    })
  })

  describe('decodeCommits', () => {
    let commitLog: any
    let commitReport: ReturnType<typeof TONChain.decodeCommits>

    before(async () => {
      // Fetch a real CommitReportAccepted log from OffRamp
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOffRamp,
        topics: ['CommitReportAccepted'],
        page: 20,
      })) {
        const decoded = TONChain.decodeCommits(log)
        if (decoded && decoded.length > 0) {
          commitLog = log
          commitReport = decoded
          break
        }
      }
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeCommits({ data: '' } as any), undefined, 'empty data')
      assert.equal(TONChain.decodeCommits({ data: undefined } as any), undefined, 'undefined data')
      assert.equal(
        TONChain.decodeCommits({ data: 'not-valid-base64!!!' } as any),
        undefined,
        'invalid base64',
      )
    })

    it('should return undefined for non-commit BOC data', async () => {
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 1,
      })) {
        assert.equal(
          TONChain.decodeCommits(log),
          undefined,
          'CCIPMessageSent should not decode as commit',
        )
        break
      }
    })

    it('should decode commit report with correct lane info', () => {
      assert.ok(commitReport && commitReport.length > 0, 'Should decode commit report')
      const commit = commitReport[0]

      // Lane identification
      assert.equal(commit.sourceChainSelector, SEPOLIA_CHAIN_SELECTOR)
      assert.equal(commit.onRampAddress.toLowerCase(), ADDRESSES_TO_ASSERT.evmOnramp.toLowerCase())
    })

    it('should decode valid sequence number range', () => {
      assert.ok(commitReport && commitReport.length > 0)
      const commit = commitReport[0]

      assert.ok(commit.minSeqNr > 0n, 'minSeqNr should be positive')
      assert.ok(commit.maxSeqNr >= commit.minSeqNr, 'maxSeqNr >= minSeqNr')
    })

    it('should decode valid merkleRoot', () => {
      assert.ok(commitReport && commitReport.length > 0)
      const commit = commitReport[0]

      assert.match(commit.merkleRoot, /^0x[a-f0-9]{64}$/, 'merkleRoot should be 32-byte hex')
    })

    it('should filter commits by lane', () => {
      assert.ok(commitLog)

      // Matching lane returns commits
      const match = TONChain.decodeCommits(commitLog, {
        sourceChainSelector: SEPOLIA_CHAIN_SELECTOR,
        onRamp: ADDRESSES_TO_ASSERT.evmOnramp,
      } as any)
      assert.ok(match && match.length > 0, 'Should return commits for matching lane')

      // Wrong selector returns undefined
      const wrongSelector = TONChain.decodeCommits(commitLog, {
        sourceChainSelector: 123n,
        onRamp: ADDRESSES_TO_ASSERT.evmOnramp,
      } as any)
      assert.equal(wrongSelector, undefined, 'Wrong sourceChainSelector should return undefined')

      // Wrong onRamp returns undefined
      const wrongOnRamp = TONChain.decodeCommits(commitLog, {
        sourceChainSelector: SEPOLIA_CHAIN_SELECTOR,
        onRamp: '0x0000000000000000000000000000000000000000',
      } as any)
      assert.equal(wrongOnRamp, undefined, 'Wrong onRamp should return undefined')
    })
  })
})
