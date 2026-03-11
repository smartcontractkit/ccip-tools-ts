import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { SetChainRateLimiterConfigParams } from '../types.ts'

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

const validParams: SetChainRateLimiterConfigParams = {
  poolAddress: '0xaabbcc',
  chainConfigs: [
    {
      remoteChainSelector: '16015286601757825753',
      outboundRateLimiterConfig: {
        isEnabled: true,
        capacity: '100000000000000000000000',
        rate: '167000000000000000000',
      },
      inboundRateLimiterConfig: {
        isEnabled: true,
        capacity: '100000000000000000000000',
        rate: '167000000000000000000',
      },
    },
  ],
}

describe('AptosTokenAdmin — setChainRateLimiterConfig', () => {
  // ===========================================================================
  // generateUnsignedSetChainRateLimiterConfig — Validation
  // ===========================================================================

  describe('generateUnsignedSetChainRateLimiterConfig — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.code, 'SET_RATE_LIMITER_CONFIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty chainConfigs', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            chainConfigs: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            chainConfigs: [{ ...validParams.chainConfigs[0]!, remoteChainSelector: '' }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs[0].remoteChainSelector')
          return true
        },
      )
    })

    it('should reject invalid capacity string', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            chainConfigs: [
              {
                ...validParams.chainConfigs[0]!,
                outboundRateLimiterConfig: { isEnabled: true, capacity: 'xyz', rate: '0' },
              },
            ],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs[0].outboundRateLimiterConfig.capacity')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider for tx build)', async () => {
      // Validation passes, module discovery succeeds, but fails at buildTransaction
      await assert.rejects(
        () => admin.generateUnsignedSetChainRateLimiterConfig(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPSetRateLimiterConfigParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // setChainRateLimiterConfig — Wallet Validation
  // ===========================================================================

  describe('setChainRateLimiterConfig — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.setChainRateLimiterConfig({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.setChainRateLimiterConfig(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.setChainRateLimiterConfig(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
