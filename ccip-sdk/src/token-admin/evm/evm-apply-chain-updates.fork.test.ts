import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, Interface, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import { EVMTokenAdmin } from './index.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'

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

describe('EVMTokenAdmin applyChainUpdates Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let admin: EVMTokenAdmin
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let tokenAddress: string
  let poolAddress: string

  before(async () => {
    // Fork Sepolia so we have a real Router
    anvilInstance = Instance.anvil({
      port: 8751,
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
      name: 'Apply Chain Updates Test Token',
      symbol: 'ACUT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
    })
    tokenAddress = tokenResult.tokenAddress

    // 2. Deploy pool
    const poolResult = await admin.deployPool(wallet, {
      poolType: 'burn-mint',
      tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
    })
    poolAddress = poolResult.poolAddress

    // 3. Propose + accept admin (for setting pool later)
    await admin.proposeAdminRole(wallet, {
      tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    await admin.acceptAdminRole(wallet, {
      tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    // 4. Set pool in TAR
    await admin.setPool(wallet, {
      tokenAddress,
      poolAddress,
      routerAddress: SEPOLIA_ROUTER,
    })
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // applyChainUpdates — Happy Path
  // ===========================================================================

  it('should apply chain updates and verify on-chain', async () => {
    const remotePoolAddress = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'
    const remoteTokenAddress = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'

    const result = await admin.applyChainUpdates(wallet, {
      poolAddress,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: [
        {
          remoteChainSelector: REMOTE_CHAIN_SELECTOR,
          remotePoolAddresses: [remotePoolAddress],
          remoteTokenAddress: remoteTokenAddress,
          outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
        },
      ],
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: isSupportedChain should return true
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)
    const isSupported = await pool.getFunction('isSupportedChain')(REMOTE_CHAIN_SELECTOR)
    assert.equal(isSupported, true, 'chain should be supported after applyChainUpdates')
  })

  // ===========================================================================
  // generateUnsignedApplyChainUpdates — shape verification
  // ===========================================================================

  it('should produce unsigned tx with correct shape', async () => {
    const unsigned = await admin.generateUnsignedApplyChainUpdates({
      poolAddress,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: [
        {
          remoteChainSelector: 999n,
          remotePoolAddresses: ['0x1111111111111111111111111111111111111111'],
          remoteTokenAddress: '0x2222222222222222222222222222222222222222',
          outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
        },
      ],
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(
      (tx.to as string).toLowerCase(),
      poolAddress.toLowerCase(),
      'to should be pool address',
    )
    assert.ok(tx.data, 'should have calldata')

    // Verify function selector
    const iface = new Interface(TokenPool_2_0_ABI)
    const selector = iface.getFunction('applyChainUpdates')!.selector
    assert.ok(tx.data.startsWith(selector), 'should use applyChainUpdates selector')
  })

  // ===========================================================================
  // appendRemotePoolAddresses — Happy Path
  // ===========================================================================

  it('should append a remote pool address to an existing chain config', async () => {
    // The chain config was already created by the applyChainUpdates test above
    const newRemotePool = '0x3333333333333333333333333333333333333333'

    const result = await admin.appendRemotePoolAddresses(wallet, {
      poolAddress,
      remoteChainSelector: REMOTE_CHAIN_SELECTOR,
      remotePoolAddresses: [newRemotePool],
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: getRemotePools should include the new pool address
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)
    const remotePools = (await pool.getFunction('getRemotePools')(
      REMOTE_CHAIN_SELECTOR,
    )) as string[]
    // The new pool address should be in the list (encoded as 32-byte left-padded bytes)
    assert.ok(remotePools.length >= 2, 'should have at least 2 remote pools after append')
  })

  // ===========================================================================
  // removeRemotePoolAddresses — Happy Path
  // ===========================================================================

  it('should remove a remote pool address and verify on-chain', async () => {
    // The chain config was already created by applyChainUpdates + appendRemotePoolAddresses
    // At this point there should be at least 2 remote pools
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)
    const remotePoolsBefore = (await pool.getFunction('getRemotePools')(
      REMOTE_CHAIN_SELECTOR,
    )) as string[]
    assert.ok(remotePoolsBefore.length >= 2, 'should have at least 2 remote pools before remove')

    // Remove the pool that was added by appendRemotePoolAddresses
    const poolToRemove = '0x3333333333333333333333333333333333333333'
    const result = await admin.removeRemotePoolAddresses(wallet, {
      poolAddress,
      remoteChainSelector: REMOTE_CHAIN_SELECTOR,
      remotePoolAddresses: [poolToRemove],
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: getRemotePools should have one fewer pool
    const remotePoolsAfter = (await pool.getFunction('getRemotePools')(
      REMOTE_CHAIN_SELECTOR,
    )) as string[]
    assert.equal(
      remotePoolsAfter.length,
      remotePoolsBefore.length - 1,
      'should have one fewer remote pool after remove',
    )
  })

  // ===========================================================================
  // deleteChainConfig — Happy Path
  // ===========================================================================

  it('should delete a chain config and verify on-chain', async () => {
    // The chain config was already created by applyChainUpdates test above
    const pool = new Contract(poolAddress, TokenPool_2_0_ABI, provider)

    // Verify chain is currently supported
    const isSupportedBefore = await pool.getFunction('isSupportedChain')(REMOTE_CHAIN_SELECTOR)
    assert.equal(isSupportedBefore, true, 'chain should be supported before delete')

    const result = await admin.deleteChainConfig(wallet, {
      poolAddress,
      remoteChainSelector: REMOTE_CHAIN_SELECTOR,
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: isSupportedChain should return false
    const isSupportedAfter = await pool.getFunction('isSupportedChain')(REMOTE_CHAIN_SELECTOR)
    assert.equal(isSupportedAfter, false, 'chain should not be supported after deleteChainConfig')
  })
})
