import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import {
  type ChainRateLimiterConfig,
  SetChainRateLimiterConfig,
} from './set-chain-rate-limiter-config.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const SELECTOR = 16015286601757825753n

const CONFIG: ChainRateLimiterConfig = {
  remoteChainSelector: SELECTOR,
  outboundRateLimiterConfig: {
    isEnabled: true,
    capacity: '100000000000000000000000',
    rate: '167000000000000000000',
  },
  inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
}

/** Chain stub whose `typeAndVersion` reports a chosen pool version. */
function stubChain(version: string): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(['LockReleaseTokenPool', version, `pool ${version}`]),
  } as unknown as EVMChain
}

const bucket = (c: ChainRateLimiterConfig['outboundRateLimiterConfig']) => ({
  isEnabled: c.isEnabled,
  capacity: BigInt(c.capacity),
  rate: BigInt(c.rate),
})

describe('EVM cct setChainRateLimiterConfig', () => {
  const op = new SetChainRateLimiterConfig()

  it('v1.6 branch — one setChainRateLimiterConfig tx per chain, byte-identical', async () => {
    const cfgB: ChainRateLimiterConfig = { ...CONFIG, remoteChainSelector: 12345n }
    const unsigned = await op.generate(stubChain('1.6.1'), {
      poolAddress: POOL,
      chainConfigs: [CONFIG, cfgB],
    })
    const iface = new Interface(TokenPool_1_6_ABI)
    const expectedA = iface.encodeFunctionData('setChainRateLimiterConfig', [
      CONFIG.remoteChainSelector,
      bucket(CONFIG.outboundRateLimiterConfig),
      bucket(CONFIG.inboundRateLimiterConfig),
    ])
    const expectedB = iface.encodeFunctionData('setChainRateLimiterConfig', [
      cfgB.remoteChainSelector,
      bucket(cfgB.outboundRateLimiterConfig),
      bucket(cfgB.inboundRateLimiterConfig),
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 2)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expectedA)
    assert.equal(unsigned.transactions[1]!.data, expectedB)
  })

  it('v2.0 branch — single batched setRateLimitConfig tx, byte-identical', async () => {
    const unsigned = await op.generate(stubChain('2.0.0'), {
      poolAddress: POOL,
      chainConfigs: [{ ...CONFIG, customBlockConfirmations: true }],
    })
    const iface = new Interface(TokenPool_2_0_ABI)
    const expected = iface.encodeFunctionData('setRateLimitConfig', [
      [
        {
          remoteChainSelector: SELECTOR,
          customBlockConfirmations: true,
          outboundRateLimiterConfig: bucket(CONFIG.outboundRateLimiterConfig),
          inboundRateLimiterConfig: bucket(CONFIG.inboundRateLimiterConfig),
        },
      ],
    ])
    assert.equal(unsigned.transactions.length, 1)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('v2.0 branch defaults customBlockConfirmations to false', async () => {
    const unsigned = await op.generate(stubChain('2.0.0'), {
      poolAddress: POOL,
      chainConfigs: [CONFIG],
    })
    const iface = new Interface(TokenPool_2_0_ABI)
    const expected = iface.encodeFunctionData('setRateLimitConfig', [
      [
        {
          remoteChainSelector: SELECTOR,
          customBlockConfirmations: false,
          outboundRateLimiterConfig: bucket(CONFIG.outboundRateLimiterConfig),
          inboundRateLimiterConfig: bucket(CONFIG.inboundRateLimiterConfig),
        },
      ],
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(stubChain('2.0.0'), {
      poolAddress: POOL,
      chainConfigs: [CONFIG],
      sender: POOL,
    })
    assert.equal(unsigned.transactions[0]!.from, POOL)
  })

  it('rejects an invalid pool address before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain('2.0.0'), { poolAddress: 'nope', chainConfigs: [CONFIG] }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects an empty chainConfigs list', async () => {
    await assert.rejects(
      () => op.generate(stubChain('2.0.0'), { poolAddress: POOL, chainConfigs: [] }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'chainConfigs',
    )
  })

  it('rejects a zero remoteChainSelector', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain('2.0.0'), {
          poolAddress: POOL,
          chainConfigs: [{ ...CONFIG, remoteChainSelector: 0n }],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError &&
        e.context.param === 'chainConfigs[0].remoteChainSelector',
    )
  })

  it('rejects a non-integer capacity string', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain('2.0.0'), {
          poolAddress: POOL,
          chainConfigs: [
            { ...CONFIG, outboundRateLimiterConfig: { isEnabled: true, capacity: 'x', rate: '0' } },
          ],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError &&
        e.context.param === 'chainConfigs[0].outboundRateLimiterConfig.capacity',
    )
  })
})
