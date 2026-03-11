import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from 'ethers'
import { Instance } from 'prool'

import { EVMTokenAdmin } from './index.ts'

// ── Constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://ethereum-sepolia-rpc.publicnode.com'
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const SEPOLIA_REGISTRY_MODULE = '0xa3c796d480638d7476792230da1E2ADa86e031b0'
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

// Minimal ABI
const TAR_ABI = [
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'getTokenConfig',
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'administrator', type: 'address' },
          { name: 'pendingAdministrator', type: 'address' },
          { name: 'tokenPool', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('EVMTokenAdmin acceptAdminRole Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let admin: EVMTokenAdmin
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let tokenAddress: string
  let walletAddress: string
  let tarAddress: string

  before(async () => {
    // Fork Sepolia so we have a real Router with offRamps
    anvilInstance = Instance.anvil({
      port: 8750,
      forkUrl: SEPOLIA_RPC,
      forkBlockNumber: undefined, // latest
    })
    await anvilInstance.start()

    const anvilUrl = `http://${anvilInstance.host}:${anvilInstance.port}`
    provider = new JsonRpcProvider(anvilUrl, undefined, { cacheTimeout: -1 })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, provider)
    walletAddress = await wallet.getAddress()

    admin = await EVMTokenAdmin.fromUrl(anvilUrl, { logger: testLogger, apiClient: null })

    // Deploy a token
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Accept Admin Test Token',
      symbol: 'AATT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
    })
    tokenAddress = tokenResult.tokenAddress

    // Discover TAR
    tarAddress = await admin.getTokenAdminRegistryFor(SEPOLIA_ROUTER)

    // Propose admin first (required before accept)
    await admin.proposeAdminRole(wallet, {
      tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // Verify pending administrator is set after propose
  // ===========================================================================

  it('should have pending administrator set after propose', async () => {
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config.pendingAdministrator as string).toLowerCase(),
      walletAddress.toLowerCase(),
      'pendingAdministrator should match wallet address',
    )
  })

  // ===========================================================================
  // acceptAdminRole — Happy Path
  // ===========================================================================

  it('should accept admin role and verify on-chain', async () => {
    const result = await admin.acceptAdminRole(wallet, {
      tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: administrator should be set, pendingAdministrator cleared
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config.administrator as string).toLowerCase(),
      walletAddress.toLowerCase(),
      'administrator should match wallet address',
    )
    assert.equal(
      (config.pendingAdministrator as string).toLowerCase(),
      ZeroAddress.toLowerCase(),
      'pendingAdministrator should be cleared',
    )
  })

  // ===========================================================================
  // generateUnsignedAcceptAdminRole — structure verification
  // ===========================================================================

  it('should produce unsigned tx with correct shape', async () => {
    // Deploy + propose another token for this test
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Unsigned Accept Test',
      symbol: 'UAT',
      decimals: 18,
    })

    await admin.proposeAdminRole(wallet, {
      tokenAddress: tokenResult.tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    const unsigned = await admin.generateUnsignedAcceptAdminRole({
      tokenAddress: tokenResult.tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.ok(tx.to, 'should have a to address (TAR contract)')
    assert.equal(
      (tx.to as string).toLowerCase(),
      tarAddress.toLowerCase(),
      'to should be TAR address',
    )
    assert.ok(tx.data, 'should have calldata')
  })

  // ===========================================================================
  // transferAdminRole — Round-trip
  // ===========================================================================

  it('should transfer admin to second wallet and verify on-chain', async () => {
    // Second anvil account
    const wallet2 = new Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider,
    )
    const wallet2Address = await wallet2.getAddress()

    // Transfer admin from wallet → wallet2
    const transferResult = await admin.transferAdminRole(wallet, {
      tokenAddress,
      newAdmin: wallet2Address,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(transferResult.txHash, 'should return tx hash')
    assert.match(transferResult.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: pendingAdministrator should be wallet2
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config1 = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config1.administrator as string).toLowerCase(),
      walletAddress.toLowerCase(),
      'administrator should still be wallet (not yet accepted)',
    )
    assert.equal(
      (config1.pendingAdministrator as string).toLowerCase(),
      wallet2Address.toLowerCase(),
      'pendingAdministrator should be wallet2',
    )

    // Accept with wallet2
    const acceptResult = await admin.acceptAdminRole(wallet2, {
      tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(acceptResult.txHash, 'accept should return tx hash')

    // Verify on-chain: administrator is now wallet2
    const config2 = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config2.administrator as string).toLowerCase(),
      wallet2Address.toLowerCase(),
      'administrator should now be wallet2',
    )
    assert.equal(
      (config2.pendingAdministrator as string).toLowerCase(),
      ZeroAddress.toLowerCase(),
      'pendingAdministrator should be cleared',
    )

    // Transfer back: wallet2 → wallet
    const transferBackResult = await admin.transferAdminRole(wallet2, {
      tokenAddress,
      newAdmin: walletAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(transferBackResult.txHash, 'transfer back should return tx hash')

    // Accept with wallet
    const acceptBackResult = await admin.acceptAdminRole(wallet, {
      tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(acceptBackResult.txHash, 'accept back should return tx hash')

    // Verify on-chain: administrator is back to wallet
    const config3 = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config3.administrator as string).toLowerCase(),
      walletAddress.toLowerCase(),
      'administrator should be back to original wallet',
    )
    assert.equal(
      (config3.pendingAdministrator as string).toLowerCase(),
      ZeroAddress.toLowerCase(),
      'pendingAdministrator should be cleared after round-trip',
    )
  })
})
