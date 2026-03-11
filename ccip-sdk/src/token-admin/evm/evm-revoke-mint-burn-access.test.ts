import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider, id } from 'ethers'

import BurnMintERC20ABI from './abi/BurnMintERC20.ts'
import FactoryBurnMintERC20ABI from './abi/FactoryBurnMintERC20.ts'
import { EVMTokenAdmin } from './index.ts'
import {
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { RevokeMintBurnAccessParams } from '../types.ts'

const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')

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

const validParams: RevokeMintBurnAccessParams = {
  tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
  authority: '0xabcdef1234567890abcdef1234567890abcdef12',
  role: 'mint',
}

describe('EVMTokenAdmin — revokeMintBurnAccess', () => {
  // =============================================================================
  // generateUnsignedRevokeMintBurnAccess — Validation
  // =============================================================================

  describe('generateUnsignedRevokeMintBurnAccess — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty tokenAddress', () => {
      assert.throws(
        () =>
          admin.generateUnsignedRevokeMintBurnAccess({
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

    it('should reject empty authority', () => {
      assert.throws(
        () =>
          admin.generateUnsignedRevokeMintBurnAccess({
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

    it('should reject invalid role', () => {
      assert.throws(
        () =>
          admin.generateUnsignedRevokeMintBurnAccess({
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

  // =============================================================================
  // generateUnsignedRevokeMintBurnAccess — Happy Path
  // =============================================================================

  describe('generateUnsignedRevokeMintBurnAccess — happy path', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should return UnsignedEVMTx with correct family', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess(validParams)
      assert.equal(unsigned.family, ChainFamily.EVM)
    })

    it('should return 1 transaction', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess(validParams)
      assert.equal(unsigned.transactions.length, 1)
    })

    it('should target the token address', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess(validParams)
      assert.equal(unsigned.transactions[0]!.to, validParams.tokenAddress)
    })

    it('should encode revokeRole(MINTER_ROLE) when role is mint', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess({
        ...validParams,
        role: 'mint',
      })
      const iface = new Interface(BurnMintERC20ABI)
      const expected = iface.encodeFunctionData('revokeRole', [MINTER_ROLE, validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should encode revokeRole(BURNER_ROLE) when role is burn', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess({
        ...validParams,
        role: 'burn',
      })
      const iface = new Interface(BurnMintERC20ABI)
      const expected = iface.encodeFunctionData('revokeRole', [BURNER_ROLE, validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })
  })

  // =============================================================================
  // revokeMintBurnAccess — Wallet Validation
  // =============================================================================

  describe('revokeMintBurnAccess — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
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
  })

  // =============================================================================
  // generateUnsignedRevokeMintBurnAccess — FactoryBurnMintERC20
  // =============================================================================

  describe('generateUnsignedRevokeMintBurnAccess — factoryBurnMintERC20', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should encode revokeMintRole when tokenType is factoryBurnMintERC20 and role is mint', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess({
        ...validParams,
        tokenType: 'factoryBurnMintERC20',
      })
      const iface = new Interface(FactoryBurnMintERC20ABI)
      const expected = iface.encodeFunctionData('revokeMintRole', [validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should encode revokeBurnRole when tokenType is factoryBurnMintERC20 and role is burn', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess({
        ...validParams,
        role: 'burn',
        tokenType: 'factoryBurnMintERC20',
      })
      const iface = new Interface(FactoryBurnMintERC20ABI)
      const expected = iface.encodeFunctionData('revokeBurnRole', [validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })
  })
})
