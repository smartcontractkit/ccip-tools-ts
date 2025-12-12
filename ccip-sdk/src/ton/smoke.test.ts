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
})
