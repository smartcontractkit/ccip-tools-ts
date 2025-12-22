import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import '../index.ts'
import { TONChain } from './index.ts'
import type { CCIPMessage_V1_6_TON } from './types.ts'

describe('TON index integration tests', () => {
  let tonChain: TONChain

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

  // TON testnet endpoint
  const TON_TESTNET_RPC = 'https://testnet-v4.tonhubapi.com'

  // Chain selectors
  const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n
  const TON_TESTNET_CHAIN_SELECTOR = 1399300952838017768n

  before(async () => {
    tonChain = await TONChain.fromUrl(TON_TESTNET_RPC)
  })
  describe('RPC connectivity', () => {
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
        assert.equal(log.topics[0], 'CCIPMessageSent', 'topics[0] should be event name')
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
    let messageLog: any

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
          messageLog = log
          break
        }
      }
    })

    it('should have CCIPMessageSent as topics[0]', () => {
      assert.ok(messageLog, 'Should have found a message log')
      assert.ok(messageLog.topics.length > 0, 'topics should not be empty')
      assert.equal(messageLog.topics[0], 'CCIPMessageSent', 'topics[0] should be event name')
    })

    it('should decode CCIPMessageSent from transaction log', () => {
      assert.ok(message, 'Should successfully decode message')
      assert.ok(ccipTxHash, 'Should have found a valid transaction')
    })

    it('should decode messageId as 32-byte hex', () => {
      assert.ok(message)
      assert.ok(message.messageId.startsWith('0x'), 'messageId should be hex prefixed')
      assert.equal(message.messageId.length, 66, 'messageId should be 32 bytes (66 chars with 0x)')
      assert.match(message.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be valid hex')
    })

    it('should decode sourceChainSelector as TON testnet', () => {
      assert.ok(message)
      assert.equal(message.sourceChainSelector, TON_TESTNET_CHAIN_SELECTOR)
    })

    it('should decode destChainSelector as Sepolia', () => {
      assert.ok(message)
      assert.equal(message.destChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    it('should decode sequenceNumber as positive bigint', () => {
      assert.ok(message)
      assert.equal(typeof message.sequenceNumber, 'bigint')
      assert.ok(message.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    it('should decode nonce as bigint (typically 0 for out-of-order)', () => {
      assert.ok(message)
      assert.equal(typeof message.nonce, 'bigint')
      // nonce is 0 when allowOutOfOrderExecution is true
      if (message.allowOutOfOrderExecution) {
        assert.equal(message.nonce, 0n, 'nonce should be 0 for out-of-order execution')
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

    it('should decode receiver as checksummed EVM address', () => {
      assert.ok(message)
      assert.ok(message.receiver.startsWith('0x'), 'receiver should be hex prefixed')
      // Receiver should be a checksummed 20-byte EVM address (42 chars with 0x prefix)
      assert.equal(message.receiver.length, 42, 'receiver should be 20 bytes (42 chars with 0x)')
      assert.match(message.receiver, /^0x[a-fA-F0-9]{40}$/, 'receiver should be valid EVM address')
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
    it('should have CommitReportAccepted as topics[0]', () => {
      assert.ok(commitLog, 'Should have found a commit log')
      assert.ok(commitLog.topics.length > 0, 'topics should not be empty')
      assert.equal(commitLog.topics[0], 'CommitReportAccepted', 'topics[0] should be event name')
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

  describe('decodeReceipt', () => {
    let receiptLog: any
    let receipt: ReturnType<typeof TONChain.decodeReceipt>

    before(async () => {
      // Fetch a real ExecutionStateChanged log from OffRamp
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOffRamp,
        topics: ['ExecutionStateChanged'],
        page: 20,
      })) {
        const decoded = TONChain.decodeReceipt(log)
        if (decoded) {
          receiptLog = log
          receipt = decoded
          break
        }
      }
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeReceipt({ data: '' } as any), undefined, 'empty data')
      assert.equal(TONChain.decodeReceipt({ data: undefined } as any), undefined, 'undefined data')
      assert.equal(
        TONChain.decodeReceipt({ data: 'not-valid-base64!!!' } as any),
        undefined,
        'invalid base64',
      )
    })

    it('should return undefined for non-receipt BOC data', async () => {
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 1,
      })) {
        assert.equal(
          TONChain.decodeReceipt(log),
          undefined,
          'CCIPMessageSent should not decode as receipt',
        )
        break
      }
    })

    it('should have ExecutionStateChanged as topics[0]', () => {
      assert.ok(receiptLog, 'Should have found a receipt log')
      assert.ok(receiptLog.topics.length > 0, 'topics should not be empty')
      assert.equal(receiptLog.topics[0], 'ExecutionStateChanged', 'topics[0] should be event name')
    })

    it('should decode receipt with valid sourceChainSelector', () => {
      assert.ok(receipt, 'Should decode receipt')
      assert.equal(receipt.sourceChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    it('should decode valid sequenceNumber', () => {
      assert.ok(receipt)
      assert.equal(typeof receipt.sequenceNumber, 'bigint')
      assert.ok(receipt.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    it('should decode valid messageId', () => {
      assert.ok(receipt)
      assert.match(receipt.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be 32-byte hex')
    })

    it('should decode valid state', () => {
      assert.ok(receipt)
      assert.ok(
        [0, 1, 2, 3].includes(receipt.state),
        'state should be Untouched(0), InProgress(1), Success(2), or Failure(3)',
      )
    })
  })

  describe('typeAndVersion', () => {
    it('should return valid typeAndVersion for OffRamp', async () => {
      const result = await tonChain.typeAndVersion(ADDRESSES_TO_ASSERT.tonOffRamp)

      assert.ok(result.length >= 3, 'Should return at least [type, version, typeAndVersion]')
      assert.equal(result[0], 'OffRamp', 'Type should be OffRamp')
      assert.match(result[1], /^\d+\.\d+\.\d+/, 'Version should be semver format')
      assert.ok(result[2].includes('OffRamp'), 'typeAndVersion should contain OffRamp')
    })

    it('should return valid typeAndVersion for OnRamp', async () => {
      const result = await tonChain.typeAndVersion(ADDRESSES_TO_ASSERT.tonOnRamp)

      assert.equal(result[0], 'OnRamp', 'Type should be OnRamp')
      assert.match(result[1], /^\d+\.\d+\.\d+/, 'Version should be semver format')
    })

    it('should return valid typeAndVersion for Router', async () => {
      const result = await tonChain.typeAndVersion(ADDRESSES_TO_ASSERT.tonRouter)

      assert.equal(result[0], 'Router', 'Type should be Router')
      assert.match(result[1], /^\d+\.\d+\.\d+/, 'Version should be semver format')
    })
  })

  describe('getTokenInfo', () => {
    // Test cases covering all TEP-64 metadata formats using mainnet tokens
    const tokenTestCases = [
      {
        name: 'Onchain Metadata Token (BabyDoge)',
        tokenAddress: 'EQCWDj49HFInSwSk49eAo476E1YBywLoFuSZ6OO3x7jmP2jn',
        tokenType: 'onchain',
        expectedSymbol: 'BabyDoge',
        expectedDecimals: 9,
      },
      {
        name: 'Semichain Metadata Token (USDT)',
        tokenAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
        tokenType: 'semichain',
        expectedSymbol: 'USD₮',
        expectedDecimals: 6,
      },
      {
        name: 'Offchain Metadata Token (SCALE)',
        tokenAddress: 'EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE',
        tokenType: 'offchain',
        expectedSymbol: 'SCALE',
        expectedDecimals: 9,
      },
    ]

    let mainnetChain: TONChain

    before(async () => {
      mainnetChain = await TONChain.fromUrl('https://mainnet-v4.tonhubapi.com')
    })

    for (const tc of tokenTestCases) {
      it(`should parse ${tc.name}`, async () => {
        const result = await mainnetChain.getTokenInfo(tc.tokenAddress)

        assert.equal(result.symbol, tc.expectedSymbol, `Symbol mismatch for ${tc.tokenType} token`)
        assert.equal(
          result.decimals,
          tc.expectedDecimals,
          `Decimals mismatch for ${tc.tokenType} token`,
        )
      })
    }

    it('should return defaults for non-Jetton contract', async () => {
      // Use a valid address that doesn't have get_jetton_data (e.g., Router)
      const result = await tonChain.getTokenInfo(ADDRESSES_TO_ASSERT.tonRouter)

      assert.equal(result.symbol, '', 'Should return default symbol')
      assert.equal(result.decimals, 9, 'Should return default decimals')
    })

    it('should throw for invalid address format', async () => {
      await assert.rejects(
        () => tonChain.getTokenInfo('invalid-address'),
        /Unknown address type|Invalid address/i,
        'Should throw for invalid address',
      )
    })
  })

  describe('getTransaction', () => {
    let knownTxHash: string

    before(async () => {
      // Get a known transaction hash from logs
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 1,
      })) {
        knownTxHash = log.transactionHash
        break
      }
    })

    it('should fetch transaction by composite hash', async () => {
      assert.ok(knownTxHash, 'Should have a known transaction hash from logs')

      const tx = await tonChain.getTransaction(knownTxHash)

      assert.equal(tx.hash, knownTxHash)
      assert.ok(tx.blockNumber > 0, 'blockNumber should be positive')
      assert.ok(tx.timestamp > 0, 'timestamp should be positive')
      assert.ok(Array.isArray(tx.logs), 'logs should be an array')
    })

    it('should fetch transaction by raw 64-char hex hash via TonCenter', async () => {
      assert.ok(knownTxHash, 'Should have a known transaction hash from logs')

      // Extract the raw hash (last part of composite format)
      const parts = knownTxHash.split(':')
      assert.equal(parts.length, 4, 'Should have 4 parts in composite hash')
      const rawHash = parts[3]

      // Lookup by raw hash should resolve via TonCenter V3 API
      const tx = await tonChain.getTransaction(rawHash)

      // Should resolve to the same transaction
      assert.equal(
        tx.hash.toLowerCase(),
        knownTxHash.toLowerCase(),
        'Should resolve to same composite hash',
      )
      assert.ok(tx.blockNumber > 0, 'blockNumber should be positive')
    })

    it('should fetch transaction by 0x-prefixed raw hash', async () => {
      assert.ok(knownTxHash)

      const parts = knownTxHash.split(':')
      const rawHash = `0x${parts[3]}`

      const tx = await tonChain.getTransaction(rawHash)

      assert.equal(
        tx.hash.toLowerCase(),
        knownTxHash.toLowerCase(),
        'Should resolve to same composite hash',
      )
    })

    it('should return logs with valid structure', async () => {
      assert.ok(knownTxHash)

      const tx = await tonChain.getTransaction(knownTxHash)

      // OnRamp transactions should have external-out messages (CCIPMessageSent events)
      if (tx.logs.length > 0) {
        const log = tx.logs[0]
        assert.ok(log.address, 'log should have address')
        assert.ok(log.data, 'log should have data')
        assert.equal(log.transactionHash, knownTxHash, 'log transactionHash should match')
        assert.equal(typeof log.index, 'number', 'log index should be a number')
      }
    })

    it('should throw for non-existent transaction', async () => {
      const fakeHash = `0:${'a'.repeat(64)}:999999999999:${'b'.repeat(64)}`

      await assert.rejects(
        tonChain.getTransaction(fakeHash),
        /not found/i,
        'Should throw for non-existent transaction',
      )
    })

    it('should throw for invalid hash format', async () => {
      await assert.rejects(
        tonChain.getTransaction('invalid-format'),
        /Invalid TON transaction hash format/,
        'Should throw for invalid format',
      )
    })
  })

  describe('getBlockTimestamp', () => {
    it('should return timestamp for finalized block', async () => {
      const timestamp = await tonChain.getBlockTimestamp('finalized')
      assert.ok(timestamp > 0, 'timestamp should be positive')
    })

    it('should return cached timestamp after getLogs', async () => {
      // First, get a log to populate the cache
      let logLt: number | undefined
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 1,
      })) {
        logLt = log.blockNumber
        break
      }

      assert.ok(logLt, 'Should have found a log')

      // Now getBlockTimestamp should work for that lt
      const timestamp = await tonChain.getBlockTimestamp(logLt)
      assert.ok(timestamp > 0, 'timestamp should be positive')
    })

    it('should throw for uncached lt', async () => {
      const fakeLt = 999999999999999

      await assert.rejects(
        () => tonChain.getBlockTimestamp(fakeLt),
        /not in cache/i,
        'Should throw for uncached lt',
      )
    })
  })

  describe('fetchRequestsInTx', () => {
    it('should parse CCIP request from OnRamp transaction', async () => {
      // Get a known transaction with CCIPMessageSent
      let txHash: string | undefined
      for await (const log of tonChain.getLogs({
        address: ADDRESSES_TO_ASSERT.tonOnRamp,
        page: 1,
      })) {
        if (TONChain.decodeMessage(log)) {
          txHash = log.transactionHash
          break
        }
      }

      assert.ok(txHash, 'Should find a transaction with CCIP message')

      const requests = await tonChain.fetchRequestsInTx(txHash)

      assert.ok(requests.length > 0, 'Should find at least one CCIP request')

      const request = requests[0]
      assert.ok(request.message, 'request should have message')
      assert.ok(request.log, 'request should have log')
      assert.ok(request.lane, 'request should have lane')
      assert.equal(request.lane.sourceChainSelector, TON_TESTNET_CHAIN_SELECTOR)
      assert.equal(request.lane.destChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })
  })
})
