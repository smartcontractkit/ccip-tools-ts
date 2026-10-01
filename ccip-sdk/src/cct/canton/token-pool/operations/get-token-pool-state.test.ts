/**
 * Unit tests for the Canton CCT `getTokenPoolState` read operation.
 *
 * ACS-backed {@link CantonChain} mock (see `acs.test.helpers.ts`) serving
 * hand-crafted gRPC-JSON `BurnMintTokenPool` / `LockReleaseTokenPool`
 * `createArgument`s, so the real InstanceAddress resolution runs (one query over
 * both pool templates, pool type read off the match) alongside the scalar
 * decoders (poolOwner/instanceId/decimals/rateLimitAdmin/instrumentId) and the
 * defensive `remoteChainConfigs` Daml-`Map` decoder — no live participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import type { CantonActiveContract } from '../../../../canton/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type AcsContract, acsChain, requestedTemplateIds } from '../../acs.test.helpers.ts'
import { CantonTokenManager } from '../../index.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID } from '../shared.ts'

const POOL_OWNER = `poolOwner::1220${'c3'.repeat(32)}`
const RATE_LIMIT_ADMIN = `rladmin::1220${'d4'.repeat(32)}`
const INSTRUMENT_ADMIN = `adminA::1220${'a1'.repeat(32)}`
const LEDGER_PARTY = `ledger::1220${'e5'.repeat(32)}`
const POOL_CID = '#pool-1'
const POOL_INSTANCE_ID = 'pool-instance-1'
/** The pool's raw instance address — its owner suffix is the reading party. */
const POOL_RAW_ADDRESS = `${POOL_INSTANCE_ID}@${POOL_OWNER}`
/** The same pool's hashed instance address (`0x`-prefixed keccak256 of the raw form). */
const POOL_HASHED_ADDRESS = '0x' + hashedRawInstanceAddress(POOL_RAW_ADDRESS)

const sum = (ctor: string, value: unknown) => ({ Sum: { [ctor]: value } })
const text = (s: string) => sum('Text', s)
const party = (s: string) => sum('Party', s)
const int = (n: number | string) => sum('Int64', String(n))
const field = (label: string, value: unknown) => ({ label, value })
const some = (value: unknown) => ({ Some: value })
const none = () => ({ None: {} })

/** A `RemoteChainConfig` record value (bare `{ fields }` form). */
function remoteChainConfig(opts: {
  remotePools: string[]
  remoteTokenAddress: string
}): Record<string, unknown> {
  return {
    fields: [
      field(
        'remotePools',
        opts.remotePools.map((s) => sum('Text', s)),
      ),
      field('remoteTokenAddress', text(opts.remoteTokenAddress)),
      field('inboundCCVs', []),
      field('outboundCCVs', []),
      field('finalityConfig', { WaitForFinality: {} }),
      field('inboundRateLimiter', text('')),
      field('inboundCustomBlockConfirmationsRateLimiter', text('')),
      field('outboundRateLimiter', text('')),
    ],
  }
}

/** A `remoteChainConfigs` Daml `Map (Numeric 0) RemoteChainConfig` as gRPC GenMap JSON. */
function remoteChainConfigsMap(
  entries: Array<{ selector: string; cfg: Record<string, unknown> }>,
): Record<string, unknown> {
  // The decoder looks for a `map*` key holding an array of `{ key, value }`.
  return {
    mapTextInt64: entries.map((e) => ({ key: sum('Numeric', e.selector), value: e.cfg })),
  }
}

function poolContract(
  opts: {
    templateId?: string
    contractId?: string
    rateLimitAdmin?: string
    /** Raw `rateLimitAdmin` field value, overriding the gRPC `Some`/`None` form. */
    rateLimitAdminValue?: unknown
    remoteChainConfigs?: Record<string, unknown>
    observers?: string[]
  } = {},
): AcsContract {
  return {
    contractId: opts.contractId ?? POOL_CID,
    templateId: opts.templateId ?? BURN_MINT_POOL_TEMPLATE_ID,
    createdEventBlob: 'pool-blob',
    synchronizerId: 'canton::global',
    signatories: [POOL_OWNER],
    observers: opts.observers,
    createArgument: {
      fields: [
        field('instanceId', text(POOL_INSTANCE_ID)),
        field('poolOwner', party(POOL_OWNER)),
        field('ccipOwner', party(POOL_OWNER)),
        field('instrumentId', {
          fields: [field('admin', party(INSTRUMENT_ADMIN)), field('id', text('usdc'))],
        }),
        field('decimals', int(6)),
        field(
          'rateLimitAdmin',
          'rateLimitAdminValue' in opts
            ? opts.rateLimitAdminValue
            : opts.rateLimitAdmin
              ? some(party(opts.rateLimitAdmin))
              : none(),
        ),
        field('remoteChainConfigs', opts.remoteChainConfigs ?? remoteChainConfigsMap([])),
        field(
          'observers',
          (opts.observers ?? []).map((p) => party(p)),
        ),
      ],
    },
  }
}

