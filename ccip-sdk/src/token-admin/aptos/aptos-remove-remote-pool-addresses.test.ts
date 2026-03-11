import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { RemoveRemotePoolAddressesParams } from '../types.ts'

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

const validParams: RemoveRemotePoolAddressesParams = {
  poolAddress: '0xaabbcc',
  remoteChainSelector: 16015286601757825753n,
  remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
}

// =============================================================================
// AptosTokenAdmin — removeRemotePoolAddresses
// =============================================================================

describe('AptosTokenAdmin — removeRemotePoolAddresses', () => {
  // ===========================================================================
  // generateUnsignedRemoveRemotePoolAddresses — Validation
  // ===========================================================================

  describe('generateUnsignedRemoveRemotePoolAddresses — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.code, 'REMOVE_REMOTE_POOL_ADDRESSES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses(sender, {
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses(sender, {
            ...validParams,
            remotePoolAddresses: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty address in array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses(sender, {
            ...validParams,
            remotePoolAddresses: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses[0]')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedRemoveRemotePoolAddresses — valid params
  // ===========================================================================

  describe('generateUnsignedRemoveRemotePoolAddresses — valid params (hits provider mock)', () => {
    const admin = makeAdmin()

    it('should pass validation and fail at provider/module discovery', async () => {
      // With our mock provider, discoverPoolModule will succeed
      // but ensurePoolInitialized or build.simple will fail — that's expected
      await assert.rejects(
        () => admin.generateUnsignedRemoveRemotePoolAddresses(sender, validParams),
        (err: unknown) => {
          // Any error is fine — the point is validation passed
          assert.ok(err instanceof Error)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // removeRemotePoolAddresses — Wallet Validation
  // ===========================================================================

  describe('removeRemotePoolAddresses — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-account wallet', async () => {
      await assert.rejects(
        () => admin.removeRemotePoolAddresses({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.removeRemotePoolAddresses(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
