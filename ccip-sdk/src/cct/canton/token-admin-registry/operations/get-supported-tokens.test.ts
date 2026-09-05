/**
 * Unit tests for the Canton CCT `getSupportedTokens` read operation.
 *
 * Mirrors the Solana/EVM read-test pattern: a mocked {@link CantonChain} whose
 * `findActiveContractsByTemplate` returns hand-crafted gRPC-JSON
 * `createArgument` records, so the Daml decode path
 * (`decodeDamlRecord` / `extractRecordField` / `extractFieldValue`) is exercised
 * against realistic payload shapes without a live participant.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ChainFamily } from '../../../../networks.ts'
import type { CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { CantonTokenManager } from '../../index.ts'
import { TOKEN_CONFIG_TEMPLATE_ID } from '../shared.ts'

const PARTY = 'participant::1220' + 'c250'.repeat(16)
const ADMIN_A = 'adminA::1220' + 'a1'.repeat(32)
const ADMIN_B = 'adminB::1220' + 'b2'.repeat(32)

/** Build a gRPC-style Daml field value: `{ Sum: { <ctor>: value } }`. */
function sum(ctor: string, value: unknown): Record<string, unknown> {
  return { Sum: { [ctor]: value } }
}

/** A `Text`/`Party` field value. */
const text = (s: string) => sum('Text', s)
const party = (s: string) => sum('Party', s)

/** A Daml record field: `{ label, value }`. */
function field(label: string, value: unknown): Record<string, unknown> {
  return { label, value }
}

/**
 * A `TokenConfig` `createArgument` carrying `instrumentId: { admin, id }` plus a
 * few other fields the decoder should ignore gracefully.
 */
function tokenConfigCreateArgument(admin: string, id: string): Record<string, unknown> {
  return {
    fields: [
      field('instanceId', text(`${admin}::${id}`)),
      field('registryInstanceId', text('registry-instance')),
      field('registryOwner', party(PARTY)),
      field('index', { Sum: { Int64: '0' } }),
      field('isCCIPManaged', { Sum: { Bool: true } }),
      field(
        'instrumentId',
        // nested record: { fields: [{admin}, {id}] }  (bare form, no Sum envelope)
        { fields: [field('admin', party(admin)), field('id', text(id))] },
      ),
      field('admin', { Some: party(admin) }),
      field('pendingAdmin', { None: {} }),
      field('tokenPool', { None: {} }),
    ],
  }
}

/** A fake active `TokenConfig` contract. */
function tokenConfigContract(admin: string, id: string, contractId: string): CantonActiveContract {
  return {
    contractId,
    templateId: TOKEN_CONFIG_TEMPLATE_ID,
    createdEventBlob: 'blob-' + id,
    synchronizerId: 'canton::global',
    signatories: [admin],
    createArgument: tokenConfigCreateArgument(admin, id),
  }
}

/**
 * Mocked `CantonChain`: `findActiveContractsByTemplate` returns the supplied
 * contracts (the read op applies its own predicate, but for `getSupportedTokens`
 * the default `() => true` accepts all). Only the surface the read touches is
 * implemented.
 */
function chainWith(contracts: CantonActiveContract[]): CantonChain {
  return {
    network: { family: ChainFamily.Canton },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    async findActiveContractsByTemplate(
      _templateId: string,
      _parties: string[],
      _match?: (a: unknown) => boolean,
    ): Promise<CantonActiveContract[]> {
      return contracts
    },
  } as unknown as CantonChain
}

describe('CantonTokenManager.getSupportedTokens (mocked chain)', () => {
  it('decodes each TokenConfig into an instrumentId { admin, id }', async () => {
    const manager = CantonTokenManager.fromChain(
      chainWith([
        tokenConfigContract(ADMIN_A, 'usdc', '#cfg-usdc'),
        tokenConfigContract(ADMIN_B, 'link', '#cfg-link'),
      ]),
    )

    const result = await manager.getSupportedTokens({ party: PARTY, page: { limit: 100 } })

    assert.equal(result.tokens.length, 2)
    assert.deepEqual(result.tokens[0], { admin: ADMIN_A, id: 'usdc' })
    assert.deepEqual(result.tokens[1], { admin: ADMIN_B, id: 'link' })
    assert.equal(result.hasMore, false)
    assert.equal(result.nextOffset, undefined)
  })

  it('paginates client-side via offset/limit', async () => {
    const contracts = [
      tokenConfigContract(ADMIN_A, 't0', '#c0'),
      tokenConfigContract(ADMIN_A, 't1', '#c1'),
      tokenConfigContract(ADMIN_A, 't2', '#c2'),
      tokenConfigContract(ADMIN_A, 't3', '#c3'),
    ]
    const manager = CantonTokenManager.fromChain(chainWith(contracts))

    const page1 = await manager.getSupportedTokens({ party: PARTY, page: { offset: 0, limit: 2 } })
    assert.equal(page1.tokens.length, 2)
    assert.deepEqual(page1.tokens.map((t) => t.id), ['t0', 't1'])
    assert.equal(page1.hasMore, true)
    assert.equal(page1.nextOffset, 2)

    const page2 = await manager.getSupportedTokens({ party: PARTY, page: { offset: 2, limit: 2 } })
    assert.equal(page2.tokens.length, 2)
    assert.deepEqual(page2.tokens.map((t) => t.id), ['t2', 't3'])
    assert.equal(page2.hasMore, false)
  })

  it('returns an empty page when no TokenConfig contracts are visible', async () => {
    const manager = CantonTokenManager.fromChain(chainWith([]))
    const result = await manager.getSupportedTokens({ party: PARTY })
    assert.deepEqual(result.tokens, [])
    assert.equal(result.hasMore, false)
  })

  it('skips TokenConfig entries whose instrumentId fails to decode', async () => {
    const broken: CantonActiveContract = {
      contractId: '#cfg-broken',
      templateId: TOKEN_CONFIG_TEMPLATE_ID,
      createdEventBlob: 'blob',
      synchronizerId: 'canton::global',
      signatories: [ADMIN_A],
      createArgument: { fields: [field('instrumentId', { None: {} })] }, // not a record
    }
    const manager = CantonTokenManager.fromChain(
      chainWith([tokenConfigContract(ADMIN_A, 'usdc', '#cfg-usdc'), broken]),
    )
    const result = await manager.getSupportedTokens({ party: PARTY })
    assert.equal(result.tokens.length, 1)
    assert.deepEqual(result.tokens[0], { admin: ADMIN_A, id: 'usdc' })
  })
})
