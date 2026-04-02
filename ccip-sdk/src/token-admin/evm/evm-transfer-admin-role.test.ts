import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPTransferAdminRoleParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Helpers ──

const dummyNetwork: NetworkInfo = {
  name: 'test',
  family: ChainFamily.EVM,
  chainSelector: 1n,
  chainId: 1,
  networkType: NetworkType.Testnet,
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

function makeAdmin(provider: JsonRpcProvider): EVMTokenAdmin {
  return new EVMTokenAdmin(provider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

describe('EVMTokenAdmin — transferAdminRole', () => {
  // =============================================================================
  // generateUnsignedTransferAdminRole — Validation
  // =============================================================================

  describe('generateUnsignedTransferAdminRole — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      newAdmin: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      routerAddress: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
    }

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () => admin.generateUnsignedTransferAdminRole({ ...validParams, tokenAddress: '' }),
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
        () => admin.generateUnsignedTransferAdminRole({ ...validParams, newAdmin: '' }),
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
        () => admin.generateUnsignedTransferAdminRole({ ...validParams, routerAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferAdminRoleParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })
  })

  // =============================================================================
  // transferAdminRole — Wallet Validation
  // =============================================================================

  describe('transferAdminRole — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      newAdmin: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      routerAddress: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
    }

    it('should reject non-signer wallet', async () => {
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
  })
})
