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
