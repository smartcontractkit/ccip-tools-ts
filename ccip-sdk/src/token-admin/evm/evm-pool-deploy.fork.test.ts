import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import { EVMTokenAdmin } from './index.ts'

// ── Constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// ── Helpers ──

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Minimal ABI for verifying deployed pool state
const POOL_ABI = [
  {
    inputs: [],
    name: 'getToken',
    outputs: [{ internalType: 'contract IERC20', name: 'token', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRouter',
    outputs: [{ internalType: 'address', name: 'router', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('EVMTokenAdmin Pool Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let admin: EVMTokenAdmin
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let tokenAddress: string

  before(async () => {
    // Fork Sepolia so we have a real Router with getArmProxy()
    anvilInstance = Instance.anvil({
      port: 8748,
      forkUrl: SEPOLIA_RPC,
      forkBlockNumber: undefined, // latest
    })
    await anvilInstance.start()

    const anvilUrl = `http://${anvilInstance.host}:${anvilInstance.port}`
    provider = new JsonRpcProvider(anvilUrl, undefined, { cacheTimeout: -1 })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, provider)
    admin = await EVMTokenAdmin.fromUrl(anvilUrl, { logger: testLogger, apiClient: null })

    // Deploy a token first (needed by pool constructor)
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Pool Test Token',
      symbol: 'PTT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
    })
    tokenAddress = tokenResult.tokenAddress
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // deployPool — BurnMint
  // ===========================================================================

  it('should deploy BurnMintTokenPool and verify contract state', async () => {
    const result = await admin.deployPool(wallet, {
      poolType: 'burn-mint',
      tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(result.poolAddress, 'should return pool address')
    assert.match(result.poolAddress, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify deployed contract state
    const pool = new Contract(result.poolAddress, POOL_ABI, provider)
    const token: string = await pool.getFunction('getToken')()
    const router: string = await pool.getFunction('getRouter')()
    const owner: string = await pool.getFunction('owner')()

    assert.equal(token.toLowerCase(), tokenAddress.toLowerCase(), 'pool token should match')
    assert.equal(router.toLowerCase(), SEPOLIA_ROUTER.toLowerCase(), 'pool router should match')
    assert.equal(
      owner.toLowerCase(),
      (await wallet.getAddress()).toLowerCase(),
      'deployer should be owner',
    )
  })

  // ===========================================================================
  // deployPool — LockRelease
  // ===========================================================================

  it('should deploy LockReleaseTokenPool and verify contract state', async () => {
    const result = await admin.deployPool(wallet, {
      poolType: 'lock-release',
      tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(result.poolAddress, 'should return pool address')
    assert.match(result.poolAddress, /^0x[0-9a-fA-F]{40}$/)
    assert.ok(result.txHash, 'should return tx hash')

    const pool = new Contract(result.poolAddress, POOL_ABI, provider)
    const token: string = await pool.getFunction('getToken')()
    const router: string = await pool.getFunction('getRouter')()

    assert.equal(token.toLowerCase(), tokenAddress.toLowerCase())
    assert.equal(router.toLowerCase(), SEPOLIA_ROUTER.toLowerCase())
  })

  // ===========================================================================
  // generateUnsignedDeployPool — manual sign
  // ===========================================================================

  it('should produce unsigned tx that deploys successfully when signed manually', async () => {
    const unsigned = await admin.generateUnsignedDeployPool({
      poolType: 'burn-mint',
      tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(tx.to, null)

    const populated = await wallet.populateTransaction(tx)
    populated.from = undefined
    const response = await wallet.sendTransaction(populated)
    const receipt = await response.wait(1, 30_000)

    assert.ok(receipt, 'should get receipt')
    assert.equal(receipt.status, 1, 'tx should succeed')
    assert.ok(receipt.contractAddress, 'should have contract address')

    const pool = new Contract(receipt.contractAddress, POOL_ABI, provider)
    const token: string = await pool.getFunction('getToken')()
    assert.equal(token.toLowerCase(), tokenAddress.toLowerCase())
  })

  // ===========================================================================
  // deployPool — with allowlist
  // ===========================================================================

  it('should deploy pool with non-empty allowlist', async () => {
    const allowlist = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ]

    const result = await admin.deployPool(wallet, {
      poolType: 'burn-mint',
      tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
      allowlist,
    })

    assert.ok(result.poolAddress)
    assert.ok(result.txHash)
  })
})
