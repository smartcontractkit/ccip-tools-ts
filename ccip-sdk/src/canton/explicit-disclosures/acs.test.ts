import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AcsDisclosureProvider } from './acs.ts'
import type { CantonClient, JsGetActiveContractsResponse } from '../client/index.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARTY = 'party1::aabbcc'
const SYNC_ID = 'synchronizer::001122'

/**
 * Build a minimal ACS response entry for a given template / contract.
 * `templateId` must use the ledger format: `<packageId>:<ModuleName>:<EntityName>`.
 */
function makeAcsEntry(
  templateId: string,
  contractId: string,
  createdEventBlob: string,
  signatory: string,
  opts?: { instanceId?: string; partyOwner?: string },
): JsGetActiveContractsResponse {
  const createArgument: Record<string, string> = {}
  if (opts?.instanceId) createArgument['instanceId'] = opts.instanceId
  if (opts?.partyOwner) createArgument['partyOwner'] = opts.partyOwner
  return {
    contractEntry: {
      JsActiveContract: {
        synchronizerId: SYNC_ID,
        createdEvent: {
          templateId,
          contractId,
          createdEventBlob,
          signatories: [signatory],
          createArgument,
          // remaining CreatedEvent fields — not used by fetchRichSnapshot
          observers: [],
          witnesses: [],
          offset: 1,
          nodeId: 0,
          packageName: '',
          interfaceViews: [],
          agreementText: '',
        },
      },
    },
  } as unknown as JsGetActiveContractsResponse
}

const ROUTER_CONTRACT_ID = 'router-cid-001'
const ROUTER_BLOB = 'router-blob'
const ROUTER_TEMPLATE_ID = 'pkg-router:CCIP.PerPartyRouter:PerPartyRouter'

const RECEIVER_CONTRACT_ID = 'receiver-cid-002'
const RECEIVER_BLOB = 'receiver-blob'
const RECEIVER_TEMPLATE_ID = 'pkg-receiver:CCIP.CCIPReceiver:CCIPReceiver'

const SENDER_CONTRACT_ID = 'sender-cid-003'
const SENDER_BLOB = 'sender-blob'
const SENDER_TEMPLATE_ID = 'pkg-sender:CCIP.CCIPSender:CCIPSender'

/** ACS snapshot for the default execute scenario (router + receiver) */
const DEFAULT_ACS: JsGetActiveContractsResponse[] = [
  makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, { partyOwner: PARTY }),
  makeAcsEntry(RECEIVER_TEMPLATE_ID, RECEIVER_CONTRACT_ID, RECEIVER_BLOB, PARTY),
]

/** ACS snapshot for the default send scenario (router + sender) */
const SEND_ACS: JsGetActiveContractsResponse[] = [
  makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, { partyOwner: PARTY }),
  makeAcsEntry(SENDER_TEMPLATE_ID, SENDER_CONTRACT_ID, SENDER_BLOB, PARTY),
]

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Build a `CantonClient` stub whose `getLedgerEnd` and `getActiveContracts`
 * return the provided fixture data.  All other methods are left unimplemented.
 */
