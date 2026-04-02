import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPProposeAdminRoleParamsInvalidError,
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

describe('EVMTokenAdmin — proposeAdminRole', () => {
  // =============================================================================
  // generateUnsignedProposeAdminRole — Validation
  // =============================================================================

  describe('generateUnsignedProposeAdminRole — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      registryModuleAddress: '0xa3c796d480638d7476792230da1E2ADa86e031b0',
    }

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        async () => admin.generateUnsignedProposeAdminRole({ ...validParams, tokenAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.code, 'PROPOSE_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty registryModuleAddress', async () => {
      await assert.rejects(
        async () =>
          admin.generateUnsignedProposeAdminRole({ ...validParams, registryModuleAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.context.param, 'registryModuleAddress')
          return true
        },
      )
    })

    it('should produce unsigned tx with correct shape', async () => {
      const unsigned = admin.generateUnsignedProposeAdminRole(validParams)

      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(
        (tx.to as string).toLowerCase(),
        validParams.registryModuleAddress.toLowerCase(),
        'to should be registryModule address',
      )
      assert.ok(tx.data, 'should have calldata')
      // registerAdminViaOwner(address) selector = first 4 bytes
      assert.ok(tx.data.startsWith('0x'), 'data should be hex')
    })
  })

  // =============================================================================
  // proposeAdminRole — Wallet Validation
  // =============================================================================

  describe('proposeAdminRole — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
      registryModuleAddress: '0xa3c796d480638d7476792230da1E2ADa86e031b0',
    }

    it('should reject non-signer wallet', async () => {
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
  })
})
