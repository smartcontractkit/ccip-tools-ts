import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { Instance } from 'prool'

import BurnMintERC20ABI from './abi/BurnMintERC20.ts'
import { EVMTokenAdmin } from './index.ts'

// ── Constants ──

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

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = process.env.VERBOSE
  ? console
  : { debug() {}, info() {}, warn: console.warn, error: console.error }

describe('EVMTokenAdmin Fork Tests', { skip, timeout: 60_000 }, () => {
  let provider: JsonRpcProvider
  let wallet: Wallet
  let admin: EVMTokenAdmin
  let anvilInstance: ReturnType<typeof Instance.anvil> | undefined

  before(async () => {
    anvilInstance = Instance.anvil({ port: 8747 })
    await anvilInstance.start()

    const anvilUrl = `http://${anvilInstance.host}:${anvilInstance.port}`
    provider = new JsonRpcProvider(anvilUrl, undefined, { cacheTimeout: -1 })
    wallet = new Wallet(ANVIL_PRIVATE_KEY, provider)
    admin = await EVMTokenAdmin.fromUrl(anvilUrl, { logger: testLogger, apiClient: null })
  })

  after(async () => {
    provider.destroy()
    await anvilInstance?.stop()
  })

  // ===========================================================================
  // deployToken — Full integration
  // ===========================================================================

  it('should deploy BurnMintERC20 and verify all contract state', async () => {
    const maxSupply = 1_000_000n * 10n ** 18n
    const initialSupply = 10_000n * 10n ** 18n

    const result = await admin.deployToken(wallet, {
      name: 'Test Token',
      symbol: 'TT',
      decimals: 18,
      maxSupply,
      initialSupply,
    })

    // Verify result shape
    assert.ok(result.tokenAddress, 'should return token address')
    assert.match(result.tokenAddress, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
    assert.ok(result.txHash, 'should return tx hash')
    assert.match(result.txHash, /^0x[0-9a-fA-F]{64}$/, 'should be valid tx hash')

    // Verify all deployed contract state
    const token = new Contract(result.tokenAddress, BurnMintERC20ABI, provider)
    const name: string = await token.getFunction('name')()
    const symbol: string = await token.getFunction('symbol')()
    const decimals: bigint = await token.getFunction('decimals')()
    const supply: bigint = await token.getFunction('totalSupply')()
    const max: bigint = await token.getFunction('maxSupply')()
    const balance: bigint = await token.getFunction('balanceOf')(await wallet.getAddress())
    const ccipAdmin: string = await token.getFunction('getCCIPAdmin')()

    assert.equal(name, 'Test Token')
    assert.equal(symbol, 'TT')
    assert.equal(decimals, 18n)
    assert.equal(supply, initialSupply)
    assert.equal(max, maxSupply)
    assert.equal(balance, initialSupply, 'deployer should receive initial supply')
    assert.equal(
      ccipAdmin.toLowerCase(),
      (await wallet.getAddress()).toLowerCase(),
      'deployer should be CCIP admin',
    )
  })

  it('should deploy with 0 decimals and unlimited supply', async () => {
    const result = await admin.deployToken(wallet, {
      name: 'Zero Decimal',
      symbol: 'ZD',
      decimals: 0,
      maxSupply: 0n,
      initialSupply: 100n,
    })

    const token = new Contract(result.tokenAddress, BurnMintERC20ABI, provider)
    const decimals: bigint = await token.getFunction('decimals')()
    const supply: bigint = await token.getFunction('totalSupply')()
    const max: bigint = await token.getFunction('maxSupply')()

    assert.equal(decimals, 0n)
    assert.equal(supply, 100n)
    assert.equal(max, 0n, 'maxSupply 0 means unlimited')
  })

  // ===========================================================================
  // generateUnsignedDeployToken — Verify unsigned tx can be signed manually
  // ===========================================================================

  it('should produce unsigned tx that deploys successfully when signed manually', async () => {
    const unsigned = await admin.generateUnsignedDeployToken({
      name: 'Manual Token',
      symbol: 'MAN',
      decimals: 8,
      initialSupply: 500n,
    })

    assert.equal(unsigned.transactions.length, 1)
    const tx = unsigned.transactions[0]!
    assert.equal(tx.to, null)

    // Sign and send manually
    const populated = await wallet.populateTransaction(tx)
    populated.from = undefined
    const response = await wallet.sendTransaction(populated)
    const receipt = await response.wait(1, 30_000)

    assert.ok(receipt, 'should get receipt')
    assert.equal(receipt.status, 1, 'tx should succeed')
    assert.ok(receipt.contractAddress, 'should have contract address')

    // Verify the deployed contract
    const token = new Contract(receipt.contractAddress, BurnMintERC20ABI, provider)
    const name: string = await token.getFunction('name')()
    assert.equal(name, 'Manual Token')
  })
})
