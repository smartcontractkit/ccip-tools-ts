import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import { EVMTokenAdmin } from './index.ts'
import TokenPool_1_6_ABI from '../../evm/abi/LockReleaseTokenPool_1_6_1.ts'

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

describe('EVMTokenAdmin setRateLimitAdmin Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let admin: EVMTokenAdmin
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

    admin = await EVMTokenAdmin.fromUrl(anvilUrl, { logger: testLogger, apiClient: null })

    // 1. Deploy token
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Rate Limit Admin Test Token',
      symbol: 'RLAT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
    })

    // 2. Deploy pool (deploys v1.6.1 BurnMintTokenPool)
    const poolResult = await admin.deployPool(wallet, {
      poolType: 'burn-mint',
      tokenAddress: tokenResult.tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
    })
    poolAddress = poolResult.poolAddress
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // setRateLimitAdmin — Happy Path (v1.6 pool)
  // ===========================================================================

  it('should set rate limit admin and verify on-chain via getRateLimitAdmin', async () => {
    const result = await admin.setRateLimitAdmin(wallet, {
      poolAddress,
      rateLimitAdmin: NEW_RATE_LIMIT_ADMIN,
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: v1.6 has getRateLimitAdmin()
    const pool = new Contract(poolAddress, TokenPool_1_6_ABI, provider)
    const rateLimitAdmin: string = await pool.getFunction('getRateLimitAdmin')()
    assert.equal(
      rateLimitAdmin.toLowerCase(),
      NEW_RATE_LIMIT_ADMIN.toLowerCase(),
      'rate limit admin should match',
    )
  })

  it('should update rate limit admin to a different address', async () => {
    const anotherAdmin = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' // anvil account #2
    await admin.setRateLimitAdmin(wallet, {
      poolAddress,
      rateLimitAdmin: anotherAdmin,
    })

    // Verify on-chain
    const pool = new Contract(poolAddress, TokenPool_1_6_ABI, provider)
    const rateLimitAdmin: string = await pool.getFunction('getRateLimitAdmin')()
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
    const unsigned = await admin.generateUnsignedSetRateLimitAdmin({
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
