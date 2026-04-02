import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'
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

// Minimal ABIs
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
  {
    inputs: [],
    name: 'owner',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('EVMTokenAdmin proposeAdminRole Fork Tests', { skip, timeout: 120_000 }, () => {
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
      port: 8749,
      forkUrl: SEPOLIA_RPC,
      forkBlockNumber: undefined, // latest
    })
    await anvilInstance.start()

    const anvilUrl = `http://${anvilInstance.host}:${anvilInstance.port}`
    provider = new JsonRpcProvider(anvilUrl, undefined, { cacheTimeout: -1 })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, provider)
    walletAddress = await wallet.getAddress()

    admin = await EVMTokenAdmin.fromUrl(anvilUrl, { logger: testLogger, apiClient: null })

    // Deploy a token first (needed to propose admin for it)
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Admin Test Token',
      symbol: 'ATT',
      decimals: 18,
      initialSupply: 1_000_000n * 10n ** 18n,
    })
    tokenAddress = tokenResult.tokenAddress

    // Discover TAR for verification
    tarAddress = await admin.getTokenAdminRegistryFor(SEPOLIA_ROUTER)
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // getTokenAdminRegistryFor — inherited from EVMChain
  // ===========================================================================

  it('should discover TokenAdminRegistry from router', async () => {
    assert.ok(tarAddress, 'should return TAR address')
    assert.match(tarAddress, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
    assert.notEqual(
      tarAddress.toLowerCase(),
      '0x0000000000000000000000000000000000000000',
      'should not be zero address',
    )
  })

  // ===========================================================================
  // proposeAdminRole — Happy Path (via registerAdminViaGetCCIPAdmin)
  // ===========================================================================

  it('should propose admin role via registerAdminViaGetCCIPAdmin and verify on-chain', async () => {
    // BurnMintERC20 implements getCCIPAdmin() (not owner()), so use 'getCCIPAdmin' method
    const result = await admin.proposeAdminRole(wallet, {
      tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: read getTokenConfig from the TAR
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config.pendingAdministrator as string).toLowerCase(),
      walletAddress.toLowerCase(),
      'pendingAdministrator should match wallet address (token owner)',
    )
  })

  // ===========================================================================
  // generateUnsignedProposeAdminRole — structure verification
  // ===========================================================================

  it('should produce unsigned tx with correct shape', async () => {
    const unsigned = admin.generateUnsignedProposeAdminRole({
      tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.ok(tx.to, 'should have a to address (RegistryModule contract)')
    assert.equal(
      (tx.to as string).toLowerCase(),
      SEPOLIA_REGISTRY_MODULE.toLowerCase(),
      'to should be RegistryModule address',
    )
    assert.ok(tx.data, 'should have calldata')
  })

  // ===========================================================================
  // generateUnsignedProposeAdminRole — manual sign (token owner)
  // ===========================================================================

  it('should produce unsigned tx that succeeds when signed by token owner', async () => {
    // Deploy a fresh token for this test
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Manual Sign Test Token',
      symbol: 'MST',
      decimals: 18,
    })

    const unsigned = admin.generateUnsignedProposeAdminRole({
      tokenAddress: tokenResult.tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    // Use the wallet (token owner) to submit
    const tx = unsigned.transactions[0]!
    const populated = await wallet.populateTransaction(tx)
    const response = await wallet.sendTransaction(populated)
    const receipt = await response.wait(1, 30_000)

    assert.ok(receipt, 'should get receipt')
    assert.equal(receipt.status, 1, 'tx should succeed')

    // Verify on-chain
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config = await tar.getFunction('getTokenConfig')(tokenResult.tokenAddress)

    assert.equal(
      (config.pendingAdministrator as string).toLowerCase(),
      walletAddress.toLowerCase(),
      'pendingAdministrator should match',
    )
  })
})
