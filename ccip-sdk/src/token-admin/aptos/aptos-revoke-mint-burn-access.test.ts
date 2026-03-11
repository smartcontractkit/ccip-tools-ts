import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPTokenPoolInfoNotFoundError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

/** Creates a mock provider that returns the given pool module name. */
function mockProviderWithPool(moduleName: string) {
  return {
    getTransactionByVersion: async () => ({}),
    getAccountInfo: async () => ({ sequence_number: '0' }),
    getAccountModules: async () => [{ abi: { name: moduleName } }],
    view: async ({ payload }: { payload: { function: string } }) => {
      const fn = payload.function
      if (fn.includes('get_store_address')) return ['0xpool_resource_signer']
      if (fn.includes('object::owner')) return ['0xcode_object']
      if (fn.includes('get_token')) return ['0xtoken_address']
      return ['0x123']
    },
    transaction: {
      build: {
        simple: async () => ({
          bcsToBytes: () => new Uint8Array([1, 2, 3]),
        }),
      },
    },
  } as unknown as Aptos
}

const mockProviderNoPool = {
  getTransactionByVersion: async () => ({}),
  getAccountModules: async () => [{ abi: { name: 'unrelated_module' } }],
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

function makeAdmin(provider?: Aptos): AptosTokenAdmin {
  return new AptosTokenAdmin(provider ?? mockProviderWithPool('managed_token_pool'), dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

const validParams = {
  tokenAddress: '0x89fd6b14b4a7',
  authority: '0xabc123pool',
  role: 'mint' as const,
}

// =============================================================================
// AptosTokenAdmin — revokeMintBurnAccess
// =============================================================================

describe('AptosTokenAdmin — revokeMintBurnAccess', () => {
  // ===========================================================================
  // generateUnsignedRevokeMintBurnAccess — Validation
  // ===========================================================================

  describe('generateUnsignedRevokeMintBurnAccess — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRevokeMintBurnAccess(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
          assert.equal(err.code, 'REVOKE_MINT_BURN_ACCESS_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty authority', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRevokeMintBurnAccess(sender, {
            ...validParams,
            authority: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
          assert.equal(err.context.param, 'authority')
          return true
        },
      )
    })

    it('should reject invalid role', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRevokeMintBurnAccess(sender, {
            ...validParams,
            role: 'invalid' as 'mint',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
          assert.equal(err.context.param, 'role')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // Pool Type Detection
  // ===========================================================================

  describe('generateUnsignedRevokeMintBurnAccess — pool type detection', () => {
    it('should return 1 transaction for managed pool with role: mint', async () => {
      const admin = makeAdmin(mockProviderWithPool('managed_token_pool'))
      const { transactions } = await admin.generateUnsignedRevokeMintBurnAccess(sender, {
        ...validParams,
        role: 'mint',
      })
      assert.equal(transactions.length, 1)
      assert.equal(transactions[0]!.family, ChainFamily.Aptos)
    })

    it('should return 1 transaction for managed pool with role: burn', async () => {
      const admin = makeAdmin(mockProviderWithPool('managed_token_pool'))
      const { transactions } = await admin.generateUnsignedRevokeMintBurnAccess(sender, {
        ...validParams,
        role: 'burn',
      })
      assert.equal(transactions.length, 1)
      assert.equal(transactions[0]!.family, ChainFamily.Aptos)
    })

    it('should return 1 transaction for regulated pool with role: mint', async () => {
      const admin = makeAdmin(mockProviderWithPool('regulated_token_pool'))
      const { transactions } = await admin.generateUnsignedRevokeMintBurnAccess(sender, {
        ...validParams,
        role: 'mint',
      })
      assert.equal(transactions.length, 1)
    })

    it('should return 1 transaction for regulated pool with role: burn', async () => {
      const admin = makeAdmin(mockProviderWithPool('regulated_token_pool'))
      const { transactions } = await admin.generateUnsignedRevokeMintBurnAccess(sender, {
        ...validParams,
        role: 'burn',
      })
      assert.equal(transactions.length, 1)
    })

    it('should reject lock-release pool', async () => {
      const admin = makeAdmin(mockProviderWithPool('lock_release_token_pool'))
      await assert.rejects(
        () => admin.generateUnsignedRevokeMintBurnAccess(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
          assert.ok(err.message.includes('lock-release'))
          return true
        },
      )
    })

    it('should reject burn-mint pool', async () => {
      const admin = makeAdmin(mockProviderWithPool('burn_mint_token_pool'))
      await assert.rejects(
        () => admin.generateUnsignedRevokeMintBurnAccess(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRevokeMintBurnAccessParamsInvalidError)
          assert.ok(err.message.includes('initialization'))
          return true
        },
      )
    })

    it('should throw when no pool module found', async () => {
      const admin = makeAdmin(mockProviderNoPool)
      await assert.rejects(
        () => admin.generateUnsignedRevokeMintBurnAccess(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenPoolInfoNotFoundError)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // revokeMintBurnAccess — Wallet Validation
  // ===========================================================================

  describe('revokeMintBurnAccess — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.revokeMintBurnAccess({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.revokeMintBurnAccess(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject string wallet', async () => {
      await assert.rejects(
        () => admin.revokeMintBurnAccess('not-a-wallet', validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
