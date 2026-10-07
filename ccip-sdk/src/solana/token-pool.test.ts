import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import {
  decodeTokenPoolChainConfig,
  decodeTokenPoolChainConfigOverride,
  decodeTokenPoolStateConfig,
} from './token-pool.ts'

const key = (byte: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
const u8 = (n: number) => Buffer.from([n])
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(n)
  return b
}
const bytes = (b: Buffer) => Buffer.concat([u32(b.length), b])
const bucket = (enabled: boolean, capacity: bigint, rate: bigint) =>
  Buffer.concat([u64(capacity), u64(1n), u8(enabled ? 1 : 0), u64(capacity), u64(rate)])
const account = (name: string, ...fields: Buffer[]) =>
  Buffer.concat([BorshAccountsCoder.accountDiscriminator(name), ...fields])

// `BaseConfig` of a 2.0 pool, including the fields after `router`
function stateData(mint: PublicKey, router: PublicKey): Buffer {
  return account(
    'State',
    u8(1),
    key(10).toBuffer(), // token_program
    mint.toBuffer(),
    u8(9), // decimals
    ...[11, 12, 13, 14, 15, 16].map((b) => key(b).toBuffer()),
    router.toBuffer(),
    key(17).toBuffer(), // rebalancer
    u8(1), // can_accept_liquidity
    u8(1), // list_enabled
    u32(2),
    key(18).toBuffer(),
    key(19).toBuffer(), // allow_list
    key(20).toBuffer(), // rmn_remote
  )
}

const remoteToken = Buffer.alloc(32, 0xaa)
const remotePool = Buffer.alloc(32, 0xbb)
const baseChain = Buffer.concat([
  u32(1),
  bytes(remotePool), // pool_addresses
  bytes(remoteToken), // token_address
  u8(18), // decimals
  bucket(true, 100n, 1n), // inbound
  bucket(false, 0n, 0n), // outbound
])

describe('decodeTokenPoolStateConfig', () => {
  it('decodes the mint and router of a pool State', () => {
    const config = decodeTokenPoolStateConfig(stateData(key(1), key(2)))
    assert.ok(config.mint.equals(key(1)))
    assert.ok(config.router.equals(key(2)))
    assert.equal(config.decimals, 9)
  })

  it('rejects non-State accounts', () => {
    assert.throws(() => decodeTokenPoolStateConfig(account('ChainConfig', baseChain)))
  })
})

describe('decodeTokenPoolChainConfig', () => {
  const assertBaseChain = (base: ReturnType<typeof decodeTokenPoolChainConfig>) => {
    assert.deepEqual(Buffer.from(base.remote.tokenAddress.address), remoteToken)
    assert.deepEqual(
      base.remote.poolAddresses.map(({ address }) => Buffer.from(address)),
      [remotePool],
    )
    assert.equal(base.remote.decimals, 18)
    assert.equal(base.inboundRateLimit.cfg.enabled, true)
    assert.equal(base.inboundRateLimit.cfg.capacity.toString(), '100')
    assert.equal(base.outboundRateLimit.cfg.enabled, false)
  }

  it('decodes burn-mint and lock-release pools', () => {
    const data = account('ChainConfig', baseChain)
    assertBaseChain(decodeTokenPoolChainConfig(data, 'burnmint-token-pool'))
    assertBaseChain(decodeTokenPoolChainConfig(data, 'lockrelease-token-pool'))
  })

  it('decodes the versioned layout of CCTP and Lombard pools', () => {
    const cctp = account('ChainConfig', u8(1), baseChain, u32(6), key(3).toBuffer())
    assertBaseChain(decodeTokenPoolChainConfig(cctp, 'cctp-token-pool'))
    const lombard = account('ChainConfig', u8(1), baseChain, Buffer.alloc(64, 1))
    assertBaseChain(decodeTokenPoolChainConfig(lombard, 'lombard-token-pool'))
  })

  it('tries each layout for pools of unknown type', () => {
    for (const poolType of [undefined, 'custom-token-pool']) {
      assertBaseChain(decodeTokenPoolChainConfig(account('ChainConfig', baseChain), poolType))
      assertBaseChain(
        decodeTokenPoolChainConfig(account('ChainConfig', u8(1), baseChain), poolType),
      )
    }
  })

  it('only decodes the layout of canonical pool types', () => {
    assert.throws(() =>
      decodeTokenPoolChainConfig(account('ChainConfig', u8(1), baseChain), 'burnmint-token-pool'),
    )
  })

  it('rejects non-ChainConfig accounts', () => {
    assert.throws(() => decodeTokenPoolChainConfig(account('State', baseChain)))
  })
})

describe('decodeTokenPoolChainConfigOverride', () => {
  it('decodes an FTF override', () => {
    const override = decodeTokenPoolChainConfigOverride(
      account(
        'ChainConfigOverride',
        u8(254), // bump
        u8(1), // version
        u64(16015286601757825753n),
        key(1).toBuffer(),
        bucket(true, 50n, 2n),
        bucket(true, 70n, 3n),
        u8(0), // FTF
      ),
    )
    assert.equal(override.remoteChainSelector.toString(), '16015286601757825753')
    assert.ok(override.mint.equals(key(1)))
    assert.equal(override.inboundRateLimit.cfg.capacity.toString(), '50')
    assert.equal(override.outboundRateLimit.cfg.rate.toString(), '3')
    assert.deepEqual(override.overrideType, { ftf: {} })
  })
})
