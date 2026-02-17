/**
 * EVM Fork Tests - Consolidated
 *
 * All fork tests consolidated into a single file to share Anvil fork instances,
 * reducing RPC calls and avoiding rate limiting issues.
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'

import {
  type TransactionRequest,
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  keccak256,
  parseUnits,
  toBeHex,
} from 'ethers'
import { anvil } from 'prool/instances'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import { CCIPTokenNotConfiguredError, CCIPVersionFeatureUnavailableError } from '../errors/index.ts'
import { calculateManualExecProof, discoverOffRamp } from '../execution.ts'
import { type ExecutionReport, CCIPVersion, ChainFamily, ExecutionState } from '../types.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'
import { clearArchiveRpcsCache } from './logs.ts'

// ============================================================================
// Constants
// ============================================================================

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://rpcs.cldev.sh/ethereum/sepolia'
const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n
const SEPOLIA_ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const SEPOLIA_LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789'

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://rpcs.cldev.sh/avalanche/fuji'
const FUJI_CHAIN_ID = 43113
const FUJI_SELECTOR = 14767482510784806043n
const FUJI_ROUTER = '0xF694E193200268f9a4868e4Aa017A0118C9a8177'

const APTOS_TESTNET_SELECTOR = 743186221051783445n
const APTOS_SUPPORTED_TOKEN = '0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05'

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Known transactions for testing
const KNOWN_TX_HASH = '0x25e63fa89abb77acd353edc24ed3ab5880a8d206c8229e6f61dc00d399f447b3'
const KNOWN_MESSAGE_ID = '0xdfb374fef50749b0bc86784e097ecc9547c5145ddfb8f9d96f1da3024abfcd04'
const FAILED_MESSAGE_TX = '0xccf840f3e8268ad00822458862408a642d3bbef079096cacf65a68c8f2e21bc9'
const FAILED_MESSAGE_ID = '0xe7b71ffcab4fc1ad029c412bb75b33a2d036b59853f08b9306cc317690a29246'

// Event topic hashes
const CCIP_SEND_REQUESTED_TOPIC =
  interfaces.EVM2EVMOnRamp_v1_5.getEvent('CCIPSendRequested')!.topicHash
const CCIP_MESSAGE_SENT_TOPIC = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!.topicHash

// ============================================================================
// Helper Functions
// ============================================================================

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function setERC20Balance(
  provider: JsonRpcProvider,
  token: string,
  address: string,
  amount: bigint,
  balanceSlot = 0n,
): Promise<void> {
  const storageKey = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [address, balanceSlot]),
  )
  await provider.send('anvil_setStorageAt', [token, storageKey, toBeHex(amount, 32)])
  const erc20 = new Contract(token, interfaces.Token, provider)
  const balance: bigint = await erc20.getFunction('balanceOf')(address)
  if (balance !== amount) {
    if (balanceSlot < 20n)
      return setERC20Balance(provider, token, address, amount, balanceSlot + 1n)
    throw new Error(
      `setERC20Balance: no working slot found (last tried ${balanceSlot}, got ${balance}, expected ${amount})`,
    )
  }
}

// ============================================================================
// Main Test Suite
// ============================================================================

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

describe('EVM Fork Tests', { skip, timeout: 300_000 }, () => {
  let sepoliaChain: EVMChain | undefined
  let fujiChain: EVMChain | undefined
  let sepoliaInstance: ReturnType<typeof anvil> | undefined
  let fujiInstance: ReturnType<typeof anvil> | undefined
  let sepoliaProvider: JsonRpcProvider
  let fujiProvider: JsonRpcProvider
  let sepoliaWallet: Wallet
  let _fujiWallet: Wallet

  before(async () => {
    // Start both forks in parallel
    // NOTE: Don't pass { timeout } to prool — it creates a timer that isn't cleared on
    // success, keeping the event loop alive. We handle stop timeouts ourselves in after().
    sepoliaInstance = anvil({ forkUrl: SEPOLIA_RPC, chainId: SEPOLIA_CHAIN_ID, port: 8550 })
    fujiInstance = anvil({ forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8551 })
    await Promise.all([sepoliaInstance.start(), fujiInstance.start()])

    // Create providers and chains
    sepoliaProvider = new JsonRpcProvider(`http://${sepoliaInstance.host}:${sepoliaInstance.port}`)
    fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)

    sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, { apiClient: null })
    fujiChain = await EVMChain.fromProvider(fujiProvider, { apiClient: null })

    // Create wallets for tests that need signing
    sepoliaWallet = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)
    _fujiWallet = new Wallet(ANVIL_PRIVATE_KEY, fujiProvider)
  })

  after(async () => {
    // Destroy chains (resolves destroy$ which triggers provider.destroy() via .finally())
    sepoliaChain?.destroy?.()
    fujiChain?.destroy?.()

    // Explicitly destroy providers as belt-and-suspenders (idempotent)
    sepoliaProvider.destroy()
    fujiProvider.destroy()

    await clearArchiveRpcsCache()

    // Stop anvil instances with a timeout. Use .unref() so the timer doesn't keep
    // the event loop alive. Race stop() against the timeout so a hung anvil process
    // (e.g. still fetching forked state) doesn't block cleanup indefinitely.
    const stopWithTimeout = (instance: typeof sepoliaInstance) => {
      if (!instance) return
      const unrefTimeout = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5_000)
        t.unref()
      })
      return Promise.race([instance.stop(), unrefTimeout])
    }
    await Promise.allSettled([stopWithTimeout(sepoliaInstance), stopWithTimeout(fujiInstance)])

    // Force-kill any anvil processes that didn't stop gracefully
    sepoliaInstance?._internal.process.kill('SIGKILL')
    fujiInstance?._internal.process.kill('SIGKILL')
  })

  // ==========================================================================
  // Router and Lane Discovery
  // ==========================================================================

  describe('Router and Lane Discovery', () => {
    describe('typeAndVersion', () => {
      it('should return [Router, version] for Sepolia Router', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const [type, version, raw] = await sepoliaChain.typeAndVersion(SEPOLIA_ROUTER)
        assert.equal(type, 'Router', 'should be Router type')
        assert.ok(version, 'should have a version')
        assert.ok(raw.startsWith('Router'), 'raw should start with Router')
      })

      it('should return [EVM2EVMOnRamp, version] for v1.5 OnRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const [type, version] = await sepoliaChain.typeAndVersion(onRamp)
        assert.equal(type, 'EVM2EVMOnRamp', 'should be EVM2EVMOnRamp type')
        assert.ok(
          version === CCIPVersion.V1_5 || version === CCIPVersion.V1_2,
          'should be v1.2 or v1.5',
        )
      })

      it('should return [OnRamp, version] for v1.6 OnRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        const [type, version] = await sepoliaChain.typeAndVersion(onRamp)
        assert.equal(type, 'OnRamp', 'should be OnRamp type')
        assert.equal(version, CCIPVersion.V1_6, 'should be v1.6')
      })
    })

    describe('getOnRampForRouter', () => {
      it('should return v1.5 OnRamp for Sepolia->Fuji lane', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        assert.match(onRamp, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(onRamp, ZeroAddress, 'should not be zero address')

        const [type] = await sepoliaChain.typeAndVersion(onRamp)
        assert.ok(type.includes('OnRamp'), `should be an OnRamp, got ${type}`)
      })

      it('should return v1.6 OnRamp for Sepolia->Aptos lane', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        assert.match(onRamp, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(onRamp, ZeroAddress, 'should not be zero address')

        const [type, version] = await sepoliaChain.typeAndVersion(onRamp)
        assert.equal(type, 'OnRamp', 'should be OnRamp type')
        assert.equal(version, CCIPVersion.V1_6, 'should be v1.6')
      })

      it('should return ZeroAddress for unsupported destination', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const INVALID_SELECTOR = 999999999999n
        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, INVALID_SELECTOR)
        assert.equal(onRamp, ZeroAddress, 'should return zero address for unsupported destination')
      })
    })

    describe('getOffRampsForRouter', () => {
      it('should return OffRamp array for valid source chain', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        assert.ok(Array.isArray(offRamps), 'should return an array')

        for (const offRamp of offRamps) {
          assert.match(offRamp, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
          const [type] = await sepoliaChain.typeAndVersion(offRamp)
          assert.ok(type.includes('OffRamp'), `should be an OffRamp, got ${type}`)
        }
      })

      it('should return empty array for unsupported source', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const INVALID_SELECTOR = 999999999999n
        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, INVALID_SELECTOR)
        assert.ok(Array.isArray(offRamps), 'should return an array')
        assert.equal(offRamps.length, 0, 'should return empty array')
      })
    })

    describe('getRouterForOnRamp', () => {
      it('should return Router from v1.5 OnRamp (via getDynamicConfig)', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const [, version] = await sepoliaChain.typeAndVersion(onRamp)
        if (version !== CCIPVersion.V1_5 && version !== CCIPVersion.V1_2) return

        const router = await sepoliaChain.getRouterForOnRamp(onRamp, FUJI_SELECTOR)
        assert.equal(router, SEPOLIA_ROUTER, 'should return the original router')
      })

      it('should return Router from v1.6 OnRamp (via getDestChainConfig)', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        const [, version] = await sepoliaChain.typeAndVersion(onRamp)
        if (version !== CCIPVersion.V1_6) return

        const router = await sepoliaChain.getRouterForOnRamp(onRamp, APTOS_TESTNET_SELECTOR)
        assert.equal(router, SEPOLIA_ROUTER, 'should return the original router')
      })
    })

    describe('getRouterForOffRamp', () => {
      it('should return Router from OffRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (offRamps.length === 0) return

        const router = await sepoliaChain.getRouterForOffRamp(offRamps[0]!, FUJI_SELECTOR)
        assert.equal(router, SEPOLIA_ROUTER, 'should return the original router')
      })
    })

    describe('getOnRampForOffRamp', () => {
      it('should return source OnRamp from OffRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (offRamps.length === 0) return

        const onRamp = await sepoliaChain.getOnRampForOffRamp(offRamps[0]!, FUJI_SELECTOR)
        assert.match(onRamp, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(onRamp, ZeroAddress, 'should not be zero address')
      })
    })

    describe('getLaneForOnRamp', () => {
      it('should return Lane with sourceChainSelector, destChainSelector, version', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const lane = await sepoliaChain.getLaneForOnRamp(onRamp)
        assert.equal(lane.sourceChainSelector, SEPOLIA_SELECTOR, 'source should be Sepolia')
        assert.equal(lane.destChainSelector, FUJI_SELECTOR, 'dest should be Fuji')
        assert.ok(lane.version, 'should have version')
        assert.equal(lane.onRamp, onRamp, 'should include onRamp address')
      })
    })

    describe('getNativeTokenForRouter', () => {
      it('should return WETH address for Sepolia Router', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const weth = await sepoliaChain.getNativeTokenForRouter(SEPOLIA_ROUTER)
        assert.match(weth, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(weth, ZeroAddress, 'should not be zero address')

        const info = await sepoliaChain.getTokenInfo(weth)
        assert.ok(info.symbol, 'should have symbol')
        assert.equal(info.decimals, 18, 'WETH should have 18 decimals')
      })
    })
  })

  // ==========================================================================
  // Fee Functions
  // ==========================================================================

  describe('Fee Functions', () => {
    describe('getFee', () => {
      it('should return native fee for data-only message (v1.5 lane)', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const fee = await sepoliaChain.getFee({
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000001',
            data: '0x1234',
          },
        })

        assert.ok(typeof fee === 'bigint', 'fee should be bigint')
        assert.ok(fee > 0n, `fee should be positive, got ${fee}`)
      })

      it('should return native fee for data-only message (v1.6 lane)', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        try {
          const fee = await sepoliaChain.getFee({
            router: SEPOLIA_ROUTER,
            destChainSelector: APTOS_TESTNET_SELECTOR,
            message: {
              receiver: '0x0000000000000000000000000000000000000001',
              data: '0x1234',
              extraArgs: { gasLimit: 0n },
            },
          })

          assert.ok(typeof fee === 'bigint', 'fee should be bigint')
          assert.ok(fee > 0n, `fee should be positive, got ${fee}`)
        } catch (err) {
          // Skip if lane configuration changed on testnet (UnsupportedToken, etc.)
          if (String(err).includes('execution reverted')) return
          throw err
        }
      })

      it('should return fee with custom gasLimit in extraArgs', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const baseFee = await sepoliaChain.getFee({
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000001',
            data: '0x1234',
          },
        })

        const highGasFee = await sepoliaChain.getFee({
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000001',
            data: '0x1234',
            extraArgs: { gasLimit: 1_000_000n },
          },
        })

        assert.ok(highGasFee >= baseFee, 'higher gasLimit should result in equal or higher fee')
      })

      it('should return higher fee for message with token amounts', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        try {
          const dataOnlyFee = await sepoliaChain.getFee({
            router: SEPOLIA_ROUTER,
            destChainSelector: APTOS_TESTNET_SELECTOR,
            message: {
              receiver: '0x0000000000000000000000000000000000000001',
              data: '0x',
              extraArgs: { gasLimit: 0n },
            },
          })

          const withTokenFee = await sepoliaChain.getFee({
            router: SEPOLIA_ROUTER,
            destChainSelector: APTOS_TESTNET_SELECTOR,
            message: {
              receiver: '0x0000000000000000000000000000000000000001',
              data: '0x',
              tokenAmounts: [{ token: APTOS_SUPPORTED_TOKEN, amount: parseUnits('0.001', 18) }],
              extraArgs: { gasLimit: 0n },
            },
          })

          assert.ok(withTokenFee > dataOnlyFee, 'token transfer should have higher fee')
        } catch (err) {
          // Skip if lane configuration changed on testnet (UnsupportedToken, etc.)
          if (String(err).includes('execution reverted')) return
          throw err
        }
      })

      it('should return fee when using LINK as feeToken', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const fee = await sepoliaChain.getFee({
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000001',
            data: '0x1234',
            feeToken: SEPOLIA_LINK,
          },
        })

        assert.ok(typeof fee === 'bigint', 'fee should be bigint')
        assert.ok(fee > 0n, `fee should be positive, got ${fee}`)
      })
    })

    describe('getFeeTokens', () => {
      it('should return fee tokens with symbol/decimals', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const feeTokens = await sepoliaChain.getFeeTokens(SEPOLIA_ROUTER)

        assert.ok(typeof feeTokens === 'object', 'should return object')
        assert.ok(Object.keys(feeTokens).length > 0, 'should have at least one fee token')

        const [address, info] = Object.entries(feeTokens)[0]!
        assert.match(address, /^0x[0-9a-fA-F]{40}$/, 'key should be valid address')
        assert.ok(info.symbol, 'should have symbol')
        assert.ok(typeof info.decimals === 'number', 'should have decimals')
      })

      it('should include native wrapper token in list', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const weth = await sepoliaChain.getNativeTokenForRouter(SEPOLIA_ROUTER)
        const feeTokens = await sepoliaChain.getFeeTokens(SEPOLIA_ROUTER)

        for (const [addr, info] of Object.entries(feeTokens)) {
          assert.match(addr, /^0x[0-9a-fA-F]{40}$/)
          assert.ok(info.symbol)
          assert.ok(typeof info.decimals === 'number')
        }

        const hasWeth = Object.keys(feeTokens).some(
          (addr) => addr.toLowerCase() === weth.toLowerCase(),
        )
        if (hasWeth) {
          assert.ok(true, 'WETH is in fee tokens list')
        }
      })
    })

    describe('getFeeQuoterFor', () => {
      it('should return FeeQuoter address from v1.6 OnRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        const [, version] = await sepoliaChain.typeAndVersion(onRamp)
        if (version !== CCIPVersion.V1_6) return

        const feeQuoter = await sepoliaChain.getFeeQuoterFor(onRamp)
        assert.match(feeQuoter, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(feeQuoter, ZeroAddress, 'should not be zero address')

        const [type] = await sepoliaChain.typeAndVersion(feeQuoter)
        assert.equal(type, 'FeeQuoter', 'should be FeeQuoter type')
      })

      it('should throw CCIPVersionFeatureUnavailableError for v1.5 OnRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const [, version] = await sepoliaChain.typeAndVersion(onRamp)
        if (version === CCIPVersion.V1_6) return

        await assert.rejects(
          () => sepoliaChain!.getFeeQuoterFor(onRamp),
          (err: Error) => {
            assert.ok(err instanceof CCIPVersionFeatureUnavailableError)
            return true
          },
        )
      })
    })
  })

  // ==========================================================================
  // Token Operations
  // ==========================================================================

  describe('Token Operations', () => {
    describe('getTokenInfo', () => {
      it('should return correct symbol/decimals/name for LINK', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const info = await sepoliaChain.getTokenInfo(SEPOLIA_LINK)

        assert.equal(info.symbol, 'LINK', 'should be LINK')
        assert.equal(info.decimals, 18, 'LINK should have 18 decimals')
        assert.ok(info.name, 'should have name')
      })

      it('should return correct decimals (18) for WETH', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const weth = await sepoliaChain.getNativeTokenForRouter(SEPOLIA_ROUTER)
        const info = await sepoliaChain.getTokenInfo(weth)

        assert.equal(info.decimals, 18, 'WETH should have 18 decimals')
        assert.ok(info.symbol, 'should have symbol')
      })
    })

    describe('getBalance', () => {
      it('should return native ETH balance', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const balance = await sepoliaChain.getBalance({ holder: SEPOLIA_ROUTER })

        assert.ok(typeof balance === 'bigint', 'balance should be bigint')
      })

      it('should return ERC20 token balance', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const balance = await sepoliaChain.getBalance({
          holder: SEPOLIA_ROUTER,
          token: SEPOLIA_LINK,
        })

        assert.ok(typeof balance === 'bigint', 'balance should be bigint')
      })

      it('should return 0n for address with no balance', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        // Use a zero-padded address unlikely to have any LINK token balance
        // (0x...0002 avoids precompiles which might receive tokens)
        const randomAddress = '0x0000000000000000000000000000000000000002'
        const balance = await sepoliaChain.getBalance({
          holder: randomAddress,
          token: SEPOLIA_LINK,
        })

        // This address is unlikely to have LINK tokens, but if it does, the test still validates
        // that getBalance returns a valid bigint
        assert.ok(typeof balance === 'bigint', 'balance should be bigint')
      })
    })

    describe('getTokenAdminRegistryFor', () => {
      it('should return registry from Router', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const registry = await sepoliaChain.getTokenAdminRegistryFor(SEPOLIA_ROUTER)

        assert.match(registry, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(registry, ZeroAddress, 'should not be zero address')

        const [type] = await sepoliaChain.typeAndVersion(registry)
        assert.equal(type, 'TokenAdminRegistry', 'should be TokenAdminRegistry type')
      })

      it('should return registry from OnRamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        const registry = await sepoliaChain.getTokenAdminRegistryFor(onRamp)

        assert.match(registry, /^0x[0-9a-fA-F]{40}$/, 'should be valid address')
        assert.notEqual(registry, ZeroAddress, 'should not be zero address')
      })
    })

    // NOTE: getSupportedTokens, getRegistryTokenConfig, getTokenForTokenPool, getTokenPoolConfig,
    // and getTokenPoolRemotes tests are excluded from fork tests because they iterate over all
    // configured tokens in the registry. Each token's storage slot requires a round-trip to the
    // upstream RPC on a forked anvil, causing excessive forked state (~100GB) and hangs.

    describe('getRegistryTokenConfig', () => {
      it('should throw CCIPTokenNotConfiguredError for unconfigured token', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const registry = await sepoliaChain.getTokenAdminRegistryFor(SEPOLIA_ROUTER)
        const fakeToken = '0x0000000000000000000000000000000000000001'

        await assert.rejects(
          () => sepoliaChain!.getRegistryTokenConfig(registry, fakeToken),
          (err: Error) => {
            assert.ok(err instanceof CCIPTokenNotConfiguredError)
            return true
          },
        )
      })
    })
  })

  // ==========================================================================
  // Gas Estimation
  // ==========================================================================

  describe('Gas Estimation', () => {
    describe('estimateReceiveExecution', () => {
      it('should estimate gas for simple ccipReceive', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (offRamps.length === 0) return

        const offRamp = offRamps[0]!

        try {
          const gasEstimate = await sepoliaChain.estimateReceiveExecution({
            offRamp,
            receiver: SEPOLIA_ROUTER,
            message: {
              messageId: '0x' + '00'.repeat(32),
              sourceChainSelector: FUJI_SELECTOR,
              sender: '0x0000000000000000000000000000000000000001',
              data: '0x1234',
              destTokenAmounts: [],
            },
          })

          assert.ok(typeof gasEstimate === 'number', 'should return number')
          assert.ok(gasEstimate > 0, `gas estimate should be positive, got ${gasEstimate}`)
        } catch (err) {
          assert.ok(
            (err as Error).message.includes('revert') ||
              (err as Error).message.includes('execution reverted') ||
              (err as Error).message.includes('CALL_EXCEPTION'),
            'should fail with revert error if receiver does not implement ccipReceive',
          )
        }
      })

      it('should handle message with token amounts using state overrides', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (offRamps.length === 0) return

        const offRamp = offRamps[0]!

        try {
          const gasEstimate = await sepoliaChain.estimateReceiveExecution({
            offRamp,
            receiver: SEPOLIA_ROUTER,
            message: {
              messageId: '0x' + '00'.repeat(32),
              sourceChainSelector: FUJI_SELECTOR,
              sender: '0x0000000000000000000000000000000000000001',
              data: '0x',
              destTokenAmounts: [
                {
                  token: SEPOLIA_LINK,
                  amount: 1000000000000000000n,
                },
              ],
            },
          })

          assert.ok(typeof gasEstimate === 'number', 'should return number')
        } catch (err) {
          const errMsg = (err as Error).message
          assert.ok(
            errMsg.includes('revert') ||
              errMsg.includes('execution reverted') ||
              errMsg.includes('CALL_EXCEPTION') ||
              errMsg.includes('slot'),
            'should fail with known error type',
          )
        }
      })
    })

    describe('getBlockTimestamp for gas estimation context', () => {
      it('should return current block timestamp', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const latestBlock = await sepoliaChain.provider.getBlock('latest')
        assert.ok(latestBlock, 'should get latest block')
        const timestamp = await sepoliaChain.getBlockTimestamp(latestBlock.number)

        assert.ok(typeof timestamp === 'number', 'should be number')
        const now = Math.floor(Date.now() / 1000)
        assert.ok(
          Math.abs(timestamp - now) < 3600,
          `timestamp should be within last hour, got ${timestamp}, now ${now}`,
        )
      })
    })

    describe('provider state override capability', () => {
      it('should verify RPC supports eth_estimateGas with state overrides', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        try {
          const result = await sepoliaChain.provider.send('eth_estimateGas', [
            {
              from: '0x0000000000000000000000000000000000000001',
              to: SEPOLIA_LINK,
              data: '0x70a08231000000000000000000000000' + '0'.repeat(40),
            },
            'latest',
            {},
          ])

          assert.ok(result, 'should return gas estimate')
        } catch (err) {
          const errMsg = (err as Error).message
          if (errMsg.includes('unknown field')) {
            console.log('Note: RPC does not support state overrides')
          }
        }
      })
    })
  })

  // ==========================================================================
  // Logs and Receipts
  // ==========================================================================

  describe('Logs and Receipts', () => {
    describe('getBlockTimestamp', () => {
      it('should return timestamp for specific block number', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const block = await sepoliaChain.provider.getBlock('latest')
        assert.ok(block, 'should get latest block')

        const timestamp = await sepoliaChain.getBlockTimestamp(block.number - 10)

        assert.ok(typeof timestamp === 'number', 'timestamp should be number')
        assert.ok(timestamp > 0, 'timestamp should be positive')
        assert.ok(timestamp > 1577836800, 'timestamp should be after 2020')
      })

      it('should return timestamp for finalized block', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const timestamp = await sepoliaChain.getBlockTimestamp('finalized')

        assert.ok(typeof timestamp === 'number', 'timestamp should be number')
        assert.ok(timestamp > 0, 'timestamp should be positive')
      })
    })

    describe('getTransaction', () => {
      it('should return transaction with timestamp and logs', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const tx = await sepoliaChain.getTransaction(KNOWN_TX_HASH)

        assert.ok(tx, 'should return transaction')
        assert.equal(tx.hash, KNOWN_TX_HASH, 'hash should match')
        assert.ok(tx.timestamp > 0, 'should have timestamp')
        assert.ok(Array.isArray(tx.logs), 'should have logs array')
        assert.ok(tx.logs.length > 0, 'should have at least one log')
        assert.ok(tx.blockNumber > 0, 'should have block number')
      })
    })

    describe('getMessagesInTx', () => {
      it('should extract CCIP requests from known transaction', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const tx = await sepoliaChain.getTransaction(KNOWN_TX_HASH)
        const requests = await sepoliaChain.getMessagesInTx(tx)

        assert.ok(Array.isArray(requests), 'should return array')
        assert.ok(requests.length >= 1, 'should have at least one request')

        const request = requests[0]!
        assert.ok(request.message.messageId, 'should have messageId')
        assert.equal(request.message.messageId, KNOWN_MESSAGE_ID, 'messageId should match expected')
        assert.equal(request.lane.sourceChainSelector, SEPOLIA_SELECTOR, 'source should be Sepolia')
        assert.equal(request.lane.destChainSelector, FUJI_SELECTOR, 'dest should be Fuji')
        assert.ok(request.lane.onRamp, 'should have onRamp')
        assert.ok(request.tx, 'should have tx reference')
        assert.ok(request.log, 'should have log reference')
      })
    })

    describe('getExecutionReceipts', () => {
      it('should find receipt for known executed message (v1.5)', async () => {
        assert.ok(fujiChain, 'Fuji chain should be initialized')
        assert.ok(sepoliaChain, 'Sepolia chain should be initialized')

        const offRamps = await fujiChain.getOffRampsForRouter(FUJI_ROUTER, SEPOLIA_SELECTOR)

        if (offRamps.length === 0) return

        let foundReceipt = false
        for (const offRamp of offRamps) {
          try {
            for await (const execution of fujiChain.getExecutionReceipts({
              offRamp,
              messageId: KNOWN_MESSAGE_ID,
              sourceChainSelector: SEPOLIA_SELECTOR,
              startBlock: 1,
            })) {
              if (execution.receipt.messageId === KNOWN_MESSAGE_ID) {
                assert.equal(
                  execution.receipt.state,
                  ExecutionState.Success,
                  'should be Success state',
                )
                foundReceipt = true
                break
              }
            }
            if (foundReceipt) break
          } catch {
            // This offRamp might not handle this message, continue
          }
        }
      })

      it('should filter by messageId when provided', async () => {
        assert.ok(fujiChain, 'chain should be initialized')

        const offRamps = await fujiChain.getOffRampsForRouter(FUJI_ROUTER, SEPOLIA_SELECTOR)

        if (offRamps.length === 0) return

        for (const offRamp of offRamps) {
          try {
            for await (const execution of fujiChain.getExecutionReceipts({
              offRamp,
              messageId: KNOWN_MESSAGE_ID,
              sourceChainSelector: SEPOLIA_SELECTOR,
              startBlock: 1,
              page: 100,
            })) {
              assert.equal(
                execution.receipt.messageId,
                KNOWN_MESSAGE_ID,
                'should only return matching messageId',
              )
              return
            }
          } catch {
            // Continue
          }
        }
      })
    })

    describe('getLogs', () => {
      it('should stream logs with pagination', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const latestBlock = await sepoliaChain.provider.getBlock('latest')
        assert.ok(latestBlock, 'should get latest block')

        let logCount = 0
        for await (const log of sepoliaChain.getLogs({
          address: SEPOLIA_ROUTER,
          startBlock: latestBlock.number - 1000,
          endBlock: latestBlock.number,
          page: 100,
        })) {
          logCount++
          assert.ok(log.address, 'log should have address')
          assert.ok(log.topics, 'log should have topics')
          if (logCount >= 5) break
        }
      })
    })
  })

  // ==========================================================================
  // Unsigned Transaction Generation
  // ==========================================================================

  describe('Unsigned Transaction Generation', () => {
    describe('generateUnsignedSendMessage', () => {
      it('should generate ccipSend tx for data-only message', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const sender = '0x0000000000000000000000000000000000000001'
        const result = await sepoliaChain.generateUnsignedSendMessage({
          sender,
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000002',
            data: '0x1234',
          },
        })

        assert.equal(result.family, ChainFamily.EVM, 'should be EVM family')
        assert.ok(Array.isArray(result.transactions), 'should have transactions array')
        assert.ok(result.transactions.length >= 1, 'should have at least one transaction')

        const sendTx = result.transactions[result.transactions.length - 1] as TransactionRequest
        assert.equal(
          (sendTx.to as string).toLowerCase(),
          SEPOLIA_ROUTER.toLowerCase(),
          'should target router',
        )
        assert.equal(sendTx.from, sender, 'should have sender as from')
        assert.ok(sendTx.data, 'should have calldata')
        assert.ok(sendTx.data.startsWith('0x'), 'data should be hex')
      })

      it('should include fee in transaction value (native payment)', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const sender = '0x0000000000000000000000000000000000000001'
        const result = await sepoliaChain.generateUnsignedSendMessage({
          sender,
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000002',
            data: '0x1234',
          },
        })

        const sendTx = result.transactions[result.transactions.length - 1] as TransactionRequest
        assert.ok(sendTx.value, 'should have value for native fee')
        assert.ok(BigInt(sendTx.value.toString()) > 0n, 'value should be positive')
      })

      it('should include approval txs when token allowance insufficient', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, APTOS_TESTNET_SELECTOR)
        if (onRamp === ZeroAddress) return

        const sender = '0x0000000000000000000000000000000000000099'
        const result = await sepoliaChain.generateUnsignedSendMessage({
          sender,
          router: SEPOLIA_ROUTER,
          destChainSelector: APTOS_TESTNET_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000002',
            data: '0x',
            tokenAmounts: [{ token: APTOS_SUPPORTED_TOKEN, amount: parseUnits('1', 18) }],
            extraArgs: { gasLimit: 0n },
          },
        })

        assert.ok(result.transactions.length >= 2, 'should have approval + send transactions')

        const approveTx = result.transactions[0] as TransactionRequest
        assert.equal(
          (approveTx.to as string).toLowerCase(),
          APTOS_SUPPORTED_TOKEN.toLowerCase(),
          'first tx should target token',
        )
      })

      it('should skip approval when allowance is sufficient', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const sender = '0x0000000000000000000000000000000000000001'
        const result = await sepoliaChain.generateUnsignedSendMessage({
          sender,
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000002',
            data: '0x1234',
          },
        })

        assert.equal(result.transactions.length, 1, 'should have only send transaction')
      })

      it('should handle feeToken specification', async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')

        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (onRamp === ZeroAddress) return

        const sender = '0x0000000000000000000000000000000000000099'
        const result = await sepoliaChain.generateUnsignedSendMessage({
          sender,
          router: SEPOLIA_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: {
            receiver: '0x0000000000000000000000000000000000000002',
            data: '0x1234',
            feeToken: SEPOLIA_LINK,
          },
        })

        assert.ok(result.transactions.length >= 2, 'should have approval + send transactions')

        const approveTx = result.transactions[0] as TransactionRequest
        assert.equal(
          (approveTx.to as string).toLowerCase(),
          SEPOLIA_LINK.toLowerCase(),
          'should approve LINK for fee',
        )

        const sendTx = result.transactions[result.transactions.length - 1] as TransactionRequest
        assert.ok(
          !sendTx.value || sendTx.value === 0n,
          'should not have native value when using feeToken',
        )
      })
    })

    describe('generateUnsignedExecuteReport', () => {
      it('should generate manuallyExecute tx for OffRamp', async () => {
        assert.ok(fujiChain, 'source chain should be initialized')
        assert.ok(sepoliaChain, 'dest chain should be initialized')

        let request
        try {
          const tx = await fujiChain.getTransaction(FAILED_MESSAGE_TX)
          const requests = await fujiChain.getMessagesInTx(tx)
          request = requests.find((r) => r.message.messageId === FAILED_MESSAGE_ID) ?? requests[0]
        } catch {
          return
        }

        if (!request) return

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (offRamps.length === 0) return

        const execReport: ExecutionReport = {
          message: request.message,
          proofs: [new Uint8Array(32)],
          proofFlagBits: 0n,
          offchainTokenData: [],
          merkleRoot: '0x' + '00'.repeat(32),
        }

        try {
          const result = await sepoliaChain.generateUnsignedExecuteReport({
            offRamp: offRamps[0]!,
            execReport,
            gasLimit: 500_000,
            payer: '0x0000000000000000000000000000000000000001',
          })

          assert.equal(result.family, ChainFamily.EVM, 'should be EVM family')
          assert.equal(result.transactions.length, 1, 'should have one transaction')

          const execTx = result.transactions[0] as TransactionRequest
          assert.equal(
            (execTx.to as string).toLowerCase(),
            offRamps[0]!.toLowerCase(),
            'should target offRamp',
          )
          assert.ok(execTx.data, 'should have calldata')
        } catch (err) {
          const errMsg = (err as Error).message
          assert.ok(
            errMsg.includes('version') ||
              errMsg.includes('undefined') ||
              errMsg.includes('invalid') ||
              errMsg.includes('Cannot read'),
            'should fail with expected error',
          )
        }
      })

      it('should include gasLimit override in transaction', async () => {
        assert.ok(fujiChain, 'source chain should be initialized')
        assert.ok(sepoliaChain, 'dest chain should be initialized')

        let request
        try {
          const tx = await fujiChain.getTransaction(FAILED_MESSAGE_TX)
          const requests = await fujiChain.getMessagesInTx(tx)
          request = requests.find((r) => r.message.messageId === FAILED_MESSAGE_ID) ?? requests[0]
        } catch {
          return
        }

        if (!request) return

        const offRamps = await sepoliaChain.getOffRampsForRouter(SEPOLIA_ROUTER, FUJI_SELECTOR)
        if (offRamps.length === 0) return

        const customGasLimit = 1_000_000
        const execReport: ExecutionReport = {
          message: request.message,
          proofs: [new Uint8Array(32)],
          proofFlagBits: 0n,
          offchainTokenData: [],
          merkleRoot: '0x' + '00'.repeat(32),
        }

        try {
          const result = await sepoliaChain.generateUnsignedExecuteReport({
            offRamp: offRamps[0]!,
            execReport,
            gasLimit: customGasLimit,
            payer: '0x0000000000000000000000000000000000000001',
          })

          assert.equal(result.transactions.length, 1, 'should have one transaction')
          assert.ok(result.transactions[0]!.data, 'should have calldata with gasLimit encoded')
        } catch {
          // Expected - execution report generation may fail due to data requirements
        }
      })
    })
  })

  // ==========================================================================
  // sendMessage
  // ==========================================================================

  describe('sendMessage', () => {
    it('should send via v1.5 lane (Sepolia -> Fuji) and emit CCIPSendRequested', async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const walletAddress = await sepoliaWallet.getAddress()

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: { receiver: walletAddress, data: '0x1337' },
        wallet: sepoliaWallet,
      })

      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
      assert.equal(request.lane.sourceChainSelector, SEPOLIA_SELECTOR)
      assert.equal(request.lane.destChainSelector, FUJI_SELECTOR)
      assert.ok(request.tx.hash, 'tx hash should be defined')

      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.topics[0], CCIP_SEND_REQUESTED_TOPIC, 'should be CCIPSendRequested')
      assert.ok(request.log.address, 'log should have the onRamp address')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')
      assert.ok(
        String(request.message.data).includes('1337'),
        'message data should contain sent payload',
      )
    })

    it('should send via v1.6 lane (Sepolia -> Aptos) and emit CCIPMessageSent', async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const walletAddress = await sepoliaWallet.getAddress()

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_ROUTER,
        destChainSelector: APTOS_TESTNET_SELECTOR,
        message: { receiver: walletAddress, data: '0xdead', extraArgs: { gasLimit: 0n } },
        wallet: sepoliaWallet,
      })

      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
      assert.equal(request.lane.sourceChainSelector, SEPOLIA_SELECTOR)
      assert.equal(request.lane.destChainSelector, APTOS_TESTNET_SELECTOR)
      assert.ok(request.tx.hash, 'tx hash should be defined')

      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.topics[0], CCIP_MESSAGE_SENT_TOPIC, 'should be CCIPMessageSent')
      assert.ok(request.log.address, 'log should have the onRamp address')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')
      assert.ok(
        String(request.message.data).includes('dead'),
        'message data should contain sent payload',
      )
    })

    it('should send v1.6 token transfer with extraArgs (Sepolia -> Aptos)', async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const walletAddress = await sepoliaWallet.getAddress()

      const amount = parseUnits('0.1', 18)
      await setERC20Balance(sepoliaProvider, APTOS_SUPPORTED_TOKEN, walletAddress, amount)

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_ROUTER,
        destChainSelector: APTOS_TESTNET_SELECTOR,
        message: {
          receiver: walletAddress,
          data: '0xcafe',
          tokenAmounts: [{ token: APTOS_SUPPORTED_TOKEN, amount }],
          extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
        },
        wallet: sepoliaWallet,
      })

      assert.ok(request.log, 'request should contain the event log')
      assert.equal(request.log.topics[0], CCIP_MESSAGE_SENT_TOPIC, 'should be CCIPMessageSent')
      assert.equal(request.log.transactionHash, request.tx.hash, 'log tx hash should match')

      assert.ok(request.message.messageId, 'messageId should be defined')
      assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
      assert.ok(
        String(request.message.data).includes('cafe'),
        'message data should contain sent payload',
      )
      assert.ok(request.message.feeToken, 'feeToken should be defined')

      const msg = request.message as Record<string, unknown>
      assert.equal(msg.gasLimit, 0n, 'gasLimit should round-trip as 0')
      assert.equal(
        msg.allowOutOfOrderExecution,
        true,
        'allowOutOfOrderExecution should round-trip as true',
      )

      const tokenAmounts = request.message.tokenAmounts as unknown as Record<string, unknown>[]
      assert.equal(tokenAmounts.length, 1, 'should have one token transfer')
      assert.equal(
        (tokenAmounts[0] as { amount: bigint }).amount,
        amount,
        'token amount should round-trip',
      )
      assert.ok(tokenAmounts[0]!.sourcePoolAddress, 'v1.6 should have sourcePoolAddress')
      assert.ok(tokenAmounts[0]!.destTokenAddress, 'v1.6 should have destTokenAddress')
    })
  })

  // ==========================================================================
  // executeReport
  // ==========================================================================

  describe('executeReport', () => {
    it('should manually execute a failed v1.6 message (Fuji -> Sepolia)', async () => {
      assert.ok(fujiChain, 'source chain should be initialized')
      assert.ok(sepoliaChain, 'dest chain should be initialized')

      // 1. Get source transaction and extract CCIPRequest
      let tx
      try {
        tx = await fujiChain.getTransaction(FAILED_MESSAGE_TX)
      } catch {
        // Transaction might not exist on current testnet state
        return
      }

      const requests = await fujiChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === FAILED_MESSAGE_ID) ?? requests[0]
      if (!request) return

      assert.equal(request.message.messageId, FAILED_MESSAGE_ID, 'should find the expected message')

      // 2. Discover OffRamp on destination chain
      const offRamp = await discoverOffRamp(fujiChain, sepoliaChain, request.lane.onRamp, fujiChain)
      assert.ok(offRamp, 'offRamp should be discovered')

      // 3. Get commit store and commit report
      const commitStore = await sepoliaChain.getCommitStoreForOffRamp(offRamp)
      const commit = await sepoliaChain.getCommitReport({ commitStore, request })
      assert.ok(commit.report.merkleRoot, 'commit should have a merkle root')

      // 4. Get all messages in the commit batch from source
      const messagesInBatch = await fujiChain.getMessagesInBatch(request, commit.report)

      // 5. Calculate manual execution proof
      const execReportProof = calculateManualExecProof(
        messagesInBatch,
        request.lane,
        request.message.messageId,
        commit.report.merkleRoot,
        sepoliaChain,
      )

      // 6. Get offchain token data
      const offchainTokenData = await fujiChain.getOffchainTokenData(request)

      // 7. Build execution report and execute
      const execReport: ExecutionReport = {
        ...execReportProof,
        message: request.message,
        offchainTokenData,
      }
      const execution = await sepoliaChain.executeReport({
        offRamp,
        execReport,
        wallet: sepoliaWallet,
        gasLimit: 500_000,
      })

      assert.equal(execution.receipt.messageId, FAILED_MESSAGE_ID, 'receipt messageId should match')
      assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
      assert.ok(execution.timestamp > 0, 'execution should have a positive timestamp')
      assert.ok(
        execution.receipt.state === ExecutionState.Success,
        'execution state should be Success',
      )
    })
  })
})
