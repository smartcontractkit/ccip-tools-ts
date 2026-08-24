/**
 * Unit tests for the Canton CCT `getTokenAdminRegistry` read operation.
 *
 * Mocked {@link CantonChain} whose `findActiveContractByInstanceAddress`
 * returns a hand-crafted gRPC-JSON `TokenConfig` `createArgument` record,
 * exercising the `Optional Party` / `Bool` / `Optional PoolRegistration` decoders
 * without a live participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ChainFamily } from '../../../../networks.ts'
import type { CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { CantonTokenManager } from '../../index.ts'
import { TOKEN_CONFIG_TEMPLATE_ID } from '../shared.ts'

const PARTY = 'participant::1220c250c250c250c250c250c250c250c250c250c250c250c250c250c250c250c'
const ADMIN = 'adminA::1220a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
const PENDING = 'pendingB::1220b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
const POOL_OWNER = 'poolOwner::1220c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'
const TOKEN_CONFIG_INSTANCE_ADDRESS = '0x' + 'ef'.repeat(32)

const sum = (ctor: string, value: unknown) => ({ Sum: { [ctor]: value } })
const text = (s: string) => sum('Text', s)
const party = (s: string) => sum('Party', s)
const field = (label: string, value: unknown) => ({ label, value })
const some = (value: unknown) => ({ Some: value })
const none = () => ({ None: {} })

/** Build a `TokenConfig` createArgument with configurable admin/pendingAdmin/tokenPool/isCCIPManaged. */
function tokenConfigArg(opts: {
  admin?: string
  pendingAdmin?: string
  tokenPool?: { poolOwner: string; poolInstanceId: string }
  isCCIPManaged?: boolean
}): Record<string, unknown> {
  return {
    fields: [
      field('instanceId', text(`${ADMIN}::usdc`)),
      field('registryOwner', party(PARTY)),
      field('isCCIPManaged', { Sum: { Bool: opts.isCCIPManaged ?? true } }),
      field(
        'instrumentId',
        { fields: [field('admin', party(ADMIN)), field('id', text('usdc'))] },
      ),
      field('admin', opts.admin ? some(party(opts.admin)) : none()),
      field('pendingAdmin', opts.pendingAdmin ? some(party(opts.pendingAdmin)) : none()),
      field(
        'tokenPool',
        opts.tokenPool
          ? some({
              fields: [
                field('poolOwner', party(opts.tokenPool.poolOwner)),
                field('poolInstanceId', text(opts.tokenPool.poolInstanceId)),
              ],
            })
          : none(),
      ),
    ],
  }
}

function contract(arg: Record<string, unknown>, contractId = '#cfg-usdc'): CantonActiveContract {
  return {
    contractId,
    templateId: TOKEN_CONFIG_TEMPLATE_ID,
    createdEventBlob: 'blob',
    synchronizerId: 'canton::global',
    signatories: [ADMIN],
    createArgument: arg,
  }
}

/** Mocked chain: returns `contract` when the instance address matches. */
function chainWith(contract: CantonActiveContract | null): CantonChain {
  return {
    network: { family: ChainFamily.Canton },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    async findActiveContractByInstanceAddress(
      _t: string,
      instanceAddress: string,
    ): Promise<CantonActiveContract | null> {
      return contract && instanceAddress === TOKEN_CONFIG_INSTANCE_ADDRESS ? contract : null
    },
  } as unknown as CantonChain
}

describe('CantonTokenManager.getTokenAdminRegistry (mocked chain)', () => {
  it('decodes admin, pendingAdmin, tokenPool, isCCIPManaged, and the CID', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(
        contract(
          tokenConfigArg({
            admin: ADMIN,
            pendingAdmin: PENDING,
            tokenPool: { poolOwner: POOL_OWNER, poolInstanceId: 'pool-inst-1' },
            isCCIPManaged: false,
          }),
        ),
      ),
    )

    const result = await manager.getTokenAdminRegistry({
      tokenConfigInstanceAddress: TOKEN_CONFIG_INSTANCE_ADDRESS,
      adminParty: ADMIN,
    })

    assert.equal(result.tokenConfigCid, '#cfg-usdc')
    assert.equal(result.admin, ADMIN)
    assert.equal(result.pendingAdmin, PENDING)
    assert.equal(result.isCCIPManaged, false)
    assert.deepEqual(result.tokenPool, { poolOwner: POOL_OWNER, poolInstanceId: 'pool-inst-1' })
  })

  it('decodes natural-JSON (bare string Optional, bare object tokenPool) from the JSON Ledger API', async () => {
    // The Canton JSON Ledger API (and the gateway `ledgerApi` proxy) serializes
    // a TokenConfig with natural JSON: Optional Party is a bare string (Some) or
    // null (None), not the gRPC { Some: { Sum: { Party } } } form; tokenPool is a
    // bare object, not { Some: { fields: [...] } }. Confirmed against CV1 via
    // scripts/dump-token-config.ts.
    const naturalArg = {
      instanceId: `${ADMIN}::usdc`,
      registryInstanceId: 'tar-inst',
      registryOwner: PARTY,
      index: 0,
      isCCIPManaged: false,
      instrumentId: { admin: ADMIN, id: 'usdc' },
      admin: null,
      pendingAdmin: PENDING,
      tokenPool: { poolOwner: POOL_OWNER, poolInstanceId: 'pool-inst-1' },
    }
    const manager = CantonTokenManager.fromChain(chainWith(contract(naturalArg)))

    const result = await manager.getTokenAdminRegistry({
      tokenConfigInstanceAddress: TOKEN_CONFIG_INSTANCE_ADDRESS,
      adminParty: ADMIN,
    })

    assert.equal(result.tokenConfigCid, '#cfg-usdc')
    assert.equal(result.admin, undefined)
    assert.equal(result.pendingAdmin, PENDING)
    assert.equal(result.isCCIPManaged, false)
    assert.deepEqual(result.tokenPool, { poolOwner: POOL_OWNER, poolInstanceId: 'pool-inst-1' })
  })

  it('returns undefined admin/pendingAdmin/tokenPool when they are None', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(contract(tokenConfigArg({ isCCIPManaged: true }))),
    )

    const result = await manager.getTokenAdminRegistry({
      tokenConfigInstanceAddress: TOKEN_CONFIG_INSTANCE_ADDRESS,
      adminParty: ADMIN,
    })

    assert.equal(result.admin, undefined)
    assert.equal(result.pendingAdmin, undefined)
    assert.equal(result.tokenPool, undefined)
    assert.equal(result.isCCIPManaged, true)
  })

  it('returns an empty result when no TokenConfig matches the instance address', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(null))
    const result = await manager.getTokenAdminRegistry({
      tokenConfigInstanceAddress: TOKEN_CONFIG_INSTANCE_ADDRESS,
      adminParty: ADMIN,
    })
    assert.equal(result.tokenConfigCid, '')
    assert.equal(result.isCCIPManaged, false)
  })
})
