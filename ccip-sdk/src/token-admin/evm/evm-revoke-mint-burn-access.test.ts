import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider, id } from 'ethers'

import { type NetworkInfo, ChainFamily, NetworkType } from '../../networks.ts'
import CrossChainTokenABI from './abi/CrossChainToken.ts'
import { EVMTokenAdmin } from './index.ts'
import {
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
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
  // generateUnsignedRevokeMintBurnAccess — Happy Path (CrossChainToken)
  // =============================================================================

  describe('generateUnsignedRevokeMintBurnAccess — happy path', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)
    const iface = new Interface(CrossChainTokenABI)

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
      const expected = iface.encodeFunctionData('revokeRole', [MINTER_ROLE, validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should encode revokeRole(BURNER_ROLE) when role is burn', () => {
      const unsigned = admin.generateUnsignedRevokeMintBurnAccess({
        ...validParams,
        role: 'burn',
      })
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
})
