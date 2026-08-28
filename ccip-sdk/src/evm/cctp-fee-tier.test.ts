import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, randomBytes } from 'ethers'

import { ChainFamily, NetworkType } from '../networks.ts'
import { CCIPVersion } from '../types.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

// Regression test: `finality !== 0` breaks on the string form of finality ('finalized'
// defaults to Fast instead of Standard), because 'finalized' !== 0 is trivially true.
// encodeFinality(finality) !== 0 normalizes both the string and number forms before the
// comparison, matching the mapping already used for on-the-wire encoding.
const onRampIface = interfaces.OnRamp_v2_0
const GET_POOL_SEL = onRampIface.getFunction('getPoolBySourceToken')!.selector

const DEST_SELECTOR = 10344971235874465080n // base-sepolia

// Two-tier fixture mirroring Circle's CCTP fee schedule: Fast charges 1 bp, Standard is free.
const TWO_TIER_BURN_FEES = [
  { finalityThreshold: 1000, minimumFee: 1 },
  { finalityThreshold: 2000, minimumFee: 0 },
]

function makeChain(poolAddress: string) {
  const provider = {
    call: mock.fn(async (tx: { data?: string }) => {
      const data = tx.data ?? '0x'
      const sel = data.slice(0, 10)
      if (sel === GET_POOL_SEL)
        return onRampIface.encodeFunctionResult('getPoolBySourceToken', [poolAddress])
      throw new Error(`unexpected call, selector=${sel}`)
    }),
  }

  const chain = Object.create(EVMChain.prototype) as EVMChain
  Object.assign(chain, {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: {
      name: 'base-sepolia',
      chainId: 84532,
      chainSelector: DEST_SELECTOR,
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    },
    getOnRampForRouter: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
    typeAndVersion: mock.fn(async () => [
      'OnRamp',
      CCIPVersion.V2_0,
      'OnRamp 2.0.0',
    ]) as unknown as EVMChain['typeAndVersion'],
    getFee: mock.fn(async () => 1_000_000_000_000n),
    getTokenPoolConfig: mock.fn(async () => ({ tokenTransferFeeConfig: {} })),
    detectUsdcDomains: mock.fn(async () => ({ sourceDomain: 0, destDomain: 1 })),
  })
  return chain
}

describe('getTotalFeesEstimate CCTP fast/standard tier selection', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = mock.fn(
      async () => new Response(JSON.stringify(TWO_TIER_BURN_FEES), { status: 200 }),
    )
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("finality: 'finalized' (string, the default) selects the free Standard tier", async () => {
    const chain = makeChain(getAddress(hexlify(randomBytes(20))))
    const estimate = await chain.getTotalFeesEstimate({
      router: getAddress(hexlify(randomBytes(20))),
      destChainSelector: DEST_SELECTOR,
      message: {
        receiver: getAddress(hexlify(randomBytes(20))),
        tokenAmounts: [{ token: getAddress(hexlify(randomBytes(20))), amount: 1_000_000n }],
        extraArgs: { finality: 'finalized' },
      },
    })
    assert.equal(estimate.tokenTransferFee, undefined)
  })

  it('finality: 0 (number, same meaning) selects the free Standard tier', async () => {
    const chain = makeChain(getAddress(hexlify(randomBytes(20))))
    const estimate = await chain.getTotalFeesEstimate({
      router: getAddress(hexlify(randomBytes(20))),
      destChainSelector: DEST_SELECTOR,
      message: {
        receiver: getAddress(hexlify(randomBytes(20))),
        tokenAmounts: [{ token: getAddress(hexlify(randomBytes(20))), amount: 1_000_000n }],
        extraArgs: { finality: 0 },
      },
    })
    assert.equal(estimate.tokenTransferFee, undefined)
  })

  it("finality: 'safe' selects the Fast tier and quotes its fee", async () => {
    const chain = makeChain(getAddress(hexlify(randomBytes(20))))
    const estimate = await chain.getTotalFeesEstimate({
      router: getAddress(hexlify(randomBytes(20))),
      destChainSelector: DEST_SELECTOR,
      message: {
        receiver: getAddress(hexlify(randomBytes(20))),
        tokenAmounts: [{ token: getAddress(hexlify(randomBytes(20))), amount: 1_000_000n }],
        extraArgs: { finality: 'safe' },
      },
    })
    assert.equal(estimate.tokenTransferFee?.bps, 1)
  })
})