function managerWith(...contracts: CantonActiveContract[]) {
  const { chain, requests } = acsChain(contracts, { ledgerParty: LEDGER_PARTY })
  return { manager: CantonTokenManager.fromChain(chain), requests }
}

describe('CantonTokenManager.getTokenPoolState (mocked chain)', () => {
  it('decodes pool scalars: type, owner, instanceId, decimals, instrumentId', async () => {
    const { manager } = managerWith(poolContract())

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.equal(result.poolType, 'burnMint')
    assert.equal(result.poolOwner, POOL_OWNER)
    assert.equal(result.poolInstanceId, POOL_INSTANCE_ID)
    assert.equal(result.decimals, 6)
    assert.deepEqual(result.instrumentId, { admin: INSTRUMENT_ADMIN, id: 'usdc' })
    assert.equal(result.rateLimitAdmin, undefined)
    assert.deepEqual(result.remoteChainConfigs, [])
    assert.deepEqual(result.observers, [])
  })

  it('decodes observers (mandatory EDS auto-detection field)', async () => {
    const { manager } = managerWith(
      poolContract({ observers: [RATE_LIMIT_ADMIN, INSTRUMENT_ADMIN] }),
    )

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.deepEqual(result.observers, [RATE_LIMIT_ADMIN, INSTRUMENT_ADMIN])
  })

  it('decodes the rate-limit admin when set (Optional Party)', async () => {
    const { manager } = managerWith(poolContract({ rateLimitAdmin: RATE_LIMIT_ADMIN }))

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.equal(result.rateLimitAdmin, RATE_LIMIT_ADMIN)
  })

  // The JSON Ledger API spells `Some party` as the bare party string and `None` as `null`.
  for (const [label, value, expected] of [
    ['a bare-string Some', RATE_LIMIT_ADMIN, RATE_LIMIT_ADMIN],
    ['a null None', null, undefined],
  ] as const) {
    it(`decodes the rate-limit admin from the JSON Ledger API form (${label})`, async () => {
      const { manager } = managerWith(poolContract({ rateLimitAdminValue: value }))

      const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

      assert.equal(result.rateLimitAdmin, expected)
    })
  }

  it('decodes remoteChainConfigs Daml Map entries', async () => {
    const { manager } = managerWith(
      poolContract({
        remoteChainConfigs: remoteChainConfigsMap([
          {
            selector: '5009297550715157269',
            cfg: remoteChainConfig({
              remotePools: ['0xpool-evm-1'],
              remoteTokenAddress: '0xtoken-evm-1',
            }),
          },
          {
            selector: '16015286601757825753',
            cfg: remoteChainConfig({
              remotePools: ['0xpool-evm-2', '0xpool-evm-2b'],
              remoteTokenAddress: '0xtoken-evm-2',
            }),
          },
        ]),
      }),
    )

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.equal(result.remoteChainConfigs.length, 2)
    assert.deepEqual(result.remoteChainConfigs[0], {
      remoteChainSelector: '5009297550715157269',
      remotePools: ['0xpool-evm-1'],
      remoteTokenAddress: '0xtoken-evm-1',
      inboundCCVs: [],
      outboundCCVs: [],
      inboundRateLimiter: '',
      inboundCustomBlockConfirmationsRateLimiter: '',
      outboundRateLimiter: '',
    })
    assert.deepEqual(result.remoteChainConfigs[1], {
      remoteChainSelector: '16015286601757825753',
      remotePools: ['0xpool-evm-2', '0xpool-evm-2b'],
      remoteTokenAddress: '0xtoken-evm-2',
      inboundCCVs: [],
      outboundCCVs: [],
      inboundRateLimiter: '',
      inboundCustomBlockConfirmationsRateLimiter: '',
      outboundRateLimiter: '',
    })
  })

  it('decodes remoteChainConfigs in natural JSON (array of [key, value] pairs, Numeric key with trailing dot)', async () => {
    // The Canton JSON Ledger API (and the gateway `ledgerApi` proxy) serializes
    // a Daml `Map (Numeric 0) X` as a bare array of [key, value] pairs, with the
    // `Numeric 0` key carrying a trailing `.` — the live shape confirmed by
    // scripts/dump-pool-state.ts against CV1.
    const naturalMap = [
      [
        '16015286601757825753.',
        remoteChainConfig({
          remotePools: ['0x0000000000000000000000000000000000000001'],
          remoteTokenAddress: '0x0000000000000000000000000000000000000001',
        }),
      ],
    ]
    const { manager } = managerWith(
      poolContract({ remoteChainConfigs: naturalMap as unknown as Record<string, unknown> }),
    )

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.equal(result.remoteChainConfigs.length, 1)
    assert.deepEqual(result.remoteChainConfigs[0], {
      // Trailing `.` stripped from the Numeric key.
      remoteChainSelector: '16015286601757825753',
      remotePools: ['0x0000000000000000000000000000000000000001'],
      remoteTokenAddress: '0x0000000000000000000000000000000000000001',
      // New fields (CCVs + limiter references) decode empty when absent.
      inboundCCVs: [],
      outboundCCVs: [],
      inboundRateLimiter: '',
      inboundCustomBlockConfirmationsRateLimiter: '',
      outboundRateLimiter: '',
    })
  })

  it('throws when the pool is not active/visible', async () => {
    const { manager } = managerWith()
    await assert.rejects(
      manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS }),
      /not active or not visible/,
    )
  })
})

