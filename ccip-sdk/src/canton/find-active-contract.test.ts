/**
 * Unit tests for {@link CantonChain.findActiveContractByInstanceAddress}:
 * instance-address matching and the duplicate-contract latest-wins rule
 * (re-registrations/redeploys leave several live contracts at one address).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hashedRawInstanceAddress } from './ccv-addresses.ts'
import { type CantonActiveContract, CantonChain } from './index.ts'

const OWNER = 'poolOwner::1220ab'
const INSTANCE_ID = 'pool-1'
const TARGET = hashedRawInstanceAddress(`${INSTANCE_ID}@${OWNER}`)
const TEMPLATE_ID = '#pkg:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'

/** An active BM pool contract for `INSTANCE_ID`, created at ledger `offset`. */
function contract(offset: number, cid = `#cid-${offset}`) {
  return {
    contractEntry: {
      JsActiveContract: {
        synchronizerId: 'sync-1',
        createdEvent: {
          offset,
          contractId: cid,
          templateId: TEMPLATE_ID,
          createdEventBlob: `blob-${offset}`,
          signatories: [OWNER],
          createArgument: { instanceId: INSTANCE_ID },
        },
      },
    },
  }
}

function chainWith(entries: unknown[]): CantonChain {
  return Object.assign(Object.create(CantonChain.prototype), {
    network: { family: 'canton' },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    activeParty: OWNER,
    ledgerApiClient: {
      getLedgerEnd: async () => ({ offset: 100 }),
      getActiveContracts: async () => entries,
    },
  }) as CantonChain
}

describe('findActiveContractByInstanceAddress', () => {
  it('resolves a single match', async () => {
    const got = await chainWith([contract(10)]).findActiveContractByInstanceAddress(
      TEMPLATE_ID,
      TARGET,
    )
    assert.ok(got)
    assert.equal(got.contractId, '#cid-10')
    assert.equal(got.createdAtOffset, 10)
  })

  it('returns null when nothing matches', async () => {
    const got = await chainWith([]).findActiveContractByInstanceAddress(TEMPLATE_ID, TARGET)
    assert.equal(got, null)
  })

  it('takes the latest-created contract among duplicates at one address', async () => {
    const got = (await chainWith([contract(10), contract(20)]).findActiveContractByInstanceAddress(
      TEMPLATE_ID,
      TARGET,
    )) as CantonActiveContract | null
    assert.ok(got)
    assert.equal(got.contractId, '#cid-20')
    assert.equal(got.createdAtOffset, 20)
  })

  it('refuses duplicates whose creation order is indeterminate', async () => {
    await assert.rejects(
      () =>
        chainWith([contract(10), contract(10)]).findActiveContractByInstanceAddress(
          TEMPLATE_ID,
          TARGET,
        ),
      /creation order is indeterminate/,
    )
  })
})
