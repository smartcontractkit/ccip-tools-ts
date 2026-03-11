import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import '../index.ts'

import { CCIPAPIClient } from './index.ts'
import {
  CCIPLaneNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageNotFoundInTxError,
} from '../errors/index.ts'
import { MessageStatus } from '../types.ts'

// Test data from CLI E2E tests (show.test.ts)
const SEPOLIA_SELECTOR = 16015286601757825753n
const FUJI_SELECTOR = 14767482510784806043n
const KNOWN_MESSAGE_ID = '0xdfb374fef50749b0bc86784e097ecc9547c5145ddfb8f9d96f1da3024abfcd04'
const KNOWN_TX_HASH = '0x25e63fa89abb77acd353edc24ed3ab5880a8d206c8229e6f61dc00d399f447b3'

// Multi-chain-family senders for searchMessages tests
const EVM_SENDER = '0x9d087fC03ae39b088326b67fA3C788236645b717'
const SOLANA_SENDER = 'EPUjBP3Xf76K1VKsDSc6GupBWE8uykNksCLJgXZn87CB'
const APTOS_SENDER = '0x9d5f576e963f593c8be9a22baad798fe2bb4a4103f2d719181362a75fa162eaf'

describe(
  'CCIPAPIClient - Staging API Integration',
  { skip: !!process.env.SKIP_INTEGRATION_TESTS },
  () => {
    let api: CCIPAPIClient

    before(() => {
      // Uses staging API by default (api.ccip.cldev.cloud)
      api = CCIPAPIClient.fromUrl()
    })

    describe('getLaneLatency', () => {
      it('should return totalMs for valid testnet lane', { timeout: 30000 }, async () => {
        const result = await api.getLaneLatency(SEPOLIA_SELECTOR, FUJI_SELECTOR)

        assert.equal(typeof result.totalMs, 'number')
        assert.ok(result.totalMs > 0, `Expected positive totalMs, got ${result.totalMs}`)
      })

      it(
        'should throw CCIPLaneNotFoundError for non-existent lane',
        { timeout: 30000 },
        async () => {
          const INVALID_SELECTOR = 999999999999n

          await assert.rejects(
            () => api.getLaneLatency(SEPOLIA_SELECTOR, INVALID_SELECTOR),
            (err: Error) => {
              assert.ok(err instanceof CCIPLaneNotFoundError)
              return true
            },
          )
        },
      )
    })

    describe('getMessageById', () => {
      it(
        'should return full message details for known message ID',
        { timeout: 30000 },
        async () => {
          const result = await api.getMessageById(KNOWN_MESSAGE_ID)

          assert.equal(result.message.messageId, KNOWN_MESSAGE_ID)
          assert.ok(result.lane, 'Result should include lane')
          assert.equal(result.lane.sourceChainSelector, SEPOLIA_SELECTOR)
          assert.equal(result.lane.destChainSelector, FUJI_SELECTOR)
          assert.ok(result.message.sender, 'Message should have sender')
          assert.ok(result.message.receiver, 'Message should have receiver')
          assert.ok(
            typeof result.message.sequenceNumber === 'bigint',
            'sequenceNumber should be bigint',
          )
          assert.ok(result.metadata, 'Result should include metadata')
          assert.ok(result.metadata.status, 'Metadata should include status')
        },
      )

      it('should return correct lane information', { timeout: 30000 }, async () => {
        const result = await api.getMessageById(KNOWN_MESSAGE_ID)

        assert.ok(result.metadata, 'Should have metadata')
        assert.ok(result.metadata.sourceNetworkInfo, 'Should have sourceNetworkInfo')
        assert.equal(result.metadata.sourceNetworkInfo.chainSelector, SEPOLIA_SELECTOR)
        assert.match(result.metadata.sourceNetworkInfo.name, /sepolia/i)

        assert.ok(result.metadata.destNetworkInfo, 'Should have destNetworkInfo')
        assert.equal(result.metadata.destNetworkInfo.chainSelector, FUJI_SELECTOR)
        assert.match(result.metadata.destNetworkInfo.name, /fuji|avalanche/i)
      })

      it('should return correct message status', { timeout: 30000 }, async () => {
        const result = await api.getMessageById(KNOWN_MESSAGE_ID)

        assert.ok(result.metadata, 'Should have metadata')
        const validStatuses = Object.values(MessageStatus)
        assert.ok(
          validStatuses.includes(result.metadata.status),
          `Status "${result.metadata.status}" should be a valid MessageStatus`,
        )
        assert.equal(result.metadata.status, MessageStatus.Success)
      })

      it(
        'should throw CCIPMessageIdNotFoundError for non-existent message',
        { timeout: 30000 },
        async () => {
          const FAKE_MESSAGE_ID =
            '0x0000000000000000000000000000000000000000000000000000000000000000'

          await assert.rejects(
            () => api.getMessageById(FAKE_MESSAGE_ID),
            (err: Error) => {
              assert.ok(err instanceof CCIPMessageIdNotFoundError)
              return true
            },
          )
        },
      )
    })

    describe('searchMessages', () => {
      it('should return results for EVM sender', { timeout: 30000 }, async () => {
        const page = await api.searchMessages({ sender: EVM_SENDER }, { limit: 5 })

        assert.ok(Array.isArray(page.data), 'Should return data array')
        assert.ok(page.data.length > 0, `Should find messages for EVM sender ${EVM_SENDER}`)
        for (const msg of page.data) {
          assert.ok(msg.messageId, 'Each result should have messageId')
          assert.ok(msg.status, 'Each result should have status')
          assert.ok(msg.sourceNetworkInfo, 'Each result should have sourceNetworkInfo')
          assert.ok(msg.destNetworkInfo, 'Each result should have destNetworkInfo')
        }
      })

      it('should return results for Solana sender', { timeout: 30000 }, async () => {
        const page = await api.searchMessages({ sender: SOLANA_SENDER }, { limit: 5 })

        assert.ok(Array.isArray(page.data), 'Should return data array')
        assert.ok(page.data.length > 0, `Should find messages for Solana sender ${SOLANA_SENDER}`)
      })

      it('should return results for Aptos sender', { timeout: 30000 }, async () => {
        const page = await api.searchMessages({ sender: APTOS_SENDER }, { limit: 5 })

        assert.ok(Array.isArray(page.data), 'Should return data array')
        assert.ok(page.data.length > 0, `Should find messages for Aptos sender ${APTOS_SENDER}`)
      })

      it('should return results for sourceTransactionHash filter', { timeout: 30000 }, async () => {
        const page = await api.searchMessages({ sourceTransactionHash: KNOWN_TX_HASH })

        assert.ok(page.data.length >= 1, 'Should find at least one message')
        assert.ok(
          page.data.some((msg) => msg.messageId === KNOWN_MESSAGE_ID),
          `Should include known message ID ${KNOWN_MESSAGE_ID}`,
        )
      })

      it('should support mixed filters (sender + lane)', { timeout: 30000 }, async () => {
        // First get a message to know its lane
        const allPage = await api.searchMessages({ sender: EVM_SENDER }, { limit: 1 })
        assert.ok(allPage.data.length > 0, 'Should find at least one message for EVM sender')

        const msg = allPage.data[0]!
        const sourceSelector = msg.sourceNetworkInfo.chainSelector
        const destSelector = msg.destNetworkInfo.chainSelector

        // Now search with mixed filters
        const filteredPage = await api.searchMessages({
          sender: EVM_SENDER,
          sourceChainSelector: sourceSelector,
          destChainSelector: destSelector,
        })

        assert.ok(filteredPage.data.length > 0, 'Should find messages with mixed filters')
        for (const result of filteredPage.data) {
          assert.equal(result.sourceNetworkInfo.chainSelector, sourceSelector)
          assert.equal(result.destNetworkInfo.chainSelector, destSelector)
        }
      })

      it('should paginate with cursor', { timeout: 30000 }, async () => {
        // Get first page with small limit
        const page1 = await api.searchMessages({ sender: EVM_SENDER }, { limit: 1 })

        assert.ok(page1.data.length === 1, 'First page should have 1 result')

        if (page1.hasNextPage) {
          assert.ok(page1.cursor, 'Should have cursor when hasNextPage is true')
          const page2 = await api.searchMessages(undefined, { cursor: page1.cursor })

          assert.ok(page2.data.length > 0, 'Second page should have results')
          // Ensure no duplicates across pages
          assert.notEqual(
            page1.data[0]!.messageId,
            page2.data[0]!.messageId,
            'Pages should not have duplicate messages',
          )
        }
      })

      it(
        'should support cross-chain-family filters (EVM sender + Solana receiver)',
        { timeout: 30000 },
        async () => {
          const page = await api.searchMessages({
            sender: EVM_SENDER,
            receiver: SOLANA_SENDER,
          })

          assert.ok(page.data.length > 0, 'Should find EVM→Solana messages')
          for (const msg of page.data) {
            assert.match(msg.destNetworkInfo.name, /solana/i, 'Dest should be a Solana network')
          }
        },
      )

      it('should filter by readyForManualExecOnly', { timeout: 30000 }, async () => {
        const page = await api.searchMessages(
          { sender: EVM_SENDER, readyForManualExecOnly: true },
          { limit: 5 },
        )

        // May have 0 results if no messages are currently ready for manual exec
        for (const msg of page.data) {
          assert.equal(msg.status, 'FAILED', 'Manual exec messages should have FAILED status')
        }
      })

      it('should paginate multiple pages without duplicates', { timeout: 30000 }, async () => {
        const page1 = await api.searchMessages({ sender: EVM_SENDER }, { limit: 2 })
        assert.equal(page1.data.length, 2, 'First page should have 2 results')
        assert.ok(page1.hasNextPage, 'EVM sender should have more than 2 messages')
        assert.ok(page1.cursor, 'Should have cursor')

        const page2 = await api.searchMessages(undefined, { cursor: page1.cursor, limit: 2 })
        assert.equal(page2.data.length, 2, 'Second page should have 2 results')

        const page1Ids = new Set(page1.data.map((m) => m.messageId))
        for (const msg of page2.data) {
          assert.ok(
            !page1Ids.has(msg.messageId),
            `Duplicate messageId across pages: ${msg.messageId}`,
          )
        }
      })

      it('should return empty data for non-existent sender', { timeout: 30000 }, async () => {
        const page = await api.searchMessages({
          sender: '0x0000000000000000000000000000000000000001',
        })

        assert.equal(page.data.length, 0, 'Should find no messages for non-existent sender')
        assert.equal(page.hasNextPage, false)
      })

      it('should have valid MessageStatus on results', { timeout: 30000 }, async () => {
        const page = await api.searchMessages({ sender: EVM_SENDER }, { limit: 5 })

        const validStatuses = Object.values(MessageStatus)
        for (const msg of page.data) {
          assert.ok(
            validStatuses.includes(msg.status),
            `Status "${msg.status}" should be a valid MessageStatus`,
          )
        }
      })
    })

    describe('searchAllMessages', () => {
      it('should iterate all messages for a known sender', { timeout: 60000 }, async () => {
        const results = []
        for await (const msg of api.searchAllMessages({ sender: EVM_SENDER }, { limit: 5 })) {
          results.push(msg)
          if (results.length >= 10) break // cap to avoid long test
        }
        assert.ok(results.length > 0, 'Should yield at least one message')
        for (const msg of results) {
          assert.ok(msg.messageId, 'Each result should have a messageId')
          assert.ok(msg.status, 'Each result should have a status')
        }
      })

      it(
        'should stop on early break without fetching unnecessary pages',
        { timeout: 30000 },
        async () => {
          let count = 0
          for await (const msg of api.searchAllMessages({ sender: EVM_SENDER }, { limit: 1 })) {
            count++
            assert.ok(msg.messageId)
            break // stop after first result
          }
          assert.equal(count, 1)
        },
      )

      it('should yield results consistent with searchMessages', { timeout: 60000 }, async () => {
        // Fetch first page via searchMessages
        const page = await api.searchMessages({ sender: EVM_SENDER }, { limit: 3 })

        // Fetch same results via searchAllMessages
        const generatorResults = []
        for await (const msg of api.searchAllMessages({ sender: EVM_SENDER }, { limit: 3 })) {
          generatorResults.push(msg)
          if (generatorResults.length >= page.data.length) break
        }

        assert.equal(generatorResults.length, page.data.length)
        for (let i = 0; i < page.data.length; i++) {
          assert.equal(generatorResults[i]!.messageId, page.data[i]!.messageId)
        }
      })
    })

    describe('getMessageIdsInTx', () => {
      it('should return message IDs for known CCIP transaction', { timeout: 30000 }, async () => {
        const messageIds = await api.getMessageIdsInTx(KNOWN_TX_HASH)

        assert.ok(Array.isArray(messageIds), 'Should return an array')
        assert.ok(messageIds.length >= 1, 'Should find at least one message')
        assert.ok(
          messageIds.includes(KNOWN_MESSAGE_ID),
          `Should include known message ID ${KNOWN_MESSAGE_ID}`,
        )
      })

      it(
        'should throw CCIPMessageNotFoundInTxError for non-CCIP transaction',
        { timeout: 30000 },
        async () => {
          const NON_CCIP_TX = '0x0000000000000000000000000000000000000000000000000000000000000001'

          await assert.rejects(
            () => api.getMessageIdsInTx(NON_CCIP_TX),
            (err: Error) => {
              assert.ok(err instanceof CCIPMessageNotFoundInTxError)
              return true
            },
          )
        },
      )
    })
  },
)
