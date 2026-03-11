import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import { CCIPTokenDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
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

// =============================================================================
// EVMTokenAdmin — Construction
// =============================================================================

describe('EVMTokenAdmin', () => {
  describe('constructor', () => {
    it('should create instance with provider', () => {
      const provider = new JsonRpcProvider('http://localhost:8545')
      const admin = makeAdmin(provider)

      assert.equal(admin.provider, provider)
      provider.destroy()
    })
  })

  // =============================================================================
  // generateUnsignedDeployToken — Validation
  // =============================================================================

  describe('generateUnsignedDeployToken', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    // Cleanup

    it.after(() => provider.destroy())

    it('should reject empty name', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployToken({ name: '', symbol: 'MTK', decimals: 18 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.code, 'TOKEN_DEPLOY_PARAMS_INVALID')
          assert.equal(err.context.param, 'name')
          return true
        },
      )
    })

    it('should reject empty symbol', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployToken({ name: 'Token', symbol: '', decimals: 18 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'symbol')
          return true
        },
      )
    })

    it('should reject negative maxSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken({
            name: 'Token',
            symbol: 'MTK',
            decimals: 18,
            maxSupply: -1n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'maxSupply')
          return true
        },
      )
    })

    it('should reject initialSupply > maxSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken({
            name: 'Token',
            symbol: 'MTK',
            decimals: 18,
            maxSupply: 100n,
            initialSupply: 200n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'initialSupply')
          return true
        },
      )
    })

    // =========================================================================
    // generateUnsignedDeployToken — Happy Path
    // =========================================================================

    it('should return UnsignedEVMTx with correct family', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
      })

      assert.equal(result.family, ChainFamily.EVM)
      assert.equal(result.transactions.length, 1)
    })

    it('should set to: null for contract creation', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
      })

      assert.equal(result.transactions[0]!.to, null)
    })

    it('should encode constructor args in deploy data', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
        maxSupply: 1000n,
        initialSupply: 100n,
      })

      const data = result.transactions[0]!.data as string
      assert.ok(data.startsWith('0x'))

      // Verify constructor args are encoded at the end of the data
      const expectedArgs = AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'uint8', 'uint256', 'uint256'],
        ['My Token', 'MTK', 18, 1000n, 100n],
      )
      assert.ok(data.endsWith(expectedArgs.slice(2)), 'deploy data should end with encoded args')
    })

    it('should default maxSupply and initialSupply to 0', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
      })

      const data = result.transactions[0]!.data as string
      const expectedArgs = AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'uint8', 'uint256', 'uint256'],
        ['My Token', 'MTK', 18, 0n, 0n],
      )
      assert.ok(data.endsWith(expectedArgs.slice(2)))
    })

    it('should accept decimals: 0', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'Zero Dec Token',
        symbol: 'ZDT',
        decimals: 0,
      })

      assert.equal(result.transactions.length, 1)
    })

    it('should lazy-load bytecode consistently', async () => {
      const { BURN_MINT_ERC20_BYTECODE } = await import('./bytecodes/BurnMintERC20.ts')
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
      })

      const data = result.transactions[0]!.data as string
      assert.ok(data.startsWith(BURN_MINT_ERC20_BYTECODE), 'deploy data should start with bytecode')
    })
  })

  // =============================================================================
  // deployToken — Wallet Validation
  // =============================================================================

  describe('deployToken', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.deployToken({}, { name: 'Token', symbol: 'MTK', decimals: 18 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deployToken(null, { name: 'Token', symbol: 'MTK', decimals: 18 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })

  // =============================================================================
  // generateUnsignedDeployToken — FactoryBurnMintERC20
  // =============================================================================

  describe('generateUnsignedDeployToken — factoryBurnMintERC20', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should require ownerAddress for unsigned path', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken({
            name: 'Factory Token',
            symbol: 'FTK',
            decimals: 18,
            tokenType: 'factoryBurnMintERC20',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'ownerAddress')
          return true
        },
      )
    })

    it('should reject empty ownerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken({
            name: 'Factory Token',
            symbol: 'FTK',
            decimals: 18,
            tokenType: 'factoryBurnMintERC20',
            ownerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'ownerAddress')
          return true
        },
      )
    })

    it('should return UnsignedEVMTx with to: null', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'Factory Token',
        symbol: 'FTK',
        decimals: 18,
        tokenType: 'factoryBurnMintERC20',
        ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      })

      assert.equal(result.family, ChainFamily.EVM)
      assert.equal(result.transactions.length, 1)
      assert.equal(result.transactions[0]!.to, null)
    })

    it('should encode 6-param constructor args', async () => {
      const ownerAddress = '0x1234567890abcdef1234567890abcdef12345678'
      const result = await admin.generateUnsignedDeployToken({
        name: 'Factory Token',
        symbol: 'FTK',
        decimals: 18,
        maxSupply: 1000n,
        initialSupply: 100n,
        tokenType: 'factoryBurnMintERC20',
        ownerAddress,
      })

      const data = result.transactions[0]!.data as string
      const expectedArgs = AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'uint8', 'uint256', 'uint256', 'address'],
        ['Factory Token', 'FTK', 18, 1000n, 100n, ownerAddress],
      )
      assert.ok(data.endsWith(expectedArgs.slice(2)), 'deploy data should end with 6-param args')
    })

    it('should use FactoryBurnMintERC20 bytecode', async () => {
      const { FACTORY_BURN_MINT_ERC20_BYTECODE } =
        await import('./bytecodes/FactoryBurnMintERC20.ts')
      const result = await admin.generateUnsignedDeployToken({
        name: 'Factory Token',
        symbol: 'FTK',
        decimals: 18,
        tokenType: 'factoryBurnMintERC20',
        ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
      })

      const data = result.transactions[0]!.data as string
      assert.ok(
        data.startsWith(FACTORY_BURN_MINT_ERC20_BYTECODE),
        'deploy data should start with FactoryBurnMintERC20 bytecode',
      )
    })
  })
})
