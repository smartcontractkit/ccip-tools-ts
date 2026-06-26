import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AbiCoder, JsonRpcProvider, ZeroAddress } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import { CCIPTokenDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../networks.ts'

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

const OWNER = '0x1234567890abcdef1234567890abcdef12345678'

// Canonical CCT v2.0 CrossChainToken constructor tuple — mirrors the SDK encoding.
const CROSS_CHAIN_TOKEN_PARAMS_TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

/**
 * Strips the CrossChainToken bytecode prefix off the deploy data and decodes the
 * constructor args: `(ConstructorParams args, address burnMintRoleAdmin, address owner)`.
 */
async function decodeDeployData(data: string) {
  const { CROSS_CHAIN_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainToken.ts')
  assert.ok(data.startsWith(CROSS_CHAIN_TOKEN_BYTECODE), 'deploy data should start with bytecode')
  const encodedArgs = '0x' + data.slice(CROSS_CHAIN_TOKEN_BYTECODE.length)
  const [tokenParams, burnMintRoleAdmin, owner] = AbiCoder.defaultAbiCoder().decode(
    [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address'],
    encodedArgs,
  ) as unknown as [
    {
      name: string
      symbol: string
      maxSupply: bigint
      preMint: bigint
      preMintRecipient: string
      decimals: bigint
      ccipAdmin: string
    },
    string,
    string,
  ]
  return { tokenParams, burnMintRoleAdmin, owner }
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

    it('should require ownerAddress on the unsigned path', async () => {
      await assert.rejects(
        () => admin.generateUnsignedDeployToken({ name: 'Token', symbol: 'MTK', decimals: 18 }),
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
            name: 'Token',
            symbol: 'MTK',
            decimals: 18,
            ownerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'ownerAddress')
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
        ownerAddress: OWNER,
      })

      assert.equal(result.family, ChainFamily.EVM)
      assert.equal(result.transactions.length, 1)
    })

    it('should set to: null for contract creation', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
        ownerAddress: OWNER,
      })

      assert.equal(result.transactions[0]!.to, null)
    })

    it('should encode the CrossChainToken tuple constructor', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
        maxSupply: 1000n,
        initialSupply: 100n,
        ownerAddress: OWNER,
      })

      const { tokenParams, burnMintRoleAdmin, owner } = await decodeDeployData(
        result.transactions[0]!.data as string,
      )

      assert.equal(tokenParams.name, 'My Token')
      assert.equal(tokenParams.symbol, 'MTK')
      assert.equal(tokenParams.maxSupply, 1000n)
      assert.equal(tokenParams.preMint, 100n, 'initialSupply maps to preMint')
      assert.equal(tokenParams.decimals, 18n)
      // preMint > 0 so preMintRecipient defaults to ownerAddress
      assert.equal(tokenParams.preMintRecipient.toLowerCase(), OWNER.toLowerCase())
      assert.equal(tokenParams.ccipAdmin.toLowerCase(), OWNER.toLowerCase())
      assert.equal(burnMintRoleAdmin.toLowerCase(), OWNER.toLowerCase())
      assert.equal(owner.toLowerCase(), OWNER.toLowerCase())
    })

    it('should force preMintRecipient to zero address when preMint is 0', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
        ownerAddress: OWNER,
      })

      const { tokenParams } = await decodeDeployData(result.transactions[0]!.data as string)

      assert.equal(tokenParams.maxSupply, 0n, 'maxSupply defaults to 0')
      assert.equal(tokenParams.preMint, 0n, 'preMint defaults to 0')
      assert.equal(
        tokenParams.preMintRecipient,
        ZeroAddress,
        'preMintRecipient forced to zero when preMint is 0',
      )
    })

    it('should honor explicit ccipAdmin / burnMintRoleAdmin / preMintRecipient', async () => {
      const ccipAdmin = '0x1111111111111111111111111111111111111111'
      const burnMintRoleAdmin = '0x2222222222222222222222222222222222222222'
      const preMintRecipient = '0x3333333333333333333333333333333333333333'
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
        initialSupply: 100n,
        ownerAddress: OWNER,
        ccipAdmin,
        burnMintRoleAdmin,
        preMintRecipient,
      })

      const decoded = await decodeDeployData(result.transactions[0]!.data as string)

      assert.equal(decoded.tokenParams.ccipAdmin.toLowerCase(), ccipAdmin.toLowerCase())
      assert.equal(decoded.burnMintRoleAdmin.toLowerCase(), burnMintRoleAdmin.toLowerCase())
      assert.equal(
        decoded.tokenParams.preMintRecipient.toLowerCase(),
        preMintRecipient.toLowerCase(),
      )
      assert.equal(decoded.owner.toLowerCase(), OWNER.toLowerCase())
    })

    it('should accept decimals: 0', async () => {
      const result = await admin.generateUnsignedDeployToken({
        name: 'Zero Dec Token',
        symbol: 'ZDT',
        decimals: 0,
        ownerAddress: OWNER,
      })

      assert.equal(result.transactions.length, 1)
      const { tokenParams } = await decodeDeployData(result.transactions[0]!.data as string)
      assert.equal(tokenParams.decimals, 0n)
    })

    it('should lazy-load bytecode consistently', async () => {
      const { CROSS_CHAIN_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainToken.ts')
      const result = await admin.generateUnsignedDeployToken({
        name: 'My Token',
        symbol: 'MTK',
        decimals: 18,
        ownerAddress: OWNER,
      })

      const data = result.transactions[0]!.data as string
      assert.ok(
        data.startsWith(CROSS_CHAIN_TOKEN_BYTECODE),
        'deploy data should start with bytecode',
      )
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
  // deployToken — auto-fills owner from the signer
  // =============================================================================

  describe('deployToken — owner auto-fill', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should auto-fill ownerAddress from the signer before encoding', async () => {
      const signerAddress = '0x9999999999999999999999999999999999999999'
      let capturedData: string | undefined

      // Minimal Signer stub: passes isSigner, captures the encoded deploy data, then
      // short-circuits so we never hit the network.
      const wallet = {
        provider,
        getAddress: () => Promise.resolve(signerAddress),
        signMessage: () => Promise.resolve('0x'),
        signTransaction: () => Promise.resolve('0x'),
        signTypedData: () => Promise.resolve('0x'),
        connect() {
          return this
        },
        populateTransaction: (tx: { data?: string }) => {
          capturedData = tx.data
          throw new Error('stop-before-submit')
        },
      }

      await assert.rejects(() =>
        admin.deployToken(wallet, { name: 'Auto Owner', symbol: 'AO', decimals: 18 }),
      )

      assert.ok(capturedData, 'deploy data should have been built')
      const { owner, burnMintRoleAdmin, tokenParams } = await decodeDeployData(capturedData)
      assert.equal(owner.toLowerCase(), signerAddress.toLowerCase(), 'owner from signer')
      assert.equal(burnMintRoleAdmin.toLowerCase(), signerAddress.toLowerCase())
      assert.equal(tokenParams.ccipAdmin.toLowerCase(), signerAddress.toLowerCase())
    })
  })
})
