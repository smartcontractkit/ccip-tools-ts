import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import { EVMTokenManager } from '../../index.ts'

// ── Constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const SEPOLIA_REGISTRY_MODULE = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
// Second Anvil default account
const BURNER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

// ── Helpers ──

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Minimal ABI for reading pool owner
const OWNABLE_ABI = [
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('EVMTokenManager transferOwnership Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let ownerWallet: Wallet
  let burnerWallet: Wallet
  let mgr: EVMTokenManager
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let poolAddress: string

  before(async () => {
    anvilInstance = Instance.anvil({
      port: 8754,
      forkUrl: SEPOLIA_RPC,
      forkBlockNumber: undefined,
    })
    await anvilInstance.start()

    const anvilUrl = `http://${anvilInstance.host}:${anvilInstance.port}`
    provider = new JsonRpcProvider(anvilUrl, undefined, { cacheTimeout: -1 })
    ownerWallet = new Wallet(ANVIL_PRIVATE_KEY, provider)
    burnerWallet = new Wallet(BURNER_PRIVATE_KEY, provider)

    mgr = await EVMTokenManager.fromProvider(provider, { logger: testLogger, apiClient: null })

    // 1. Deploy token
    const tokenResult = await mgr.deployToken({
      name: 'Ownership Test Token',
      symbol: 'OTT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
      wallet: ownerWallet,
    })

    // 2. Deploy pool
    const poolResult = await mgr.deployPool({
      poolType: 'burn-mint',
      tokenAddress: tokenResult.tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
      wallet: ownerWallet,
    })
    poolAddress = poolResult.poolAddress

    // 3. Propose + accept admin (needed to register pool)
    await mgr.proposeAdminRole({
      tokenAddress: tokenResult.tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
      wallet: ownerWallet,
    })

    await mgr.acceptAdminRole({
      tokenAddress: tokenResult.tokenAddress,
      address: SEPOLIA_ROUTER,
      wallet: ownerWallet,
    })

    // 4. Set pool
    await mgr.setPool({
      tokenAddress: tokenResult.tokenAddress,
      poolAddress,
      address: SEPOLIA_ROUTER,
      wallet: ownerWallet,
    })
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // Verify initial owner
  // ===========================================================================

  it('should have owner as initial pool owner', async () => {
    const pool = new Contract(poolAddress, OWNABLE_ABI, provider)
    const currentOwner = (await pool.getFunction('owner')()) as string
    assert.equal(
      currentOwner.toLowerCase(),
      ownerWallet.address.toLowerCase(),
      'initial pool owner should be deployer',
    )
  })

  // ===========================================================================
  // transferOwnership + acceptOwnership round-trip
  // ===========================================================================

  it('should transfer ownership to burner wallet and accept', async () => {
    // Transfer ownership (propose burner as new owner)
    const transferResult = await mgr.transferOwnership({
      poolAddress,
      newOwner: burnerWallet.address,
      wallet: ownerWallet,
    })

    assert.ok(transferResult.hash, 'should return tx hash')
    assert.match(transferResult.hash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Owner should still be the original owner (pending transfer)
    const pool = new Contract(poolAddress, OWNABLE_ABI, provider)
    const ownerAfterProposal = (await pool.getFunction('owner')()) as string
    assert.equal(
      ownerAfterProposal.toLowerCase(),
      ownerWallet.address.toLowerCase(),
      'owner should not change until acceptance',
    )

    // Accept ownership from burner wallet
    const acceptResult = await mgr.acceptOwnership({
      poolAddress,
      wallet: burnerWallet,
    })

    assert.ok(acceptResult.hash, 'should return tx hash')
    assert.match(acceptResult.hash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify new owner
    const newOwner = (await pool.getFunction('owner')()) as string
    assert.equal(
      newOwner.toLowerCase(),
      burnerWallet.address.toLowerCase(),
      'pool owner should be burner wallet after acceptance',
    )
  })
})
