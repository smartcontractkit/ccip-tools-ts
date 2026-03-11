import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPAppendRemotePoolAddressesFailedError,
  CCIPAppendRemotePoolAddressesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, CCIPVersion, ChainFamily, NetworkType } from '../../types.ts'
import type { AppendRemotePoolAddressesParams } from '../types.ts'

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

const validParams: AppendRemotePoolAddressesParams = {
  poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
  remoteChainSelector: '16015286601757825753',
  remotePoolAddresses: ['0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'],
}

describe('EVMTokenAdmin — appendRemotePoolAddresses', () => {
  // =============================================================================
  // generateUnsignedAppendRemotePoolAddresses — Validation
  // =============================================================================

  describe('generateUnsignedAppendRemotePoolAddresses — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses({
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.code, 'APPEND_REMOTE_POOL_ADDRESSES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses({
            ...validParams,
            remoteChainSelector: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses({
            ...validParams,
            remotePoolAddresses: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty address in remotePoolAddresses', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses({
            ...validParams,
            remotePoolAddresses: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses[0]')
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedAppendRemotePoolAddresses — Happy path (v2.0)
  // =============================================================================

  describe('generateUnsignedAppendRemotePoolAddresses — happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape', async () => {
      const unsigned = await admin.generateUnsignedAppendRemotePoolAddresses(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)

      // Verify the function selector matches addRemotePool
      const iface = new Interface(TokenPool_2_0_ABI)
      const selector = iface.getFunction('addRemotePool')!.selector
      assert.ok(tx.data.startsWith(selector))
    })

    it('should produce 2 txs for 2 addresses', async () => {
      const unsigned = await admin.generateUnsignedAppendRemotePoolAddresses({
        ...validParams,
        remotePoolAddresses: [
          '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD',
          '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
        ],
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 2)
    })

    it('should reject v1.5 pools', async () => {
      const provider15 = new JsonRpcProvider('http://localhost:8545')
      const admin15 = makeAdminWithVersion(provider15, CCIPVersion.V1_5)

      try {
        await assert.rejects(
          () => admin15.generateUnsignedAppendRemotePoolAddresses(validParams),
          (err: unknown) => {
            assert.ok(err instanceof CCIPAppendRemotePoolAddressesFailedError)
            return true
          },
        )
      } finally {
        provider15.destroy()
      }
    })
  })

  // =============================================================================
  // appendRemotePoolAddresses — Wallet Validation
  // =============================================================================

  describe('appendRemotePoolAddresses — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
