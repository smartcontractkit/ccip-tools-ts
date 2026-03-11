import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import { CCIPPoolDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
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

/** Valid params for managed pool (default tokenModule). */
const managedParams = {
  poolType: 'burn-mint' as const,
  tokenAddress: '0x89fd6b14b4a7',
  localTokenDecimals: 8,
  routerAddress: '0xabc123',
  mcmsAddress: '0x789abc',
}

/** Valid params for generic burn-mint pool. */
const genericBurnMintParams = {
  poolType: 'burn-mint' as const,
  tokenModule: 'generic' as const,
  tokenAddress: '0x89fd6b14b4a7',
  localTokenDecimals: 8,
  routerAddress: '0xabc123',
  mcmsAddress: '0x789abc',
}

/** Valid params for generic lock-release pool. */
const genericLockReleaseParams = {
  ...genericBurnMintParams,
  poolType: 'lock-release' as const,
}

/** Valid params for regulated pool. */
const regulatedParams = {
  poolType: 'burn-mint' as const,
  tokenModule: 'regulated' as const,
  tokenAddress: '0x89fd6b14b4a7',
  localTokenDecimals: 8,
  routerAddress: '0xabc123',
  adminAddress: '0x456abc',
  mcmsAddress: '0x789abc',
}

// =============================================================================
// AptosTokenAdmin — deployPool
// =============================================================================

describe('AptosTokenAdmin — deployPool', () => {
  // ===========================================================================
  // generateUnsignedDeployPool — Shared Validation
  // ===========================================================================

  describe('generateUnsignedDeployPool — shared validation', () => {
    const admin = makeAdmin()
    const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    it('should reject invalid poolType', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...managedParams,
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

    it('should reject invalid tokenModule', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...managedParams,
            tokenModule: 'invalid' as 'managed',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'tokenModule')
          return true
        },
      )
    })

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...managedParams,
            tokenAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...managedParams,
            routerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })

    it('should reject empty mcmsAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...managedParams,
            mcmsAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'mcmsAddress')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedDeployPool — Managed Token Pool Validation
  // ===========================================================================

  describe('generateUnsignedDeployPool — managed', () => {
    const admin = makeAdmin()
    const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    it('should reject lock-release for managed tokens', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...managedParams,
            poolType: 'lock-release',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'poolType')
          assert.ok(err.message.includes('managed'))
          return true
        },
      )
    })

    it('should default tokenModule to managed', async () => {
      // Passes validation (will fail at ensureAptosCli, not validation)
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            poolType: 'burn-mint',
            tokenAddress: '0x89fd6b14b4a7',
            localTokenDecimals: 8,
            routerAddress: '0xabc123',
            mcmsAddress: '0x789abc',
          }),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPPoolDeployParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedDeployPool — Generic Token Pool Validation
  // ===========================================================================

  describe('generateUnsignedDeployPool — generic', () => {
    const admin = makeAdmin()
    const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    it('should accept burn-mint for generic tokens', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployPool(sender, genericBurnMintParams),
        (err: unknown) => {
          // Passes validation but fails later (ensureAptosCli or provider)
          assert.ok(!(err instanceof CCIPPoolDeployParamsInvalidError))
          return true
        },
      )
    })

    it('should accept lock-release for generic tokens', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployPool(sender, genericLockReleaseParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPPoolDeployParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedDeployPool — Regulated Token Pool Validation
  // ===========================================================================

  describe('generateUnsignedDeployPool — regulated', () => {
    const admin = makeAdmin()
    const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    it('should reject lock-release for regulated tokens', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...regulatedParams,
            poolType: 'lock-release',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'poolType')
          assert.ok(err.message.includes('regulated'))
          return true
        },
      )
    })

    it('should reject empty adminAddress for regulated', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            ...regulatedParams,
            adminAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'adminAddress')
          return true
        },
      )
    })

    it('should accept burn-mint for regulated tokens', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployPool(sender, regulatedParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPPoolDeployParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // deployPool — Wallet Validation
  // ===========================================================================

  describe('deployPool — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.deployPool({}, managedParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deployPool(null, managedParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.deployPool(undefined, managedParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
