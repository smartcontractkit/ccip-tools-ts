import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import { CCIPTokenDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const mockProvider = {
  getTransactionByVersion: async () => ({}),
} as unknown as Aptos

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'aptos-testnet',
  family: ChainFamily.Aptos,
  chainSelector: 1n,
  chainId: 'aptos:2' as `aptos:${number}`,
  networkType: NetworkType.Testnet,
}

// ── Helpers ──

function makeAdmin(): AptosTokenAdmin {
  return new AptosTokenAdmin(mockProvider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

// =============================================================================
// AptosTokenAdmin — Construction
// =============================================================================

describe('AptosTokenAdmin', () => {
  describe('constructor', () => {
    it('should create instance with provider', () => {
      const admin = new AptosTokenAdmin(mockProvider, dummyNetwork, { apiClient: null })
      assert.equal(admin.provider, mockProvider)
    })
  })

  // ===========================================================================
  // generateUnsignedDeployToken — Validation
  // ===========================================================================

  describe('generateUnsignedDeployToken', () => {
    const admin = makeAdmin()
    const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    it('should reject empty name', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: '',
            symbol: 'MTK',
            decimals: 8,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.code, 'TOKEN_DEPLOY_PARAMS_INVALID')
          assert.equal(err.context.param, 'name')
          return true
        },
      )
    })

    it('should reject empty symbol', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: '',
            decimals: 8,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'symbol')
          return true
        },
      )
    })

    it('should reject negative initialSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: 'MTK',
            decimals: 8,
            initialSupply: -1n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'initialSupply')
          return true
        },
      )
    })

    it('should reject negative maxSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: 'MTK',
            decimals: 8,
            maxSupply: -1n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'maxSupply')
          return true
        },
      )
    })

    it('should reject initialSupply > maxSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: 'MTK',
            decimals: 8,
            maxSupply: 100n,
            initialSupply: 200n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'initialSupply')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // deployToken — Wallet Validation
  // ===========================================================================

  describe('deployToken', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.deployToken({}, { name: 'Token', symbol: 'MTK', decimals: 8 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deployToken(null, { name: 'Token', symbol: 'MTK', decimals: 8 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.deployToken(undefined, { name: 'Token', symbol: 'MTK', decimals: 8 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
