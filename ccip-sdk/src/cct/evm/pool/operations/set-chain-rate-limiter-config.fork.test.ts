import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, Interface, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import { EVMTokenManager } from '../../index.ts'

// ── Constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const SEPOLIA_REGISTRY_MODULE = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// A valid chain selector for testing (Solana devnet)
const REMOTE_CHAIN_SELECTOR = 16423721717087811551n

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

describe('EVMTokenManager setChainRateLimiterConfig Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let mgr: EVMTokenManager
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let poolAddress: string

  before(async () => {
    // Fork Sepolia so we have a real Router
    anvilInstance = Instance.anvil({
      port: 8752,
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
      name: 'Rate Limiter Config Test Token',
      symbol: 'RLCT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
      wallet,
    })
    const tokenAddress = tokenResult.tokenAddress

    // 2. Deploy pool (deploys a v2.0 BurnMintTokenPool)
    const poolResult = await mgr.deployPool({
      poolType: 'burn-mint',
      tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
      wallet,
    })
    poolAddress = poolResult.poolAddress

    // 3. Propose + accept admin
    await mgr.proposeAdminRole({
      tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
      wallet,
    })

    await mgr.acceptAdminRole({
      tokenAddress,
      address: SEPOLIA_ROUTER,
      wallet,
    })

    // 4. Set pool in TAR
    await mgr.setPool({
      tokenAddress,
      poolAddress,
      address: SEPOLIA_ROUTER,
      wallet,
    })

    // 5. Apply chain updates (add a remote chain so we can set rate limits)
    await mgr.applyChainUpdates({
      poolAddress,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: [
        {
          remoteChainSelector: REMOTE_CHAIN_SELECTOR,
          remotePoolAddresses: ['0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'],
          remoteTokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
          outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
        },
      ],
      wallet,
    })
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // setChainRateLimiterConfig — Happy Path (v2.0 pool)
  // ===========================================================================

  it('should set rate limiter config and verify on-chain', async () => {
    const result = await mgr.setChainRateLimiterConfig({
      poolAddress,
      chainConfigs: [
        {
          remoteChainSelector: REMOTE_CHAIN_SELECTOR,
          outboundRateLimiterConfig: {
            isEnabled: true,
            capacity: '100000000000000000000',
            rate: '167000000000000000',
          },
          inboundRateLimiterConfig: {
            isEnabled: true,
            capacity: '200000000000000000000',
            rate: '334000000000000000',
          },
        },
      ],
      wallet,
    })

    assert.ok(result.hash, 'should return tx hash')
    assert.match(result.hash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: v2.0 returns both directions from getCurrentRateLimiterState
    // (the second arg selects the standard, non-fast-finality bucket).
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)

    const [outbound, inbound] = (await pool.getFunction('getCurrentRateLimiterState')(
      REMOTE_CHAIN_SELECTOR,
      false,
    )) as [
      { isEnabled: boolean; capacity: bigint; rate: bigint },
      { isEnabled: boolean; capacity: bigint; rate: bigint },
    ]
    assert.equal(outbound.isEnabled, true, 'outbound should be enabled')
    assert.equal(outbound.capacity, 100000000000000000000n, 'outbound capacity should match')
    assert.equal(outbound.rate, 167000000000000000n, 'outbound rate should match')

    assert.equal(inbound.isEnabled, true, 'inbound should be enabled')
    assert.equal(inbound.capacity, 200000000000000000000n, 'inbound capacity should match')
    assert.equal(inbound.rate, 334000000000000000n, 'inbound rate should match')
  })

  // ===========================================================================
  // generateUnsignedSetChainRateLimiterConfig — shape verification
  // ===========================================================================

  it('should produce unsigned tx with correct shape for v2.0', async () => {
    const unsigned = await mgr.generateUnsignedSetChainRateLimiterConfig({
      poolAddress,
      chainConfigs: [
        {
          remoteChainSelector: REMOTE_CHAIN_SELECTOR,
          outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
        },
      ],
    })

    // v2.0 batches all chain configs into a single setRateLimitConfig tx
    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(
      (tx.to as string).toLowerCase(),
      poolAddress.toLowerCase(),
      'to should be pool address',
    )
    assert.ok(tx.data, 'should have calldata')

    // Verify function selector matches setRateLimitConfig (v2.0)
    const iface = new Interface(TokenPool_2_0_ABI)
    const selector = iface.getFunction('setRateLimitConfig')!.selector
    assert.ok(tx.data.startsWith(selector), 'should use setRateLimitConfig selector for v2.0')
  })
})
