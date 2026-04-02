import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPTransferAdminRoleParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
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
  newAdmin: '0xabe0ac8b56eb54a1',
  routerAddress: '0xabc123',
}

// =============================================================================
// AptosTokenAdmin — transferAdminRole
// =============================================================================

describe('AptosTokenAdmin — transferAdminRole', () => {
  // ===========================================================================
  // generateUnsignedTransferAdminRole — Validation
  // ===========================================================================

  describe('generateUnsignedTransferAdminRole — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferAdminRole(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferAdminRoleParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty newAdmin', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferAdminRole(sender, {
            ...validParams,
            newAdmin: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferAdminRoleParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'newAdmin')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferAdminRole(sender, {
            ...validParams,
            routerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferAdminRoleParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider)', async () => {
      // Validation passes, fails at buildTransaction (mock provider)
      await assert.rejects(
        () => admin.generateUnsignedTransferAdminRole(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPTransferAdminRoleParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // transferAdminRole — Wallet Validation
  // ===========================================================================

  describe('transferAdminRole — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.transferAdminRole({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.transferAdminRole(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.transferAdminRole(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })
  })
})
