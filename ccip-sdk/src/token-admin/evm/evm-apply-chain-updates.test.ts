import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPApplyChainUpdatesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, CCIPVersion, ChainFamily, NetworkType } from '../../types.ts'
import type { ApplyChainUpdatesParams } from '../types.ts'

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

const validParams: ApplyChainUpdatesParams = {
  poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
  remoteChainSelectorsToRemove: [],
  chainsToAdd: [
    {
      remoteChainSelector: 16015286601757825753n,
      remotePoolAddresses: ['0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'],
      remoteTokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
      outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
      inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
    },
  ],
}

describe('EVMTokenAdmin — applyChainUpdates', () => {
  // =============================================================================
  // generateUnsignedApplyChainUpdates — Validation
  // =============================================================================

  describe('generateUnsignedApplyChainUpdates — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates({
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.code, 'APPLY_CHAIN_UPDATES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates({
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remoteChainSelector: 0n }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates({
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remotePoolAddresses: [] }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty remoteTokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates({
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remoteTokenAddress: '' }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remoteTokenAddress')
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedApplyChainUpdates — Happy path (v2.0)
  // =============================================================================

  describe('generateUnsignedApplyChainUpdates — happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape', async () => {
      const unsigned = await admin.generateUnsignedApplyChainUpdates(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)

      // Verify the function selector matches applyChainUpdates
      const iface = new Interface(TokenPool_2_0_ABI)
      const selector = iface.getFunction('applyChainUpdates')!.selector
      assert.ok(tx.data.startsWith(selector))
    })

    it('should handle empty chainsToAdd with removes only', async () => {
      const unsigned = await admin.generateUnsignedApplyChainUpdates({
        poolAddress: validParams.poolAddress,
        remoteChainSelectorsToRemove: [16015286601757825753n],
        chainsToAdd: [],
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(unsigned.transactions[0]!.to, validParams.poolAddress)
    })
  })

  // =============================================================================
  // applyChainUpdates — Wallet Validation
  // =============================================================================

  describe('applyChainUpdates — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
