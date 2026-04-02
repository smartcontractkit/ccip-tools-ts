import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPApplyChainUpdatesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { ApplyChainUpdatesParams } from '../types.ts'

// ── Mocks ──

const mockProvider = {
  getTransactionByVersion: async () => ({}),
  getAccountModules: async () => [{ abi: { name: 'managed_token_pool' } }],
  view: async () => ['0x123'],
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

const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

const validParams: ApplyChainUpdatesParams = {
  poolAddress: '0xaabbcc',
  remoteChainSelectorsToRemove: [],
  chainsToAdd: [
    {
      remoteChainSelector: 16015286601757825753n,
      remotePoolAddresses: ['0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'],
      remoteTokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
      outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
      inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
    },
  ],
}

// =============================================================================
// AptosTokenAdmin — applyChainUpdates
// =============================================================================

describe('AptosTokenAdmin — applyChainUpdates', () => {
  // ===========================================================================
  // generateUnsignedApplyChainUpdates — Validation
  // ===========================================================================

  describe('generateUnsignedApplyChainUpdates — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.code, 'APPLY_CHAIN_UPDATES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remoteChainSelector: 0n }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remotePoolAddresses: [] }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty remoteTokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remoteTokenAddress: '' }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remoteTokenAddress')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider for tx build)', async () => {
      // Validation passes, module discovery succeeds, but fails at buildTransaction
      await assert.rejects(
        () => admin.generateUnsignedApplyChainUpdates(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPApplyChainUpdatesParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // applyChainUpdates — Wallet Validation
  // ===========================================================================

  describe('applyChainUpdates — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
