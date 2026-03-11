import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPRemoveRemotePoolAddressesFailedError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, CCIPVersion, ChainFamily, NetworkType } from '../../types.ts'
import type { RemoveRemotePoolAddressesParams } from '../types.ts'

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

const validParams: RemoveRemotePoolAddressesParams = {
  poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
  remoteChainSelector: 16015286601757825753n,
  remotePoolAddresses: ['0xaabbccdd11223344556677889900aabbccdd1122'],
}

describe('EVMTokenAdmin — removeRemotePoolAddresses', () => {
  // =============================================================================
  // generateUnsignedRemoveRemotePoolAddresses — Validation
  // =============================================================================

  describe('generateUnsignedRemoveRemotePoolAddresses — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses({
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.code, 'REMOVE_REMOTE_POOL_ADDRESSES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses({
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses({
            ...validParams,
            remotePoolAddresses: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty address in array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedRemoveRemotePoolAddresses({
            ...validParams,
            remotePoolAddresses: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses[0]')
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedRemoveRemotePoolAddresses — v1.5 rejection
  // =============================================================================

  describe('generateUnsignedRemoveRemotePoolAddresses — v1.5 rejection', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_5)

    it.after(() => provider.destroy())

    it('should reject v1.5 pools', async () => {
      await assert.rejects(
        () => admin.generateUnsignedRemoveRemotePoolAddresses(validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesFailedError)
          assert.ok(err.message.includes('not available on v1.5'))
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedRemoveRemotePoolAddresses — Happy path (v2.0)
  // =============================================================================

  describe('generateUnsignedRemoveRemotePoolAddresses — happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape', async () => {
      const unsigned = await admin.generateUnsignedRemoveRemotePoolAddresses(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)

      // Verify the function selector matches removeRemotePool
      const iface = new Interface(TokenPool_2_0_ABI)
      const selector = iface.getFunction('removeRemotePool')!.selector
      assert.ok(tx.data.startsWith(selector), 'should use removeRemotePool selector')
    })

    it('should produce one tx per address', async () => {
      const unsigned = await admin.generateUnsignedRemoveRemotePoolAddresses({
        ...validParams,
        remotePoolAddresses: [
          '0xaabbccdd11223344556677889900aabbccdd1122',
          '0x1111111111111111111111111111111111111111',
        ],
      })

      assert.equal(unsigned.transactions.length, 2)
    })
  })

  // =============================================================================
  // generateUnsignedRemoveRemotePoolAddresses — v1.6
  // =============================================================================

  describe('generateUnsignedRemoveRemotePoolAddresses — v1.6', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_6)

    it.after(() => provider.destroy())

    it('should produce correct UnsignedEVMTx shape for v1.6', async () => {
      const unsigned = await admin.generateUnsignedRemoveRemotePoolAddresses(validParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, validParams.poolAddress)
      assert.ok(tx.data)
    })
  })

  // =============================================================================
  // removeRemotePoolAddresses — Wallet Validation
  // =============================================================================

  describe('removeRemotePoolAddresses — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.removeRemotePoolAddresses({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.removeRemotePoolAddresses(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