function makeStubClient(acsEntries: JsGetActiveContractsResponse[]): CantonClient {
  return {
    getLedgerEnd: async () => ({ offset: 42 }),
    getActiveContracts: async () => acsEntries,
  } as unknown as CantonClient
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canton/acs', () => {
  it('fetchExecutionDisclosures returns PerPartyRouter and CCIPReceiver by signatory', async () => {
    const provider = new AcsDisclosureProvider(makeStubClient(DEFAULT_ACS), { party: PARTY })

    const disclosures = await provider.fetchExecutionDisclosures()

    assert.equal(disclosures.perPartyRouter.contractId, ROUTER_CONTRACT_ID)
    assert.equal(disclosures.perPartyRouter.templateId, ROUTER_TEMPLATE_ID)
    assert.equal(disclosures.perPartyRouter.createdEventBlob, ROUTER_BLOB)
    assert.equal(disclosures.perPartyRouter.synchronizerId, SYNC_ID)

    assert.equal(disclosures.ccipReceiver.contractId, RECEIVER_CONTRACT_ID)
    assert.equal(disclosures.ccipReceiver.templateId, RECEIVER_TEMPLATE_ID)
    assert.equal(disclosures.ccipReceiver.createdEventBlob, RECEIVER_BLOB)
    assert.equal(disclosures.ccipReceiver.synchronizerId, SYNC_ID)
  })

  it('fetchExecutionDisclosures resolves the receiver by contract ID when receiverCid is provided', async () => {
    // An extra "other" contract with the same template — ensures lookup is by ID, not signatory
    const OTHER_CID = 'other-receiver-cid-999'
    const OTHER_BLOB = 'other-receiver-blob'
    const entries = [
      ...DEFAULT_ACS,
      makeAcsEntry(RECEIVER_TEMPLATE_ID, OTHER_CID, OTHER_BLOB, 'other-party::ff', {}),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), { party: PARTY })

    const disclosures = await provider.fetchExecutionDisclosures(OTHER_CID)

    // Router still resolved by signatory
    assert.equal(disclosures.perPartyRouter.contractId, ROUTER_CONTRACT_ID)

    // Receiver resolved by explicit contract ID, not by signatory match
    assert.equal(disclosures.ccipReceiver.contractId, OTHER_CID)
    assert.equal(disclosures.ccipReceiver.createdEventBlob, OTHER_BLOB)
    assert.equal(disclosures.ccipReceiver.synchronizerId, SYNC_ID)
  })

  it('fetchExecutionDisclosures throws when no matching PerPartyRouter is found', async () => {
    const entries = [
      makeAcsEntry(RECEIVER_TEMPLATE_ID, RECEIVER_CONTRACT_ID, RECEIVER_BLOB, PARTY, {}),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), { party: PARTY })

    await assert.rejects(
      () => provider.fetchExecutionDisclosures(),
      /PerPartyRouter/,
      'should throw mentioning PerPartyRouter',
    )
  })

  it('fetchExecutionDisclosures throws when receiverCid does not match any active contract', async () => {
    const provider = new AcsDisclosureProvider(makeStubClient(DEFAULT_ACS), { party: PARTY })

    await assert.rejects(
      () => provider.fetchExecutionDisclosures('nonexistent-cid'),
      /nonexistent-cid/,
      'should throw mentioning the missing contract ID',
    )
  })

  // -------------------------------------------------------------------------
  // fetchSendDisclosures
  // -------------------------------------------------------------------------

  it('fetchSendDisclosures returns PerPartyRouter and CCIPSender', async () => {
    const provider = new AcsDisclosureProvider(makeStubClient(SEND_ACS), { party: PARTY })

    const disclosures = await provider.fetchSendDisclosures()

    assert.equal(disclosures.perPartyRouter.contractId, ROUTER_CONTRACT_ID)
    assert.equal(disclosures.perPartyRouter.templateId, ROUTER_TEMPLATE_ID)
    assert.equal(disclosures.perPartyRouter.createdEventBlob, ROUTER_BLOB)
    assert.equal(disclosures.perPartyRouter.synchronizerId, SYNC_ID)

    assert.equal(disclosures.ccipSender.contractId, SENDER_CONTRACT_ID)
    assert.equal(disclosures.ccipSender.templateId, SENDER_TEMPLATE_ID)
    assert.equal(disclosures.ccipSender.createdEventBlob, SENDER_BLOB)
    assert.equal(disclosures.ccipSender.synchronizerId, SYNC_ID)
  })

  it('fetchSendDisclosures throws when no matching CCIPSender is found', async () => {
    // Only router in the ACS — no sender contract
    const entries = [
      makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, {
        partyOwner: PARTY,
      }),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), { party: PARTY })

    await assert.rejects(
      () => provider.fetchSendDisclosures(),
      /CCIPSender/,
      'should throw mentioning CCIPSender',
    )
  })

  it('fetchSendDisclosures throws when no matching PerPartyRouter is found', async () => {
    // Only sender in the ACS — no router contract
    const entries = [makeAcsEntry(SENDER_TEMPLATE_ID, SENDER_CONTRACT_ID, SENDER_BLOB, PARTY, {})]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), { party: PARTY })

    await assert.rejects(
      () => provider.fetchSendDisclosures(),
      /PerPartyRouter/,
      'should throw mentioning PerPartyRouter',
    )
  })
})
