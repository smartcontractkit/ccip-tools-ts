/**
 * Unit tests for the Canton CCT `getRateLimiterState` read operation.
 *
 * ACS-backed {@link CantonChain} mock (see `acs.test.helpers.ts`) serving a
 * hand-crafted gRPC-JSON `RateLimiter` `createArgument`, exercising the reading
 * party resolution, the scalar decoders (capacity/rate/tokens/isEnabled) and the
 * `RateLimitDirection`/`RateLimitMode` enum decoders (both natural bare-string
 * and gRPC `{ Enum }` encodings) without a live participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import { type AcsContract, acsChain } from '../../acs.test.helpers.ts'
import { CantonTokenManager } from '../../index.ts'
import { RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'

const POOL_OWNER = `poolOwner::1220${'c3'.repeat(32)}`
const OBSERVER = `observer::1220${'d4'.repeat(32)}`
const LEDGER_PARTY = `ledger::1220${'e5'.repeat(32)}`
const RL_CID = '#rl-1'
const RL_INSTANCE_ID = 'pool-1-rl-in-16015286601757825753'
/** The limiter's raw instance address — its owner suffix is the reading party. */
const RL_INSTANCE_ADDRESS = `${RL_INSTANCE_ID}@${POOL_OWNER}`
/** The same limiter's hashed instance address. */
const RL_HASHED_ADDRESS = '0x' + hashedRawInstanceAddress(RL_INSTANCE_ADDRESS)

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
): AcsContract {
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

function chainWith(contract: AcsContract | null): CantonChain {
  return acsChain(contract ? [contract] : [], { ledgerParty: LEDGER_PARTY }).chain
}

/** Parties the chain's (single) ACS request read as. */
function readParties(
  contract: AcsContract,
  params: Parameters<CantonTokenManager['getRateLimiterState']>[0],
) {
  const { chain, requests } = acsChain([contract], { ledgerParty: LEDGER_PARTY })
  return CantonTokenManager.fromChain(chain)
    .getRateLimiterState(params)
    .then(() => Object.keys(requests[0]!.eventFormat.filtersByParty))
}

describe('CantonTokenManager.getRateLimiterState (mocked chain)', () => {
  it('decodes scalars: instanceId, poolInstanceId, poolOwner, remoteChainSelector, capacity/rate/tokens', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(rateLimiterContract()))

    const result = await manager.getRateLimiterState({
      rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS,
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
    })

    assert.equal(result.isEnabled, false)
  })

  it('throws when the rate limiter is not active/visible', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(null))

    await assert.rejects(() =>
      manager.getRateLimiterState({ rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS }),
    )
  })
})

describe('CantonTokenManager.getRateLimiterState reading party', () => {
  it('reads as the owner suffix of a raw address', async () => {
    assert.deepEqual(
      await readParties(rateLimiterContract(), { rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS }),
      [POOL_OWNER],
    )
  })

  it('reads a hashed address as the chain ledger party', async () => {
    assert.deepEqual(
      await readParties(
        { ...rateLimiterContract(), observers: [LEDGER_PARTY] },
        { rateLimiterInstanceAddress: RL_HASHED_ADDRESS },
      ),
      [LEDGER_PARTY],
    )
  })

  it('reads as an explicit poolOwner over either default', async () => {
    assert.deepEqual(
      await readParties(
        { ...rateLimiterContract(), observers: [OBSERVER] },
        { rateLimiterInstanceAddress: RL_INSTANCE_ADDRESS, poolOwner: OBSERVER },
      ),
      [OBSERVER],
    )
  })

  it('names the party it read as when the limiter is not visible', async () => {
    await assert.rejects(
      CantonTokenManager.fromChain(chainWith(rateLimiterContract())).getRateLimiterState({
        rateLimiterInstanceAddress: RL_HASHED_ADDRESS,
      }),
      new RegExp(`not active or not visible to ${LEDGER_PARTY}`),
    )
  })
})
