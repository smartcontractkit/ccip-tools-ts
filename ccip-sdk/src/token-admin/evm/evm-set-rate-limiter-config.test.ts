import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_1_6_ABI from '../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, CCIPVersion, ChainFamily, NetworkType } from '../../types.ts'
import type { SetChainRateLimiterConfigParams } from '../types.ts'

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

/** Creates an admin with mocked typeAndVersion to avoid RPC calls. */
function makeAdminWithVersion(provider: JsonRpcProvider, version: string): EVMTokenAdmin {
  const admin = makeAdmin(provider)
  admin.typeAndVersion = async () => ['TokenPool', version, `TokenPool ${version}`]
  return admin
}

const validParams: SetChainRateLimiterConfigParams = {
  poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
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

describe('EVMTokenAdmin — setChainRateLimiterConfig', () => {
  // =============================================================================
  // generateUnsignedSetChainRateLimiterConfig — Validation
  // =============================================================================

  describe('generateUnsignedSetChainRateLimiterConfig — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig({
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
          admin.generateUnsignedSetChainRateLimiterConfig({
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
          admin.generateUnsignedSetChainRateLimiterConfig({
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
          admin.generateUnsignedSetChainRateLimiterConfig({
            ...validParams,
            chainConfigs: [
              {
                ...validParams.chainConfigs[0]!,
                outboundRateLimiterConfig: { isEnabled: true, capacity: 'abc', rate: '0' },
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

    it('should reject empty rate string', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig({
            ...validParams,
            chainConfigs: [
              {
                ...validParams.chainConfigs[0]!,
                inboundRateLimiterConfig: { isEnabled: true, capacity: '100', rate: '' },
              },
            ],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs[0].inboundRateLimiterConfig.rate')
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedSetChainRateLimiterConfig — Happy path (v2.0)
  // =============================================================================

  describe('generateUnsignedSetChainRateLimiterConfig — happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape', async () => {
      const unsigned = await admin.generateUnsignedSetChainRateLimiterConfig(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)

      // Verify the function selector matches setRateLimitConfig (v2.0)
      const iface = new Interface(TokenPool_2_0_ABI)
      const selector = iface.getFunction('setRateLimitConfig')!.selector
      assert.ok(tx.data.startsWith(selector))
    })

    it('should handle multiple chain configs in single tx', async () => {
      const multiParams: SetChainRateLimiterConfigParams = {
        poolAddress: validParams.poolAddress,
        chainConfigs: [
          validParams.chainConfigs[0]!,
          {
            remoteChainSelector: '3734403246176062136',
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
        ],
      }

      const unsigned = await admin.generateUnsignedSetChainRateLimiterConfig(multiParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.ok(unsigned.transactions[0]!.data)
    })

    it('should handle disabled rate limiters with zero values', async () => {
      const disabledParams: SetChainRateLimiterConfigParams = {
        poolAddress: validParams.poolAddress,
        chainConfigs: [
          {
            remoteChainSelector: '16015286601757825753',
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
        ],
      }

      const unsigned = await admin.generateUnsignedSetChainRateLimiterConfig(disabledParams)
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
    })
  })

  // =============================================================================
  // generateUnsignedSetChainRateLimiterConfig — Happy path (v1.6)
  // =============================================================================

  describe('generateUnsignedSetChainRateLimiterConfig — happy path (v1.6)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_6)

    it.after(() => provider.destroy())

    it('should use setChainRateLimiterConfig selector for v1.6', async () => {
      const unsigned = await admin.generateUnsignedSetChainRateLimiterConfig(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      const iface = new Interface(TokenPool_1_6_ABI)
      const selector = iface.getFunction('setChainRateLimiterConfig')!.selector
      assert.ok((tx.data as string).startsWith(selector))
    })

    it('should produce one tx per chain config for v1.6', async () => {
      const multiParams: SetChainRateLimiterConfigParams = {
        poolAddress: validParams.poolAddress,
        chainConfigs: [
          validParams.chainConfigs[0]!,
          {
            remoteChainSelector: '3734403246176062136',
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
        ],
      }

      const unsigned = await admin.generateUnsignedSetChainRateLimiterConfig(multiParams)

      assert.equal(unsigned.transactions.length, 2)
    })
  })

  // =============================================================================
  // setChainRateLimiterConfig — Wallet Validation
  // =============================================================================

  describe('setChainRateLimiterConfig — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
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
  })
})
