import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import { TONChain } from './index.ts'
import type { CCIPMessage_V1_6_TON } from './types.ts'

// TON testnet endpoint
const TON_TESTNET_RPC = 'https://testnet.toncenter.com/api/v2/jsonRPC'

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
    // Real CCIPMessageSent transaction from TON testnet (TON -> Sepolia)
    const ccipTxHash = 'a7f7fc28388e0e486dbb2724dce077d5e7bb348d3abf9f109a0ef499fc229e3a'

    const expected = {
      messageId: '0x09dd921d24a91c1111fdcf524a664bd7b0935a54bc3bccea72073231479a688d',
      sourceChainSelector: TON_TESTNET_CHAIN_SELECTOR,
      destChainSelector: SEPOLIA_CHAIN_SELECTOR,
      sequenceNumber: 821n,
      nonce: 0n,
      sender: 'EQAFbU7ATpBTe2vPiTpThvehgNiynnD4llSA8IaJThJFpvP7',
      receiver: '0x00000000000000000000000040d7c009d073e0d740ed2c50ca0a48c84a3f8b47',
      data: '0x636369702d73746167696e672d3230323138383537383631',
      feeToken: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd99',
      feeTokenAmount: 131016104n,
      feeValueJuels: 15125193363198824n,
      gasLimit: 1000000n,
      allowOutOfOrderExecution: true,
    }

    let message: CCIPMessage_V1_6_TON | undefined

    before(async () => {
      const tx = await tonChain.getTransaction(ccipTxHash)
      message = TONChain.decodeMessage(tx.logs[0])
    })

    it('should decode CCIPMessageSent from transaction log', () => {
      assert.ok(message, 'Should successfully decode message')
    })

    it('should decode header fields correctly', () => {
      assert.ok(message)
      assert.equal(message.header.messageId, expected.messageId)
      assert.equal(message.header.sourceChainSelector, expected.sourceChainSelector)
      assert.equal(message.header.destChainSelector, expected.destChainSelector)
      assert.equal(message.header.sequenceNumber, expected.sequenceNumber)
      assert.equal(message.header.nonce, expected.nonce)
    })

    it('should decode sender and receiver correctly', () => {
      assert.ok(message)
      assert.equal(message.sender, expected.sender)
      assert.equal(message.receiver.toLowerCase(), expected.receiver.toLowerCase())
    })

    it('should decode data correctly', () => {
      assert.ok(message)
      assert.equal(message.data, expected.data)
      const dataStr = Buffer.from(message.data.slice(2), 'hex').toString('utf8')
      assert.equal(dataStr, 'ccip-staging-20218857861')
    })

    it('should decode fee fields correctly', () => {
      assert.ok(message)
      assert.equal(message.feeToken, expected.feeToken)
      assert.equal(message.feeTokenAmount, expected.feeTokenAmount)
      assert.equal(message.feeValueJuels, expected.feeValueJuels)
    })

    it('should decode extraArgs correctly', () => {
      assert.ok(message)
      assert.equal(message.gasLimit, expected.gasLimit)
      assert.equal(message.allowOutOfOrderExecution, expected.allowOutOfOrderExecution)
      assert.ok(message.extraArgs.startsWith('0x181dcf10'), 'should have EVMExtraArgsV2 tag')
    })

    it('should decode tokenAmounts correctly', () => {
      assert.ok(message)
      assert.ok(Array.isArray(message.tokenAmounts))
      assert.equal(message.tokenAmounts.length, 0)
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeMessage({ data: '' }), undefined)
      assert.equal(TONChain.decodeMessage({ data: undefined as any }), undefined)
      assert.equal(TONChain.decodeMessage({ data: 'not-valid-base64!!!' }), undefined)
      assert.equal(TONChain.decodeMessage({ data: 'SGVsbG8gV29ybGQ=' }), undefined)
    })
  })

  describe('decodeCommits', () => {
    const expectedOnChainCommit = {
      txHash: '6f970beafb5f10923f75382d0424d5582ae8f8966dbd428b6e284216c7a66826',
      sourceChainSelector: 16015286601757825753n, // Sepolia
      onRampAddress: '0xfb34b9969dd201cc9a04e604a6d40af917b6c1e8',
      minSeqNr: 942n,
      maxSeqNr: 942n,
      merkleRoot: '0xfcd58111c28a183371ed7f16f2b2b64b90783a295ee4b058da5c5e51b4ca2b5d',
    }

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeCommits({ data: '' } as any), undefined, 'empty data')
      assert.equal(TONChain.decodeCommits({ data: undefined } as any), undefined, 'undefined data')
      assert.equal(
        TONChain.decodeCommits({ data: 'not-valid-base64!!!' } as any),
        undefined,
        'invalid base64',
      )
    })

    it('should return undefined for non-commit BOC data (e.g., CCIPMessageSent)', async () => {
      const ccipTxHash = 'a7f7fc28388e0e486dbb2724dce077d5e7bb348d3abf9f109a0ef499fc229e3a'
      const tx = await tonChain.getTransaction(ccipTxHash)
      assert.ok(tx.logs.length > 0, 'Should have logs')
      const result = TONChain.decodeCommits(tx.logs[0])
      assert.equal(result, undefined, 'CCIPMessageSent should not decode as commit')
    })

    it('should find and decode commit reports by iterating logs', async () => {
      const tx = await tonChain.getTransaction(expectedOnChainCommit.txHash)
      assert.ok(tx.logs.length > 0, 'Should have logs')

      // Find the CommitReportAccepted log by trying each one
      let result: ReturnType<typeof TONChain.decodeCommits> = undefined
      for (const log of tx.logs) {
        result = TONChain.decodeCommits(log)
        if (result) break
      }

      assert.ok(result, 'Should find and decode commit report from transaction logs')
      assert.equal(result.length, 1, 'Should have exactly one commit report')
      const commit = result[0]
      assert.equal(commit.sourceChainSelector, expectedOnChainCommit.sourceChainSelector)
      assert.equal(commit.minSeqNr, expectedOnChainCommit.minSeqNr)
      assert.equal(commit.maxSeqNr, expectedOnChainCommit.maxSeqNr)
    })

    it('should filter by lane when provided', async () => {
      const tx = await tonChain.getTransaction(expectedOnChainCommit.txHash)

      // Should match with correct lane
      const matchingLane = {
        sourceChainSelector: expectedOnChainCommit.sourceChainSelector,
        onRamp: expectedOnChainCommit.onRampAddress,
      }
      const resultMatch = TONChain.decodeCommits(tx.logs[1], matchingLane as any)
      assert.ok(resultMatch, 'Should decode when lane matches')

      // Should return undefined with wrong sourceChainSelector
      const wrongSelectorLane = {
        sourceChainSelector: 123n,
        onRamp: expectedOnChainCommit.onRampAddress,
      }
      const resultWrongSelector = TONChain.decodeCommits(tx.logs[1], wrongSelectorLane as any)
      assert.equal(
        resultWrongSelector,
        undefined,
        'Should return undefined when sourceChainSelector does not match',
      )

      // Should return undefined with wrong onRamp
      const wrongOnRampLane = {
        sourceChainSelector: expectedOnChainCommit.sourceChainSelector,
        onRamp: '0x0000000000000000000000000000000000000000',
      }
      const resultWrongOnRamp = TONChain.decodeCommits(tx.logs[1], wrongOnRampLane as any)
      assert.equal(
        resultWrongOnRamp,
        undefined,
        'Should return undefined when onRamp does not match',
      )
    })
  })
})
