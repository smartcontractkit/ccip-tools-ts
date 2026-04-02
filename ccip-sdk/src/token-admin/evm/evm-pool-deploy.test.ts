import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import { CCIPPoolDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
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

describe('EVMTokenAdmin — deployPool', () => {
  // =============================================================================
  // generateUnsignedDeployPool — Validation
  // =============================================================================

  describe('generateUnsignedDeployPool — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      poolType: 'burn-mint' as const,
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      localTokenDecimals: 18,
      routerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    }

    it('should reject invalid poolType', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool({
            ...validParams,
            poolType: 'invalid' as 'burn-mint',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.code, 'POOL_DEPLOY_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolType')
          return true
        },
      )
    })

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployPool({ ...validParams, tokenAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployPool({ ...validParams, routerAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })

    it('should accept lock-release poolType', async () => {
      // This will fail at the RPC call (no running node), but validates params pass
      await assert.rejects(
        () => admin.generateUnsignedDeployPool({ ...validParams, poolType: 'lock-release' }),
        (err: unknown) => {
          // Should NOT be a params invalid error — params are valid
          assert.ok(!(err instanceof CCIPPoolDeployParamsInvalidError))
          return true
        },
      )
    })

    it('should accept burn-mint poolType with valid params (fails at RPC)', async () => {
      // Validation passes, fails at getArmProxy RPC call
      await assert.rejects(
        () => admin.generateUnsignedDeployPool(validParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPPoolDeployParamsInvalidError))
          return true
        },
      )
    })
  })

  // =============================================================================
  // deployPool — Wallet Validation
  // =============================================================================

  describe('deployPool — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () =>
          admin.deployPool(
            {},
            {
              poolType: 'burn-mint',
              tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
              localTokenDecimals: 18,
              routerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            },
          ),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () =>
          admin.deployPool(null, {
            poolType: 'burn-mint',
            tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
            localTokenDecimals: 18,
            routerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
