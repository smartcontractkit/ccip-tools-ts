/**
 * Unit tests for the Canton CCT `getTokenAdminRegistry` read operation.
 *
 * ACS-backed {@link CantonChain} mock (see `acs.test.helpers.ts`) serving a
 * hand-crafted gRPC-JSON `TokenConfig` `createArgument` record at the address
 * derived from the instrument ID + CCIP owner, exercising that derivation and
 * the `Optional Party` / `Bool` / `Optional PoolRegistration` decoders without a
 * live participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CantonChain } from '../../../../canton/index.ts'
import { CANTON_NETWORKS } from '../../../../canton/networks.ts'
import { ChainFamily } from '../../../../networks.ts'
import { hashedUtf8Hex } from '../../../../shared/codec.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type AcsContract, acsChain } from '../../acs.test.helpers.ts'
import { CantonTokenManager } from '../../index.ts'
import { TOKEN_CONFIG_TEMPLATE_ID, deriveTokenConfigInstanceAddress } from '../shared.ts'

/** The TestNet CCIP owner — the TokenConfig's signatory, and the default `ccipOwner` there. */
const CCIP_OWNER = CANTON_NETWORKS['canton:TestNet']!.ccipOwner
const OTHER_CCIP_OWNER = `ccipOwner::1220${'0f'.repeat(32)}`
const ADMIN = `adminA::1220${'a1'.repeat(32)}`
const PENDING = `pendingB::1220${'b2'.repeat(32)}`
const POOL_OWNER = `poolOwner::1220${'c3'.repeat(32)}`
const INSTRUMENT_ID = { admin: ADMIN, id: 'usdc' }
/** On-ledger TokenConfig instance ID: `keccak256(utf8("<id>@<admin>"))`. */
const TOKEN_CONFIG_INSTANCE_ID = hashedUtf8Hex(`usdc@${ADMIN}`)

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
      field('instanceId', text(TOKEN_CONFIG_INSTANCE_ID)),
      field('registryOwner', party(CCIP_OWNER)),
      field('isCCIPManaged', { Sum: { Bool: opts.isCCIPManaged ?? true } }),
      field('instrumentId', { fields: [field('admin', party(ADMIN)), field('id', text('usdc'))] }),
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

/** A TokenConfig signed by `signatory` (default: the TestNet CCIP owner), visible to the admin. */
function contract(
  arg: Record<string, unknown>,
  contractId = '#cfg-usdc',
  signatory = CCIP_OWNER,
): AcsContract {
  return {
    contractId,
    templateId: TOKEN_CONFIG_TEMPLATE_ID,
    createdEventBlob: 'blob',
    synchronizerId: 'canton::global',
    signatories: [signatory],
    observers: [ADMIN],
    createArgument: arg,
  }
}

/** ACS-backed chain on `canton:TestNet` (overridable) holding `contract`. */
function chainWith(
  contract: AcsContract | null,
  overrides: Record<string, unknown> = {},
): CantonChain {
  return acsChain(contract ? [contract] : [], { ccipParty: OTHER_CCIP_OWNER, ...overrides }).chain
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
      instrumentId: INSTRUMENT_ID,
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
      instanceId: TOKEN_CONFIG_INSTANCE_ID,
      registryInstanceId: 'tar-inst',
      registryOwner: CCIP_OWNER,
      index: 0,
      isCCIPManaged: false,
      instrumentId: { admin: ADMIN, id: 'usdc' },
      admin: null,
      pendingAdmin: PENDING,
      tokenPool: { poolOwner: POOL_OWNER, poolInstanceId: 'pool-inst-1' },
    }
    const manager = CantonTokenManager.fromChain(chainWith(contract(naturalArg)))

    const result = await manager.getTokenAdminRegistry({
      instrumentId: INSTRUMENT_ID,
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
      instrumentId: INSTRUMENT_ID,
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
      instrumentId: INSTRUMENT_ID,
      adminParty: ADMIN,
    })
    assert.equal(result.tokenConfigCid, '')
    assert.equal(result.isCCIPManaged, false)
  })
})

describe('CantonTokenManager.getTokenAdminRegistry TokenConfig address derivation', () => {
  const arg = tokenConfigArg({ admin: ADMIN })

  it("derives the address from the instrument and the network's well-known CCIP owner", async () => {
    const manager = CantonTokenManager.fromChain(chainWith(contract(arg)))

    const result = await manager.getTokenAdminRegistry({
      instrumentId: INSTRUMENT_ID,
      adminParty: ADMIN,
    })

    assert.equal(result.tokenConfigCid, '#cfg-usdc')
    assert.equal(result.tokenConfigInstanceAddress, `${TOKEN_CONFIG_INSTANCE_ID}@${CCIP_OWNER}`)
    assert.equal(
      result.tokenConfigInstanceAddress,
      deriveTokenConfigInstanceAddress(INSTRUMENT_ID, CCIP_OWNER),
    )
  })

  it('accepts the instrument ID string form', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(contract(arg)))

    const result = await manager.getTokenAdminRegistry({
      instrumentId: `${ADMIN}::usdc`,
      adminParty: ADMIN,
    })

    assert.equal(result.tokenConfigCid, '#cfg-usdc')
  })

  it("falls back to the chain's ccipParty on a network with no registered deployment", async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(contract(arg, '#cfg-local', OTHER_CCIP_OWNER), {
        network: { family: ChainFamily.Canton, chainId: 'canton:LocalNet' },
      }),
    )

    const result = await manager.getTokenAdminRegistry({
      instrumentId: INSTRUMENT_ID,
      adminParty: ADMIN,
    })

    assert.equal(result.tokenConfigCid, '#cfg-local')
    assert.equal(
      result.tokenConfigInstanceAddress,
      `${TOKEN_CONFIG_INSTANCE_ID}@${OTHER_CCIP_OWNER}`,
    )
  })

  it('uses an explicit ccipOwner over the network default', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith(contract(arg, '#cfg-other', OTHER_CCIP_OWNER)),
    )

    const byDefault = await manager.getTokenAdminRegistry({
      instrumentId: INSTRUMENT_ID,
      adminParty: ADMIN,
    })
    const explicit = await manager.getTokenAdminRegistry({
      instrumentId: INSTRUMENT_ID,
      adminParty: ADMIN,
      ccipOwner: OTHER_CCIP_OWNER,
    })

    assert.equal(byDefault.tokenConfigCid, '')
    assert.equal(explicit.tokenConfigCid, '#cfg-other')
  })

  it('rejects an invalid instrument ID or party before any ledger call', async () => {
    const manager = CantonTokenManager.fromChain(chainWith(contract(arg)))
    for (const [params, param] of [
      [{ instrumentId: 'usdc', adminParty: ADMIN }, 'instrumentId'],
      [{ instrumentId: INSTRUMENT_ID, adminParty: 'admin' }, 'adminParty'],
      [{ instrumentId: INSTRUMENT_ID, adminParty: ADMIN, ccipOwner: 'owner' }, 'ccipOwner'],
    ] as const) {
      await assert.rejects(manager.getTokenAdminRegistry(params), (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.equal(err.context.param, param)
        return true
      })
    }
  })
})
