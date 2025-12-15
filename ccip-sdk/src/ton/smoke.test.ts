import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import { TONChain } from './index.ts'

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
    // Real transaction from TON testnet
    // https://testnet.tonviewer.com/transaction/2d933807e103d1839be2870ff03f8c56739c561af9a41f195f049c4dedccd260
    const testHash = '2d933807e103d1839be2870ff03f8c56739c561af9a41f195f049c4dedccd260'
    const expectedSender = '0:e96e915e5d1d8318f41c018fc5afc6f5a30c7f2ba2dbbd1a33f42b7e249bf826' // EQDpbpFeXR2DGPQcAY_Fr8b1owx_K6LbvRoz9Ct-JJv4JvhN in raw format
    const expectedLt = 42352673000001
    const expectedTimestamp = 1765557346
    // Pre-computed composite hash for this transaction
    const expectedCompositeHash = `${expectedSender}:${expectedLt}:${testHash}`

    it('TONChain.getTransactionByHash should fetch transaction by raw hash', async () => {
      const result = await tonChain.getTransactionByHash(testHash)

      // Verify composite hash format: workchain:address:lt:hash
      const parts = result.hash.split(':')
      assert.equal(parts.length, 4, 'hash should have 4 parts separated by colons')
      assert.equal(parts[0], '0', 'workchain should be 0')
      assert.equal(parts[3], testHash, 'last part should be the original hash')

      // Verify sender address (raw format)
      assert.equal(
        result.from.toLowerCase(),
        expectedSender.toLowerCase(),
        'from should match the sender address',
      )
      // Verify logical time (lt) is used as blockNumber
      assert.equal(result.blockNumber, expectedLt, 'blockNumber should be the logical time (lt)')

      // Verify timestamp
      assert.equal(result.timestamp, expectedTimestamp, 'timestamp should match')

      // Verify logs are empty (TODO: not yet implemented)
      assert.deepEqual(result.logs, [], 'logs should be empty array')
    })

    it('TONChain.getTransactionByHash should throw for non-existent hash', async () => {
      const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000'

      await assert.rejects(tonChain.getTransactionByHash(fakeHash), /Transaction not found/)
    })

    it('TONChain.getTransaction should fetch transaction by raw hash (no prefix)', async () => {
      const result = await tonChain.getTransaction(testHash)

      // Should return the same data as getTransactionByHash
      assert.equal(
        result.hash.toLowerCase(),
        expectedCompositeHash.toLowerCase(),
        'hash should be composite format',
      )
      assert.equal(
        result.from.toLowerCase(),
        expectedSender.toLowerCase(),
        'from should match the sender address',
      )
      assert.equal(result.blockNumber, expectedLt, 'blockNumber should be the logical time (lt)')
      assert.equal(result.timestamp, expectedTimestamp, 'timestamp should match')
    })

    it('TONChain.getTransaction should fetch transaction by raw hash (0x prefix)', async () => {
      const result = await tonChain.getTransaction(`0x${testHash}`)

      // Should return the same data as getTransactionByHash
      assert.equal(
        result.hash.toLowerCase(),
        expectedCompositeHash.toLowerCase(),
        'hash should be composite format',
      )
      assert.equal(
        result.from.toLowerCase(),
        expectedSender.toLowerCase(),
        'from should match the sender address',
      )
      assert.equal(result.blockNumber, expectedLt, 'blockNumber should be the logical time (lt)')
      assert.equal(result.timestamp, expectedTimestamp, 'timestamp should match')
    })

    it('TONChain.getTransaction should fetch transaction by composite hash', async () => {
      // First, get the composite hash from a raw hash lookup
      const firstResult = await tonChain.getTransaction(testHash)
      const compositeHash = firstResult.hash

      // Now fetch using the composite format
      const result = await tonChain.getTransaction(compositeHash)

      // Should return the same data
      assert.equal(result.hash, compositeHash, 'hash should match composite format')
      assert.equal(
        result.from.toLowerCase(),
        expectedSender.toLowerCase(),
        'from should match the sender address',
      )
      assert.equal(result.blockNumber, expectedLt, 'blockNumber should be the logical time (lt)')
      assert.equal(result.timestamp, expectedTimestamp, 'timestamp should match')
    })

    it('TONChain.getTransaction should throw for invalid hash format', async () => {
      const invalidHash = 'not-a-valid-hash'

      await assert.rejects(
        tonChain.getTransaction(invalidHash),
        /Invalid TON transaction hash format/,
      )
    })

    it('TONChain.getTransaction should throw for non-existent raw hash', async () => {
      const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000'

      await assert.rejects(tonChain.getTransaction(fakeHash), /Transaction not found/)
    })
  })
})