describe('CantonTokenManager.getTokenPoolState pool resolution', () => {
  it('queries both pool templates in a single ACS request, as the raw address owner', async () => {
    const { manager, requests } = managerWith(poolContract())

    await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.equal(requests.length, 1)
    assert.deepEqual(Object.keys(requests[0]!.eventFormat.filtersByParty), [POOL_OWNER])
    assert.deepEqual(requestedTemplateIds(requests[0]!).sort(), [
      BURN_MINT_POOL_TEMPLATE_ID,
      LOCK_RELEASE_POOL_TEMPLATE_ID,
    ])
  })

  it('reads the pool type off the matched template (concrete package-ID form)', async () => {
    const { manager } = managerWith(
      poolContract({
        templateId: 'cafebabe:CCIP.Registry.LockReleaseTokenPoolV2:LockReleaseTokenPool',
      }),
    )

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS })

    assert.equal(result.poolType, 'lockRelease')
  })

  it('resolves the hashed 0x form, reading as the chain ledger party', async () => {
    const { manager, requests } = managerWith(poolContract({ observers: [LEDGER_PARTY] }))

    const result = await manager.getTokenPoolState({ poolInstanceAddress: POOL_HASHED_ADDRESS })

    assert.equal(result.poolInstanceId, POOL_INSTANCE_ID)
    assert.deepEqual(Object.keys(requests[0]!.eventFormat.filtersByParty), [LEDGER_PARTY])
  })

  it('resolves the hashed form with or without 0x, in any case', async () => {
    for (const address of [
      POOL_HASHED_ADDRESS.slice(2),
      POOL_HASHED_ADDRESS.toUpperCase().replace('0X', '0x'),
    ]) {
      const { manager } = managerWith(poolContract())
      const result = await manager.getTokenPoolState({
        poolInstanceAddress: address,
        poolOwner: POOL_OWNER,
      })
      assert.equal(result.poolInstanceId, POOL_INSTANCE_ID)
    }
  })

  it('reads as an explicit poolOwner over the raw address owner', async () => {
    const { manager, requests } = managerWith(poolContract({ observers: [RATE_LIMIT_ADMIN] }))

    await manager.getTokenPoolState({
      poolInstanceAddress: POOL_RAW_ADDRESS,
      poolOwner: RATE_LIMIT_ADMIN,
    })

    assert.deepEqual(Object.keys(requests[0]!.eventFormat.filtersByParty), [RATE_LIMIT_ADMIN])
  })

  it('throws when the instance address matches both a burn-mint and a lock-release pool', async () => {
    const { manager } = managerWith(
      poolContract(),
      poolContract({ templateId: LOCK_RELEASE_POOL_TEMPLATE_ID, contractId: '#pool-2' }),
    )

    await assert.rejects(
      manager.getTokenPoolState({ poolInstanceAddress: POOL_RAW_ADDRESS }),
      /multiple active contracts match/,
    )
  })

  it('rejects a malformed raw address before any ledger call', async () => {
    const { manager, requests } = managerWith(poolContract())

    await assert.rejects(
      manager.getTokenPoolState({ poolInstanceAddress: `${POOL_INSTANCE_ID}@not-a-party` }),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.equal(err.context.param, 'poolInstanceAddress')
        return true
      },
    )
    assert.equal(requests.length, 0)
  })
})
