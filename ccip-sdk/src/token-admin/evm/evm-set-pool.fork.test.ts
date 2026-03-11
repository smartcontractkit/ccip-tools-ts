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

// Minimal ABI for reading TAR config
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

describe('EVMTokenAdmin setPool Fork Tests', { skip, timeout: 120_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let admin: EVMTokenAdmin
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined
  let tokenAddress: string
  let poolAddress: string
  let tarAddress: string

  before(async () => {
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
      name: 'Set Pool Test Token',
      symbol: 'SPTT',
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

    // 3. Propose + accept admin
    await admin.proposeAdminRole(wallet, {
      tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    await admin.acceptAdminRole(wallet, {
      tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    // Discover TAR for verification
    tarAddress = await admin.getTokenAdminRegistryFor(SEPOLIA_ROUTER)
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // Verify pool is not set before setPool
  // ===========================================================================

  it('should have no pool set before setPool', async () => {
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config.tokenPool as string).toLowerCase(),
      ZeroAddress.toLowerCase(),
      'tokenPool should be zero address before setPool',
    )
  })

  // ===========================================================================
  // setPool — Happy Path
  // ===========================================================================

  it('should set pool and verify on-chain', async () => {
    const result = await admin.setPool(wallet, {
      tokenAddress,
      poolAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain: tokenPool should be set
    const tar = new Contract(tarAddress, TAR_ABI, provider)
    const config = await tar.getFunction('getTokenConfig')(tokenAddress)

    assert.equal(
      (config.tokenPool as string).toLowerCase(),
      poolAddress.toLowerCase(),
      'tokenPool should match pool address after setPool',
    )
  })

  // ===========================================================================
  // generateUnsignedSetPool — structure verification
  // ===========================================================================

  it('should produce unsigned tx with correct shape', async () => {
    // Deploy another token + pool for this test
    const tokenResult = await admin.deployToken(wallet, {
      name: 'Unsigned SetPool Test',
      symbol: 'USPT',
      decimals: 18,
    })

    const poolResult = await admin.deployPool(wallet, {
      poolType: 'burn-mint',
      tokenAddress: tokenResult.tokenAddress,
      localTokenDecimals: 18,
      routerAddress: SEPOLIA_ROUTER,
    })

    await admin.proposeAdminRole(wallet, {
      tokenAddress: tokenResult.tokenAddress,
      registryModuleAddress: SEPOLIA_REGISTRY_MODULE,
      registrationMethod: 'getCCIPAdmin',
    })

    await admin.acceptAdminRole(wallet, {
      tokenAddress: tokenResult.tokenAddress,
      routerAddress: SEPOLIA_ROUTER,
    })

    const unsigned = await admin.generateUnsignedSetPool({
      tokenAddress: tokenResult.tokenAddress,
      poolAddress: poolResult.poolAddress,
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
  // grantMintBurnAccess — Happy Path
  // ===========================================================================

  it('should grant mint/burn access to pool and verify on-chain', async () => {
    const result = await admin.grantMintBurnAccess(wallet, {
      tokenAddress,
      authority: poolAddress,
    })

    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify on-chain using hasRole directly (faster than getMintBurnRoles which scans events)
    const ROLE_ABI = [
      {
        inputs: [
          { name: 'role', type: 'bytes32' },
          { name: 'account', type: 'address' },
        ],
        name: 'hasRole',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
      },
      {
        inputs: [],
        name: 'MINTER_ROLE',
        outputs: [{ name: '', type: 'bytes32' }],
        stateMutability: 'view',
        type: 'function',
      },
      {
        inputs: [],
        name: 'BURNER_ROLE',
        outputs: [{ name: '', type: 'bytes32' }],
        stateMutability: 'view',
        type: 'function',
      },
    ] as const

    const token = new Contract(tokenAddress, ROLE_ABI, provider)
    const [minterRole, burnerRole] = await Promise.all([
      token.getFunction('MINTER_ROLE')() as Promise<string>,
      token.getFunction('BURNER_ROLE')() as Promise<string>,
    ])

    const [hasMinter, hasBurner] = await Promise.all([
      token.getFunction('hasRole')(minterRole, poolAddress) as Promise<boolean>,
      token.getFunction('hasRole')(burnerRole, poolAddress) as Promise<boolean>,
    ])

    assert.ok(hasMinter, 'pool should have MINTER_ROLE')
    assert.ok(hasBurner, 'pool should have BURNER_ROLE')
  })

  // ===========================================================================
  // generateUnsignedGrantMintBurnAccess — structure verification
  // ===========================================================================

  it('should produce unsigned grantMintBurnAccess tx with correct shape', async () => {
    const unsigned = admin.generateUnsignedGrantMintBurnAccess({
      tokenAddress,
      authority: poolAddress,
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(
      (tx.to as string).toLowerCase(),
      tokenAddress.toLowerCase(),
      'to should be token address',
    )
    assert.ok(tx.data, 'should have calldata')
  })
})
