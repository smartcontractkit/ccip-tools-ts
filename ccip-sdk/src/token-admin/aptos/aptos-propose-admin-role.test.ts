import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPProposeAdminRoleParamsInvalidError,
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
  administrator: '0xabcdef123456',
  routerAddress: '0xabc123',
}

// =============================================================================
// AptosTokenAdmin — proposeAdminRole
// =============================================================================

describe('AptosTokenAdmin — proposeAdminRole', () => {
  // ===========================================================================
  // generateUnsignedProposeAdminRole — Validation
  // ===========================================================================

  describe('generateUnsignedProposeAdminRole — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedProposeAdminRole(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.code, 'PROPOSE_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty administrator', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedProposeAdminRole(sender, {
            ...validParams,
            administrator: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.context.param, 'administrator')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedProposeAdminRole(sender, {
            ...validParams,
            routerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider)', async () => {
      // Validation passes, fails at buildTransaction (mock provider)
      await assert.rejects(
        () => admin.generateUnsignedProposeAdminRole(sender, validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPProposeAdminRoleParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // proposeAdminRole — Wallet Validation
  // ===========================================================================

  describe('proposeAdminRole — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.proposeAdminRole({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.proposeAdminRole(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.proposeAdminRole(undefined, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
