import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPGrantMintBurnAccessParamsInvalidError,
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
      // get_store_address: return a deterministic pool resource signer address
      if (fn.includes('get_store_address')) return ['0xpool_resource_signer']
      // object::owner calls for resolveTokenCodeObject
      if (fn.includes('object::owner')) return ['0xcode_object']
      // get_token: used by discoverPoolModule
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

/** Mock provider with no pool modules. */
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
}

// =============================================================================
// AptosTokenAdmin — grantMintBurnAccess
// =============================================================================

describe('AptosTokenAdmin — grantMintBurnAccess', () => {
  // ===========================================================================
  // generateUnsignedGrantMintBurnAccess — Validation
  // ===========================================================================

  describe('generateUnsignedGrantMintBurnAccess — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedGrantMintBurnAccess(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPGrantMintBurnAccessParamsInvalidError)
          assert.equal(err.code, 'GRANT_MINT_BURN_ACCESS_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty authority', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedGrantMintBurnAccess(sender, {
            ...validParams,
            authority: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPGrantMintBurnAccessParamsInvalidError)
          assert.equal(err.context.param, 'authority')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // Pool Type Detection
  // ===========================================================================

  describe('generateUnsignedGrantMintBurnAccess — pool type detection', () => {
    it('should return 2 transactions for managed pool (minter + burner updates)', async () => {
      const admin = makeAdmin(mockProviderWithPool('managed_token_pool'))
      const { transactions } = await admin.generateUnsignedGrantMintBurnAccess(sender, validParams)

      assert.equal(transactions.length, 2)
      assert.equal(transactions[0]!.family, ChainFamily.Aptos)
      assert.equal(transactions[1]!.family, ChainFamily.Aptos)
    })

    it('should return 1 transaction for managed pool with role: mint', async () => {
      const admin = makeAdmin(mockProviderWithPool('managed_token_pool'))
      const { transactions } = await admin.generateUnsignedGrantMintBurnAccess(sender, {
        ...validParams,
        role: 'mint',
      })

      assert.equal(transactions.length, 1, 'should have 1 tx (minter update only)')
      assert.equal(transactions[0]!.family, ChainFamily.Aptos)
    })

    it('should return 1 transaction for managed pool with role: burn', async () => {
      const admin = makeAdmin(mockProviderWithPool('managed_token_pool'))
      const { transactions } = await admin.generateUnsignedGrantMintBurnAccess(sender, {
        ...validParams,
        role: 'burn',
      })

      assert.equal(transactions.length, 1, 'should have 1 tx (burner update only)')
      assert.equal(transactions[0]!.family, ChainFamily.Aptos)
    })

    it('should return 1 transaction for regulated pool (grant_role)', async () => {
      const admin = makeAdmin(mockProviderWithPool('regulated_token_pool'))
      const { transactions } = await admin.generateUnsignedGrantMintBurnAccess(sender, validParams)

      assert.equal(transactions.length, 1)
      assert.equal(transactions[0]!.family, ChainFamily.Aptos)
    })

    it('should return 1 transaction for regulated pool with role: mint', async () => {
      const admin = makeAdmin(mockProviderWithPool('regulated_token_pool'))
      const { transactions } = await admin.generateUnsignedGrantMintBurnAccess(sender, {
        ...validParams,
        role: 'mint',
      })

      assert.equal(transactions.length, 1)
    })

    it('should return 1 transaction for regulated pool with role: burn', async () => {
      const admin = makeAdmin(mockProviderWithPool('regulated_token_pool'))
      const { transactions } = await admin.generateUnsignedGrantMintBurnAccess(sender, {
        ...validParams,
        role: 'burn',
      })

      assert.equal(transactions.length, 1)
    })

    it('should reject lock-release pool (does not mint/burn)', async () => {
      const admin = makeAdmin(mockProviderWithPool('lock_release_token_pool'))
      await assert.rejects(
        () => admin.generateUnsignedGrantMintBurnAccess(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPGrantMintBurnAccessParamsInvalidError)
          assert.equal(err.context.param, 'authority')
          assert.ok(err.message.includes('lock-release'))
          return true
        },
      )
    })

    it('should reject burn-mint pool (requires initialize with BurnRef/MintRef)', async () => {
      const admin = makeAdmin(mockProviderWithPool('burn_mint_token_pool'))
      await assert.rejects(
        () => admin.generateUnsignedGrantMintBurnAccess(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPGrantMintBurnAccessParamsInvalidError)
          assert.equal(err.context.param, 'authority')
          assert.ok(err.message.includes('initialize()'))
          return true
        },
      )
    })

    it('should throw when no pool module found', async () => {
      const admin = makeAdmin(mockProviderNoPool)
      await assert.rejects(
        () => admin.generateUnsignedGrantMintBurnAccess(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenPoolInfoNotFoundError)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // grantMintBurnAccess — Wallet Validation
  // ===========================================================================

  describe('grantMintBurnAccess — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.grantMintBurnAccess({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.grantMintBurnAccess(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject string wallet', async () => {
      await assert.rejects(
        () => admin.grantMintBurnAccess('not-a-wallet', validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
