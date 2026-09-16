/**
 * Unit tests for the Canton CCT `getRateLimiterState` read operation.
 *
 * Mocked {@link CantonChain} whose `findActiveContractByInstanceAddress` returns a
 * hand-crafted gRPC-JSON `RateLimiter` `createArgument`, exercising the scalar
 * decoders (capacity/rate/tokens/isEnabled) and the `RateLimitDirection`/
 * `RateLimitMode` enum decoders (both natural bare-string and gRPC `{ Enum }`
 * encodings) without a live participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CantonTokenManager } from '../../index.ts'
import { RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'

const POOL_OWNER = 'poolOwner::1220c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'
const OBSERVER = 'observer::1220d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'
const RL_CID = '#rl-1'
const RL_INSTANCE_ID = 'pool-1-rl-in-16015286601757825753'
const RL_INSTANCE_ADDRESS = '0x' + 'ab'.repeat(32)

const sum = (ctor: string, value: unknown) => ({ Sum: { [ctor]: value } })
const text = (s: string) => sum('Text', s)
const party = (s: string) => sum('Party', s)
const bool = (b: boolean) => sum('Bool', b)
const numeric = (n: string) => sum('Numeric', n)
const timestamp = (t: string) => sum('Int64', t)
const field = (label: string, value: unknown) => ({ label, value })

function rateLimiterContract(
  opts: {
    direction?: unknown
    mode?: unknown
    isEnabled?: boolean
    capacity?: string
    rate?: string
    tokens?: string
    observers?: string[]
  } = {},
): CantonActiveContract {
  return {
    contractId: RL_CID,
    templateId: RATE_LIMITER_TEMPLATE_ID,
    createdEventBlob: 'rl-blob',
    synchronizerId: 'canton::global',
    signatories: [POOL_OWNER],
    createArgument: {
      fields: [
        field('instanceId', text(RL_INSTANCE_ID)),
        field('poolInstanceId', text('pool-1')),
        field('poolOwner', party(POOL_OWNER)),
        field('remoteChainSelector', numeric('16015286601757825753.')),
        field('direction', opts.direction ?? 'RateLimitDirection_Inbound'),
        field('mode', opts.mode ?? 'RateLimitMode_DefaultFinality'),
        field('isEnabled', bool(opts.isEnabled ?? true)),
        field('capacity', numeric(opts.capacity ?? '1000000.')),
        field('rate', numeric(opts.rate ?? '100.')),
        field('tokens', numeric(opts.tokens ?? '1000000.')),
        field('lastUpdated', timestamp('1788293442440838')),
        field(
          'observers',
          (opts.observers ?? [OBSERVER]).map((p) => party(p)),
        ),
      ],
    },
  }
}

function chainWith(contract: CantonActiveContract | null): CantonChain {
  return {
    network: { family: ChainFamily.Canton },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    async findActiveContractByInstanceAddress(
      _t: string,
      instanceAddress: string,
    ): Promise<CantonActiveContract | null> {
      return contract && instanceAddress === RL_INSTANCE_ADDRESS ? contract : null
    },
  } as unknown as CantonChain
}

describe('CantonTokenManager.getRateLimiterState (mocked chain)', () => {
  it('decodes scalars: instanceId, poolInstanceId, poolOwner, remoteChainSelector, capacity/rate/tokens', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(rateLimiterContract()))

    const result = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS,
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.instanceId, RL_INSTANCE_ID)
    assert.equal(result.poolInstanceId, 'pool-1')
    assert.equal(result.poolOwner, POOL_OWNER)
    assert.equal(result.remoteChainSelector, '16015286601757825753')
    assert.equal(result.capacity, '1000000')
    assert.equal(result.rate, '100')
    assert.equal(result.tokens, '1000000')
    assert.equal(result.isEnabled, true)
    assert.deepEqual(result.observers, [OBSERVER])
  })

  it('decodes RateLimitDirection_Outbound and RateLimitMode_CustomFinality (bare-string enums)', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(
        rateLimiterContract({
          direction: 'RateLimitDirection_Outbound',
          mode: 'RateLimitMode_CustomFinality',
        }),
      ),
    )

    const result = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS,
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.direction, 'outbound')
    assert.equal(result.mode, 'customFinality')
  })

  it('decodes enums from the gRPC { Enum: { constructor } } envelope', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(
        rateLimiterContract({
          direction: { Enum: { constructor: 'RateLimitDirection_Outbound' } },
          mode: { Enum: { constructor: 'RateLimitMode_CustomFinality' } },
        }),
      ),
    )

    const result = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS,
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.direction, 'outbound')
    assert.equal(result.mode, 'customFinality')
  })

  it('decodes isEnabled: false', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(rateLimiterContract({ isEnabled: false })),
    )

    const result = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS,
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.isEnabled, false)
  })

  it('throws when the rate limiter is not active/visible', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(null))

    await assert.rejects(() =>
      manager.getRateLimiterState({
        rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS,
        poolOwner: POOL_OWNER,
      }),
    )
  })
})
