import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPDeleteChainConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, CCIPVersion, ChainFamily, NetworkType } from '../../types.ts'
import type { DeleteChainConfigParams } from '../types.ts'

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

const validParams: DeleteChainConfigParams = {
  poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
  remoteChainSelector: 16015286601757825753n,
}

describe('EVMTokenAdmin — deleteChainConfig', () => {
  // =============================================================================
  // generateUnsignedDeleteChainConfig — Validation
  // =============================================================================

  describe('generateUnsignedDeleteChainConfig — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeleteChainConfig({
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPDeleteChainConfigParamsInvalidError)
          assert.equal(err.code, 'DELETE_CHAIN_CONFIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeleteChainConfig({
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPDeleteChainConfigParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedDeleteChainConfig — Happy path (v2.0)
  // =============================================================================

  describe('generateUnsignedDeleteChainConfig — happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape', async () => {
      const unsigned = await admin.generateUnsignedDeleteChainConfig(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)

      // Verify the function selector matches applyChainUpdates
      const iface = new Interface(TokenPool_2_0_ABI)
      const selector = iface.getFunction('applyChainUpdates')!.selector
      assert.ok(tx.data.startsWith(selector), 'should use applyChainUpdates selector')
    })
  })

  // =============================================================================
  // generateUnsignedDeleteChainConfig — v1.5.1
  // =============================================================================

  describe('generateUnsignedDeleteChainConfig — v1.6', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_6)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape for v1.6', async () => {
      const unsigned = await admin.generateUnsignedDeleteChainConfig(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)
    })
  })

  // =============================================================================
  // deleteChainConfig — Wallet Validation
  // =============================================================================

  describe('deleteChainConfig — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
