import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import {
  type RateLimiterConfig,
  type RemoteChainConfig,
  ApplyChainUpdates,
} from './apply-chain-updates.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { encodeRemoteAddress } from '../apply-chain-updates-utils.ts'

const POOL = '0x1234567890AbcdEF1234567890aBcdef12345678'
const REMOTE_POOL = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'
const REMOTE_POOL_2 = '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD'
const REMOTE_TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'

/** Stub EVMChain whose `typeAndVersion` reports a fixed pool version. */
function chainFor(version: string): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: async (_addr: string) => ['LockReleaseTokenPool', version, `pool ${version}`],
  } as unknown as EVMChain
}

const disabled = { isEnabled: false, capacity: '0', rate: '0' } as const
const enabled = {
  isEnabled: true,
  capacity: '100000000000000000000000',
  rate: '167000000000000000000',
} as const

function configFor(
  selector: bigint,
  pools: string[],
  out: RateLimiterConfig = disabled,
  inb: RateLimiterConfig = disabled,
) {
  return {
    remoteChainSelector: selector,
    remotePoolAddresses: pools,
    remoteTokenAddress: REMOTE_TOKEN,
    outboundRateLimiterConfig: out,
    inboundRateLimiterConfig: inb,
  } satisfies RemoteChainConfig
}

/** Mirrors the op's new-style (uint64[] removes, ChainUpdate[] adds) arg assembly. */
function encodeAdds(configs: RemoteChainConfig[]) {
  return configs.map((c) => ({
    remoteChainSelector: c.remoteChainSelector,
    remotePoolAddresses: c.remotePoolAddresses.map((a) => encodeRemoteAddress(a)),
    remoteTokenAddress: encodeRemoteAddress(c.remoteTokenAddress),
    outboundRateLimiterConfig: {
      isEnabled: c.outboundRateLimiterConfig.isEnabled,
      capacity: BigInt(c.outboundRateLimiterConfig.capacity),
      rate: BigInt(c.outboundRateLimiterConfig.rate),
    },
    inboundRateLimiterConfig: {
      isEnabled: c.inboundRateLimiterConfig.isEnabled,
      capacity: BigInt(c.inboundRateLimiterConfig.capacity),
      rate: BigInt(c.inboundRateLimiterConfig.rate),
    },
  }))
}

describe('EVM cct applyChainUpdates', () => {
  const op = new ApplyChainUpdates()

  it('encodes a single v1.6 add — byte-identical to a direct ethers encode', async () => {
    const configs = [configFor(16015286601757825753n, [REMOTE_POOL], enabled, disabled)]
    const unsigned = await op.generate(chainFor('1.6.0'), {
      poolAddress: POOL,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: configs,
    })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('applyChainUpdates', [
      [],
      encodeAdds(configs),
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('encodes a multi-update array (multiple chains, multiple pools, plus removes)', async () => {
    const configs = [
      configFor(16015286601757825753n, [REMOTE_POOL, REMOTE_POOL_2], enabled, enabled),
      configFor(3734403246176062136n, [REMOTE_POOL_2], disabled, disabled),
    ]
    const removes = [1234567890n, 9876543210n]
    const unsigned = await op.generate(chainFor('1.6.0'), {
      poolAddress: POOL,
      remoteChainSelectorsToRemove: removes,
      chainsToAdd: configs,
    })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('applyChainUpdates', [
      removes,
      encodeAdds(configs),
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('selects the v2.0 ABI for a v2.0 pool', async () => {
    const configs = [configFor(16015286601757825753n, [REMOTE_POOL], disabled, disabled)]
    const unsigned = await op.generate(chainFor('2.0.0'), {
      poolAddress: POOL,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: configs,
    })
    const expected = new Interface(TokenPool_2_0_ABI).encodeFunctionData('applyChainUpdates', [
      [],
      encodeAdds(configs),
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('encodes a removes-only update', async () => {
    const removes = [16015286601757825753n]
    const unsigned = await op.generate(chainFor('1.6.0'), {
      poolAddress: POOL,
      remoteChainSelectorsToRemove: removes,
      chainsToAdd: [],
    })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('applyChainUpdates', [
      removes,
      [],
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(chainFor('1.6.0'), {
      poolAddress: POOL,
      remoteChainSelectorsToRemove: [],
      chainsToAdd: [configFor(16015286601757825753n, [REMOTE_POOL])],
      sender: REMOTE_TOKEN,
    })
    assert.equal(unsigned.transactions[0]!.from, REMOTE_TOKEN)
  })

  it('rejects an empty pool address before RPC', async () => {
    await assert.rejects(
      () =>
        op.generate(chainFor('1.6.0'), {
          poolAddress: '',
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [],
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects a zero remote chain selector', async () => {
    await assert.rejects(
      () =>
        op.generate(chainFor('1.6.0'), {
          poolAddress: POOL,
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [configFor(0n, [REMOTE_POOL])],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError &&
        e.context.param === 'chainsToAdd[0].remoteChainSelector',
    )
  })

  it('rejects an empty remotePoolAddresses list', async () => {
    await assert.rejects(
      () =>
        op.generate(chainFor('1.6.0'), {
          poolAddress: POOL,
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [configFor(16015286601757825753n, [])],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError &&
        e.context.param === 'chainsToAdd[0].remotePoolAddresses',
    )
  })

  it('rejects an empty remote token address', async () => {
    const bad = { ...configFor(16015286601757825753n, [REMOTE_POOL]), remoteTokenAddress: '' }
    await assert.rejects(
      () =>
        op.generate(chainFor('1.6.0'), {
          poolAddress: POOL,
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [bad],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError &&
        e.context.param === 'chainsToAdd[0].remoteTokenAddress',
    )
  })
})
