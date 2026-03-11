import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPSetRateLimitAdminParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { SetRateLimitAdminParams } from '../types.ts'

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

const validParams: SetRateLimitAdminParams = {
  poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
  rateLimitAdmin: '0xabcdef1234567890abcdef1234567890abcdef12',
}

describe('EVMTokenAdmin — setRateLimitAdmin', () => {
  // =============================================================================
  // generateUnsignedSetRateLimitAdmin — Validation
  // =============================================================================

  describe('generateUnsignedSetRateLimitAdmin — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetRateLimitAdmin({
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimitAdminParamsInvalidError)
          assert.equal(err.code, 'SET_RATE_LIMIT_ADMIN_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetRateLimitAdmin({
            ...validParams,
            rateLimitAdmin: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimitAdminParamsInvalidError)
          assert.equal(err.context.param, 'rateLimitAdmin')
          return true
        },
      )
    })
  })

  // =============================================================================
  // setRateLimitAdmin — Wallet Validation
  // =============================================================================

  describe('setRateLimitAdmin — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.setRateLimitAdmin({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.setRateLimitAdmin(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
