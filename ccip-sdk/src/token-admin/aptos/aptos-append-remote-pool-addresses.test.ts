import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPAppendRemotePoolAddressesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { AppendRemotePoolAddressesParams } from '../types.ts'

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

const validParams: AppendRemotePoolAddressesParams = {
  poolAddress: '0xaabbcc',
  remoteChainSelector: 16015286601757825753n,
  remotePoolAddresses: ['0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'],
}

// =============================================================================
// AptosTokenAdmin — appendRemotePoolAddresses
// =============================================================================

describe('AptosTokenAdmin — appendRemotePoolAddresses', () => {
  // ===========================================================================
  // generateUnsignedAppendRemotePoolAddresses — Validation
  // ===========================================================================

  describe('generateUnsignedAppendRemotePoolAddresses — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.code, 'APPEND_REMOTE_POOL_ADDRESSES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            remotePoolAddresses: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty address in remotePoolAddresses array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            remotePoolAddresses: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses[0]')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider for tx build)', async () => {
      // Validation passes, module discovery succeeds, but fails at buildTransaction
      await assert.rejects(
        () => admin.generateUnsignedAppendRemotePoolAddresses(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // appendRemotePoolAddresses — Wallet Validation
  // ===========================================================================

  describe('appendRemotePoolAddresses — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
