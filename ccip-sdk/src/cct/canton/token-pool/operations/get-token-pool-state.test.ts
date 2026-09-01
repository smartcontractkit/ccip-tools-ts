/**
 * Unit tests for the Canton CCT `getTokenPoolState` read operation.
 *
 * Mocked {@link CantonChain} whose `findActiveContractByInstanceAddress` returns a
 * hand-crafted gRPC-JSON `BurnMintTokenPool` `createArgument`, exercising the
 * scalar decoders (poolOwner/instanceId/decimals/rateLimitAdmin/instrumentId)
 * and the defensive `remoteChainConfigs` Daml-`Map` decoder without a live
 * participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ChainFamily } from '../../../../networks.ts'
import type { CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { CantonTokenManager } from '../../index.ts'
import { BURN_MINT_POOL_TEMPLATE_ID } from '../shared.ts'

const POOL_OWNER = 'poolOwner::1220c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'
const RATE_LIMIT_ADMIN = 'rladmin::1220d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'
const INSTRUMENT_ADMIN = 'adminA::1220a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
const POOL_CID = '#pool-1'
const POOL_INSTANCE_ID = 'pool-instance-1'
const POOL_INSTANCE_ADDRESS = '0x' + 'cd'.repeat(32)

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
    rateLimitAdmin?: string
    remoteChainConfigs?: Record<string, unknown>
    observers?: string[]
  } = {},
): CantonActiveContract {
  return {
    contractId: POOL_CID,
    templateId: BURN_MINT_POOL_TEMPLATE_ID,
    createdEventBlob: 'pool-blob',
    synchronizerId: 'canton::global',
    signatories: [POOL_OWNER],
    createArgument: {
      fields: [
        field('instanceId', text(POOL_INSTANCE_ID)),
        field('poolOwner', party(POOL_OWNER)),
        field('ccipOwner', party(POOL_OWNER)),
        field('instrumentId', {
          fields: [field('admin', party(INSTRUMENT_ADMIN)), field('id', text('usdc'))],
        }),
        field('decimals', int(6)),
        field('rateLimitAdmin', opts.rateLimitAdmin ? some(party(opts.rateLimitAdmin)) : none()),
        field('remoteChainConfigs', opts.remoteChainConfigs ?? remoteChainConfigsMap([])),
        field(
          'observers',
          (opts.observers ?? []).map((p) => party(p)),
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
      return contract && instanceAddress === POOL_INSTANCE_ADDRESS ? contract : null
    },
  } as unknown as CantonChain
}

describe('CantonTokenManager.getTokenPoolState (mocked chain)', () => {
  it('decodes pool scalars: owner, instanceId, decimals, instrumentId', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(poolContract()))

    const result = await manager.getTokenPoolState({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.poolOwner, POOL_OWNER)
    assert.equal(result.poolInstanceId, POOL_INSTANCE_ID)
    assert.equal(result.decimals, 6)
    assert.deepEqual(result.instrumentId, { admin: INSTRUMENT_ADMIN, id: 'usdc' })
    assert.equal(result.rateLimitAdmin, undefined)
    assert.deepEqual(result.remoteChainConfigs, [])
    assert.deepEqual(result.observers, [])
  })

  it('decodes observers (mandatory EDS auto-detection field)', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(poolContract({ observers: [RATE_LIMIT_ADMIN, INSTRUMENT_ADMIN] })),
    )

    const result = await manager.getTokenPoolState({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      poolOwner: POOL_OWNER,
    })

    assert.deepEqual(result.observers, [RATE_LIMIT_ADMIN, INSTRUMENT_ADMIN])
  })

  it('decodes the rate-limit admin when set (Optional Party)', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(poolContract({ rateLimitAdmin: RATE_LIMIT_ADMIN })),
    )

    const result = await manager.getTokenPoolState({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.rateLimitAdmin, RATE_LIMIT_ADMIN)
  })

  it('decodes remoteChainConfigs Daml Map entries', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(
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
      ),
    )

    const result = await manager.getTokenPoolState({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.remoteChainConfigs.length, 2)
    assert.deepEqual(result.remoteChainConfigs[0], {
      remoteChainSelector: '5009297550715157269',
      remotePools: ['0xpool-evm-1'],
      remoteTokenAddress: '0xtoken-evm-1',
    })
    assert.deepEqual(result.remoteChainConfigs[1], {
      remoteChainSelector: '16015286601757825753',
      remotePools: ['0xpool-evm-2', '0xpool-evm-2b'],
      remoteTokenAddress: '0xtoken-evm-2',
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
    const manager = CantonTokenManager.fromChain(
      chainWith(
        poolContract({ remoteChainConfigs: naturalMap as unknown as Record<string, unknown> }),
      ),
    )

    const result = await manager.getTokenPoolState({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      poolOwner: POOL_OWNER,
    })

    assert.equal(result.remoteChainConfigs.length, 1)
    assert.deepEqual(result.remoteChainConfigs[0], {
      // Trailing `.` stripped from the Numeric key.
      remoteChainSelector: '16015286601757825753',
      remotePools: ['0x0000000000000000000000000000000000000001'],
      remoteTokenAddress: '0x0000000000000000000000000000000000000001',
    })
  })

  it('throws when the pool is not active/visible', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(null))
    await assert.rejects(
      manager.getTokenPoolState({
        poolInstanceAddress: POOL_INSTANCE_ADDRESS,
        poolType: 'burnMint',
        poolOwner: POOL_OWNER,
      }),
      /not active or not visible/,
    )
  })
})
