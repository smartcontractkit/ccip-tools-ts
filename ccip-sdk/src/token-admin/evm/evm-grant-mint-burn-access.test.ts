import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider, id } from 'ethers'

import { type NetworkInfo, ChainFamily, NetworkType } from '../../networks.ts'
import CrossChainTokenABI from './abi/CrossChainToken.ts'
import { EVMTokenAdmin } from './index.ts'
import {
  CCIPGrantMintBurnAccessParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import type { GrantMintBurnAccessParams } from '../types.ts'

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

const validParams: GrantMintBurnAccessParams = {
  tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
  authority: '0xabcdef1234567890abcdef1234567890abcdef12',
}

describe('EVMTokenAdmin — grantMintBurnAccess', () => {
  // =============================================================================
  // generateUnsignedGrantMintBurnAccess — Validation
  // =============================================================================

  describe('generateUnsignedGrantMintBurnAccess — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        async () =>
          admin.generateUnsignedGrantMintBurnAccess({
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
        async () =>
          admin.generateUnsignedGrantMintBurnAccess({
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

  // =============================================================================
  // generateUnsignedGrantMintBurnAccess — Happy Path (CrossChainToken)
  // =============================================================================

  describe('generateUnsignedGrantMintBurnAccess — happy path', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)
    const iface = new Interface(CrossChainTokenABI)

    it.after(() => provider.destroy())

    it('should return UnsignedEVMTx with correct family', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess(validParams)
      assert.equal(unsigned.family, ChainFamily.EVM)
    })

    it('should return 1 transaction', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess(validParams)
      assert.equal(unsigned.transactions.length, 1)
    })

    it('should target the token address', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess(validParams)
      assert.equal(unsigned.transactions[0]!.to, validParams.tokenAddress)
    })

    it('should encode grantMintAndBurnRoles call data', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess(validParams)
      const expected = iface.encodeFunctionData('grantMintAndBurnRoles', [validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should encode grantMintAndBurnRoles when role is mintAndBurn', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess({
        ...validParams,
        role: 'mintAndBurn',
      })
      const expected = iface.encodeFunctionData('grantMintAndBurnRoles', [validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should encode grantRole(MINTER_ROLE) when role is mint', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess({
        ...validParams,
        role: 'mint',
      })
      const expected = iface.encodeFunctionData('grantRole', [MINTER_ROLE, validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should encode grantRole(BURNER_ROLE) when role is burn', async () => {
      const unsigned = admin.generateUnsignedGrantMintBurnAccess({
        ...validParams,
        role: 'burn',
      })
      const expected = iface.encodeFunctionData('grantRole', [BURNER_ROLE, validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })

    it('should default to grantMintAndBurnRoles when role is omitted', async () => {
      const withoutRole = {
        tokenAddress: validParams.tokenAddress,
        authority: validParams.authority,
      }
      const unsigned = admin.generateUnsignedGrantMintBurnAccess(withoutRole)
      const expected = iface.encodeFunctionData('grantMintAndBurnRoles', [validParams.authority])
      assert.equal(unsigned.transactions[0]!.data, expected)
    })
  })

  // =============================================================================
  // grantMintBurnAccess — Wallet Validation
  // =============================================================================

  describe('grantMintBurnAccess — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
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
  })
})
