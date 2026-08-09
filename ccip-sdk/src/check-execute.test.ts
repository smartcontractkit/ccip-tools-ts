/**
 * Base `Chain.checkExecute` — the generic (non-EVM-override) destination preflight.
 *
 * Focus: the amount reaching the rate-limit bucket and the LockRelease balance must be
 * DEST-denominated. `extraData` declares what `amount` is denominated in.
 */
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import { AbiCoder, getAddress, hexlify, randomBytes } from 'ethers'

import { Chain } from './chain.ts'
import { CCIPInsufficientBalanceError, CCIPRateLimitExceededError } from './errors/index.ts'
import { ChainFamily, NetworkType } from './networks.ts'

const abi = AbiCoder.defaultAbiCoder()
const SOURCE_SELECTOR = 16015286601757825753n // sepolia
const DEST_SELECTOR = 16423721717087811551n // solana-devnet
const OFFRAMP = getAddress(hexlify(randomBytes(20)))
const POOL = getAddress(hexlify(randomBytes(20)))
const TOKEN = getAddress(hexlify(randomBytes(20)))

/** A minimal dest chain exercising the base method — no family override in the way. */
function makeChain(opts: {
  destDecimals?: number
  poolTypeAndVersion?: string
  balance?: bigint
  inboundRateLimiterState?: { tokens: bigint; capacity: bigint; rate: bigint }
}) {
  const getTokenInfo = mock.fn(async () => ({
    decimals: opts.destDecimals ?? 9,
    symbol: 'CCIP-BnM',
    name: 'CCIP-BnM',
  }))
  const chain = Object.create(Chain.prototype) as Chain
  Object.assign(chain, {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: {
      name: 'solana-devnet',
      chainId: 'devnet',
      chainSelector: DEST_SELECTOR,
      family: ChainFamily.Solana,
      networkType: NetworkType.Testnet,
    },
    getTokenAdminRegistryFor: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
    getRegistryTokenConfig: mock.fn(async () => ({ tokenPool: POOL })),
    getTokenPoolConfig: mock.fn(async () => ({
      typeAndVersion: opts.poolTypeAndVersion ?? 'BurnMintTokenPool 1.6.0',
      lockBox: undefined,
    })),
    getTokenPoolRemote: mock.fn(async () => ({
      remoteToken: TOKEN,
      remotePools: [],
      inboundRateLimiterState: opts.inboundRateLimiterState,
      outboundRateLimiterState: undefined,
    })),
    getBalance: mock.fn(async () => opts.balance ?? 10n ** 24n),
    getTokenInfo,
  })
  return { chain, getTokenInfo }
}

const check = (chain: Chain, tokenAmounts: { amount: bigint; extraData?: string }[]) =>
  chain.checkExecute({
    offRamp: OFFRAMP,
    message: {
      sourceChainSelector: SOURCE_SELECTOR,
      tokenAmounts: tokenAmounts.map((ta) => ({ token: TOKEN, ...ta })),
    },
  })

/** A full bucket of 100,000 CCIP-BnM at 9 decimals — the live sepolia→solana-devnet numbers. */
const FULL_BUCKET = { tokens: 10n ** 14n, capacity: 10n ** 14n, rate: 167000000000n }

describe('Chain.checkExecute — amount denomination', () => {
  beforeEach(() => mock.restoreAll())
  after(() => mock.restoreAll())

  it('18→9: a source-denominated amount is converted before hitting the bucket', async () => {
    // 0.001 CCIP-BnM sent from an 18-decimals chain = 1e15 source units, 1e6 dest units.
    // Comparing 1e15 against a full 1e14 bucket false-blocked every realistic transfer.
    const { chain } = makeChain({ inboundRateLimiterState: FULL_BUCKET })
    assert.equal(
      await check(chain, [{ amount: 10n ** 15n, extraData: abi.encode(['uint256'], [18n]) }]),
      true,
    )
  })

  it('18→9: an amount genuinely over the bucket still throws, reporting dest units', async () => {
    const { chain } = makeChain({
      inboundRateLimiterState: { tokens: 10n ** 5n, capacity: 10n ** 14n, rate: 1n },
    })
    await assert.rejects(
      () => check(chain, [{ amount: 10n ** 15n, extraData: abi.encode(['uint256'], [18n]) }]),
      (err: CCIPRateLimitExceededError) => {
        assert.ok(err instanceof CCIPRateLimitExceededError)
        assert.equal(err.context['amount'], 10n ** 6n) // dest-denominated, not 1e15
        return true
      },
    )
  })

  it('9→18: the silent false-PASS direction now blocks', async () => {
    // 1 token from a 9-decimals source is 1e9 there and 1e18 here; against a 1e17 bucket the
    // unconverted comparison passed, then execution hit the limit on-chain.
    const { chain } = makeChain({
      destDecimals: 18,
      inboundRateLimiterState: { tokens: 10n ** 17n, capacity: 10n ** 18n, rate: 1n },
    })
    await assert.rejects(
      () => check(chain, [{ amount: 10n ** 9n, extraData: abi.encode(['uint256'], [9n]) }]),
      CCIPRateLimitExceededError,
    )
  })

  it('no extraData => amount is already dest-denominated, compared as-is', async () => {
    const { chain, getTokenInfo } = makeChain({
      inboundRateLimiterState: { tokens: 10n ** 5n, capacity: 10n ** 14n, rate: 1n },
    })
    await assert.rejects(() => check(chain, [{ amount: 10n ** 6n }]), CCIPRateLimitExceededError)
    assert.equal(getTokenInfo.mock.callCount(), 0) // no decimals read when nothing is declared
  })

  it('extraData that declares no decimals => identity, no throw', async () => {
    // a short CCTP-style payload; the USDC hybrid pool's abi.encode(LOCK_RELEASE_FLAG), which IS
    // 32 bytes but decodes far outside the decimals range; and a plain out-of-range word
    for (const extraData of [
      '0xfa7c07de',
      abi.encode(['bytes4'], ['0xfa7c07de']),
      abi.encode(['uint256'], [999n]),
    ]) {
      const { chain } = makeChain({ inboundRateLimiterState: FULL_BUCKET })
      assert.equal(await check(chain, [{ amount: 10n ** 6n, extraData }]), true)
    }
  })

  it('LockRelease liquidity is compared in dest units too', async () => {
    const { chain } = makeChain({
      poolTypeAndVersion: 'LockReleaseTokenPool 1.5.1',
      balance: 10n ** 14n, // 100,000 CCIP-BnM at 9 decimals — plenty for 0.001
    })
    assert.equal(
      await check(chain, [{ amount: 10n ** 15n, extraData: abi.encode(['uint256'], [18n]) }]),
      true,
    )
  })

  it('LockRelease genuinely short of liquidity still throws, reporting dest units', async () => {
    const { chain } = makeChain({
      poolTypeAndVersion: 'LockReleaseTokenPool 1.5.1',
      balance: 10n ** 5n,
    })
    await assert.rejects(
      () => check(chain, [{ amount: 10n ** 15n, extraData: abi.encode(['uint256'], [18n]) }]),
      (err: CCIPInsufficientBalanceError) => {
        assert.ok(err instanceof CCIPInsufficientBalanceError)
        assert.match(err.message, /1000000\b/) // 1e6 dest units, not 1e15
        return true
      },
    )
  })
})
