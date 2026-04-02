import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPDeleteChainConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { DeleteChainConfigParams } from '../types.ts'

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

const validParams: DeleteChainConfigParams = {
  poolAddress: '0xaabbcc',
  remoteChainSelector: 16015286601757825753n,
}

// =============================================================================
// AptosTokenAdmin — deleteChainConfig
// =============================================================================

describe('AptosTokenAdmin — deleteChainConfig', () => {
  // ===========================================================================
  // generateUnsignedDeleteChainConfig — Validation
  // ===========================================================================

  describe('generateUnsignedDeleteChainConfig — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeleteChainConfig(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPDeleteChainConfigParamsInvalidError)
          assert.equal(err.code, 'DELETE_CHAIN_CONFIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeleteChainConfig(sender, {
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPDeleteChainConfigParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider for tx build)', async () => {
      // Validation passes, module discovery succeeds, but fails at buildTransaction
      await assert.rejects(
        () => admin.generateUnsignedDeleteChainConfig(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPDeleteChainConfigParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // deleteChainConfig — Wallet Validation
  // ===========================================================================

  describe('deleteChainConfig — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
