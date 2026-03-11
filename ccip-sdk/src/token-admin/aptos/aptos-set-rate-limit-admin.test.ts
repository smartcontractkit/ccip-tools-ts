import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import { CCIPMethodUnsupportedError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

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

function makeAdmin(): AptosTokenAdmin {
  return new AptosTokenAdmin(mockProvider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

describe('AptosTokenAdmin — setRateLimitAdmin', () => {
  describe('generateUnsignedSetRateLimitAdmin — not supported', () => {
    const admin = makeAdmin()

    it('should throw CCIPMethodUnsupportedError', () => {
      assert.throws(
        () =>
          admin.generateUnsignedSetRateLimitAdmin(sender, {
            poolAddress: '0xaabbcc',
            rateLimitAdmin: '0xddeeff',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPMethodUnsupportedError)
          assert.equal(err.code, 'METHOD_UNSUPPORTED')
          assert.equal(err.context.class, 'AptosTokenAdmin')
          assert.equal(err.context.method, 'setRateLimitAdmin')
          return true
        },
      )
    })
  })

  describe('setRateLimitAdmin — not supported', () => {
    const admin = makeAdmin()

    it('should throw CCIPMethodUnsupportedError for any wallet', () => {
      assert.throws(
        () =>
          admin.setRateLimitAdmin(
            { signTransaction: async () => ({}) },
            { poolAddress: '0xaabbcc', rateLimitAdmin: '0xddeeff' },
          ),
        (err: unknown) => {
          assert.ok(err instanceof CCIPMethodUnsupportedError)
          assert.equal(err.code, 'METHOD_UNSUPPORTED')
          return true
        },
      )
    })

    it('should throw CCIPMethodUnsupportedError for null wallet', () => {
      assert.throws(
        () =>
          admin.setRateLimitAdmin(null, {
            poolAddress: '0xaabbcc',
            rateLimitAdmin: '0xddeeff',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPMethodUnsupportedError)
          return true
        },
      )
    })
  })
})
