import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import type { ChainTransaction } from '../types.ts'
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

  describe('Transaction lookup', () => {
    describe('Basic transaction', () => {
      // Real transaction from TON testnet
      // https://testnet.tonviewer.com/transaction/2d933807e103d1839be2870ff03f8c56739c561af9a41f195f049c4dedccd260
      const testHash = '2d933807e103d1839be2870ff03f8c56739c561af9a41f195f049c4dedccd260'
      const expectedSender = '0:e96e915e5d1d8318f41c018fc5afc6f5a30c7f2ba2dbbd1a33f42b7e249bf826'
      const expectedLt = 42352673000001
      const expectedTimestamp = 1765557346
      const expectedCompositeHash = `${expectedSender}:${expectedLt}:${testHash}`

      it('should fetch transaction by raw hash', async () => {
        const result = await tonChain.getTransaction(testHash)
        assert.equal(result.hash.toLowerCase(), expectedCompositeHash.toLowerCase())
        assert.equal(result.from.toLowerCase(), expectedSender.toLowerCase())
        assert.equal(result.blockNumber, expectedLt)
        assert.equal(result.timestamp, expectedTimestamp)
      })

      it('should fetch transaction by raw hash with 0x prefix', async () => {
        const result = await tonChain.getTransaction(`0x${testHash}`)
        assert.equal(result.hash.toLowerCase(), expectedCompositeHash.toLowerCase())
        assert.equal(result.from.toLowerCase(), expectedSender.toLowerCase())
      })

      it('should fetch transaction by composite hash', async () => {
        const result = await tonChain.getTransaction(expectedCompositeHash)
        assert.equal(result.hash.toLowerCase(), expectedCompositeHash.toLowerCase())
        assert.equal(result.from.toLowerCase(), expectedSender.toLowerCase())
      })

      it('should throw for invalid hash format', async () => {
        await assert.rejects(
          tonChain.getTransaction('not-a-valid-hash'),
          /Invalid TON transaction hash format/,
        )
      })

      it('should throw for non-existent hash', async () => {
        const fakeHash = '0'.repeat(64)
        await assert.rejects(tonChain.getTransaction(fakeHash), /Transaction not found/)
      })
    })

    describe('CCIP transaction with logs', () => {
      // Real CCIPMessageSent transaction from TON testnet (TON -> Sepolia)
      // Sent by staging monitor with default parameters
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
        onRampAddress: ADDRESSES_TO_ASSERT.tonOnRamp,
      }

      // Fetch once, reuse across all tests
      let tx: ChainTransaction
      let message: CCIPMessage_V1_6_TON | undefined

      before(async () => {
        tx = await tonChain.getTransaction(ccipTxHash)
        message = TONChain.decodeMessage(tx.logs[0])
      })

      it('should retrieve transaction with valid structure', () => {
        assert.ok(tx.hash, 'hash should be present')
        assert.ok(tx.hash.includes(ccipTxHash), 'hash should contain original tx hash')
        assert.ok(tx.blockNumber > 0, 'blockNumber should be positive')
        assert.ok(tx.timestamp > 0, 'timestamp should be positive')
        assert.ok(Array.isArray(tx.logs), 'logs should be an array')
        assert.equal(tx.logs.length, 1, 'Should have exactly one log (CCIPMessageSent)')
      })

      it('should have valid log structure', () => {
        const log = tx.logs[0]

        assert.equal(
          Address.parseRaw(log.address).toString(),
          Address.parse(expected.onRampAddress).toString(),
          'log address should be OnRamp',
        )
        assert.ok(log.data, 'log should have data')
        assert.equal(typeof log.data, 'string', 'log data should be string (base64)')
        assert.equal(log.index, 0, 'log index should be 0')
        assert.ok(log.blockNumber > 0, 'log should have positive blockNumber')
        assert.equal(log.transactionHash, tx.hash, 'log transactionHash should match tx hash')
        assert.deepEqual(log.topics, [], 'TON logs should have empty topics array')
      })

      it('should decode CCIPMessageSent successfully', () => {
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
        assert.ok(
          message.receiver.toLowerCase().endsWith('40d7c009d073e0d740ed2c50ca0a48c84a3f8b47'),
          'receiver should contain EVM address',
        )
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
        assert.equal(message.extraArgs.length, 76, 'extraArgs should be 37 bytes')
      })

      it('should decode tokenAmounts correctly', () => {
        assert.ok(message)
        assert.ok(Array.isArray(message.tokenAmounts))
        assert.equal(message.tokenAmounts.length, 0)
      })
    })

    describe('decodeMessage edge cases', () => {
      it('should return undefined for invalid inputs', () => {
        assert.equal(TONChain.decodeMessage({ data: '' }), undefined)
        assert.equal(TONChain.decodeMessage({ data: undefined as any }), undefined)
        assert.equal(TONChain.decodeMessage({ data: 'not-valid-base64!!!' }), undefined)
        assert.equal(TONChain.decodeMessage({ data: 'SGVsbG8gV29ybGQ=' }), undefined)
      })
    })
  })
})
