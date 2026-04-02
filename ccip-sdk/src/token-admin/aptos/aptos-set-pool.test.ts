import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import { CCIPSetPoolParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
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

const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

const validParams = {
  tokenAddress: '0x89fd6b14b4a7',
  poolAddress: '0xeb6334947b4',
  routerAddress: '0xabc123',
}

// =============================================================================
// AptosTokenAdmin — setPool
// =============================================================================

describe('AptosTokenAdmin — setPool', () => {
  // ===========================================================================
  // generateUnsignedSetPool — Validation
  // ===========================================================================

  describe('generateUnsignedSetPool — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetPoolParamsInvalidError)
          assert.equal(err.code, 'SET_POOL_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetPoolParamsInvalidError)
          assert.equal(err.code, 'SET_POOL_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            routerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetPoolParamsInvalidError)
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider)', async () => {
      // Validation passes, fails at buildTransaction (mock provider)
      await assert.rejects(
        () => admin.generateUnsignedSetPool(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPSetPoolParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // setPool — Wallet Validation
  // ===========================================================================

  describe('setPool — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.setPool({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.setPool(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.setPool(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
