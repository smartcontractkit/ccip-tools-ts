import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import { EVMTokenManager } from '../../index.ts'

// ── Constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Second anvil account for the new rate limit admin
const NEW_RATE_LIMIT_ADMIN = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

// ── Helpers ──

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('EVMTokenManager setRateLimitAdmin Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let mgr: EVMTokenManager
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let poolAddress: string

  before(async () => {
    // Fork Sepolia so we have a real Router
    anvilInstance = Instance.anvil({
      port: 8753,
      forkUrl: SEPOLIA_RPC,
      forkBlockNumber: undefined,
    })
    await anvilInstance.start()

    const anvilUrl = `http://${anvilInstance.host}:${anvilInstance.port}`
    provider = new JsonRpcProvider(anvilUrl, undefined, { cacheTimeout: -1 })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, provider)

    mgr = await EVMTokenManager.fromProvider(provider, { logger: testLogger, apiClient: null })

    // 1. Deploy token
    const tokenResult = await mgr.deployToken({
      name: 'Rate Limit Admin Test Token',
      symbol: 'RLAT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
      wallet,
    })

    // 2. Deploy pool (deploys a v2.0 BurnMintTokenPool)
    const poolResult = await mgr.deployPool({
      poolType: 'burn-mint',
      tokenAddress: tokenResult.tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
      wallet,
    })
    poolAddress = poolResult.poolAddress
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // setRateLimitAdmin — Happy Path (v2.0 pool)
  // ===========================================================================

  it('should set rate limit admin and verify on-chain via getDynamicConfig', async () => {
    const result = await mgr.setRateLimitAdmin({
      poolAddress,
      rateLimitAdmin: NEW_RATE_LIMIT_ADMIN,
      wallet,
    })

    assert.ok(result.hash, 'should return tx hash')
    assert.match(result.hash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: v2.0 exposes rateLimitAdmin via getDynamicConfig()
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)
    const [, rateLimitAdmin] = (await pool.getFunction('getDynamicConfig')()) as [
      string,
      string,
      string,
    ]
    assert.equal(
      rateLimitAdmin.toLowerCase(),
      NEW_RATE_LIMIT_ADMIN.toLowerCase(),
      'rate limit admin should match',
    )
  })

  it('should update rate limit admin to a different address', async () => {
    const anotherAdmin = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' // anvil account #2
    await mgr.setRateLimitAdmin({
      poolAddress,
      rateLimitAdmin: anotherAdmin,
      wallet,
    })

    // Verify on-chain
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)
    const [, rateLimitAdmin] = (await pool.getFunction('getDynamicConfig')()) as [
      string,
      string,
      string,
    ]
    assert.equal(
      rateLimitAdmin.toLowerCase(),
      anotherAdmin.toLowerCase(),
      'rate limit admin should be updated',
    )
  })

  // ===========================================================================
  // generateUnsignedSetRateLimitAdmin — shape verification
  // ===========================================================================

  it('should produce unsigned tx with correct shape', async () => {
    const unsigned = await mgr.generateUnsignedSetRateLimitAdmin({
      poolAddress,
      rateLimitAdmin: NEW_RATE_LIMIT_ADMIN,
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(
      (tx.to as string).toLowerCase(),
      poolAddress.toLowerCase(),
      'to should be pool address',
    )
    assert.ok(tx.data, 'should have calldata')
  })
})
