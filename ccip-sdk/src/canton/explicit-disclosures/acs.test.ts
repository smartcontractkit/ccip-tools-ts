import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { id as keccak256Utf8 } from 'ethers'

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
  opts?: {
    instanceId?: string
    partyOwner?: string
    owner?: string
    requiredCCVs?: string[]
    receiverFinalityConfig?: { tag: string; value: unknown }
  },
): JsGetActiveContractsResponse {
  const createArgument: Record<string, unknown> = {}
  if (opts?.instanceId) createArgument['instanceId'] = opts.instanceId
  if (opts?.partyOwner) createArgument['partyOwner'] = opts.partyOwner
  if (opts?.owner) createArgument['owner'] = opts.owner
  if (opts?.requiredCCVs) {
    createArgument['requiredCCVs'] = opts.requiredCCVs.map((unpack) => ({ unpack }))
  }
  if (opts?.receiverFinalityConfig) {
    createArgument['receiverFinalityConfig'] = opts.receiverFinalityConfig
  }
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

const EXECUTE_CCV_RAW =
  'committeeverifier-tqkny@ccvOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551'
const EXECUTE_CCV_HEX = keccak256Utf8(EXECUTE_CCV_RAW)
const OTHER_CCV_RAW =
  'other-ccv@ccvOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551'
const EXECUTOR_TEMPLATE_ID = 'pkg-executor:CCIP.Executor:Executor'
const DEFAULT_ACS: JsGetActiveContractsResponse[] = [
  makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, { partyOwner: PARTY }),
  makeAcsEntry(RECEIVER_TEMPLATE_ID, RECEIVER_CONTRACT_ID, RECEIVER_BLOB, PARTY, {
    owner: PARTY,
    receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
  }),
]

/** ACS snapshot for the default send scenario (router + sender, plus unrelated executor noise) */
const SEND_ACS: JsGetActiveContractsResponse[] = [
  makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, { partyOwner: PARTY }),
  makeAcsEntry(SENDER_TEMPLATE_ID, SENDER_CONTRACT_ID, SENDER_BLOB, PARTY),
  makeAcsEntry(EXECUTOR_TEMPLATE_ID, 'executor-cid-004', 'executor-blob', PARTY),
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

    assert.equal('executor' in disclosures, false)
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

  it('resolveReceiverForExecute prefers receivers whose requiredCCVs match configured ccvs', async () => {
    const matchingCid = 'matching-ccv-receiver-cid'
    const entries = [
      makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, {
        partyOwner: PARTY,
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, 'empty-receiver-cid', 'empty-blob', PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, 'wrong-ccv-receiver-cid', 'wrong-blob', PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
        requiredCCVs: [OTHER_CCV_RAW, OTHER_CCV_RAW],
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, matchingCid, 'matching-blob', PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
        requiredCCVs: [EXECUTE_CCV_RAW],
      }),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), {
      party: PARTY,
      ccvs: [EXECUTE_CCV_HEX],
    })
    const resolved = await provider.resolveReceiverForExecute(1)

    assert.equal(resolved?.contractId, matchingCid)
  })

  it('resolveReceiverForExecute falls back to non-empty requiredCCVs when ccvs is unset', async () => {
    const configuredCid = 'configured-receiver-cid'
    const entries = [
      makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, {
        partyOwner: PARTY,
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, 'empty-receiver-cid', 'empty-blob', PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, configuredCid, 'configured-blob', PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
        requiredCCVs: [OTHER_CCV_RAW],
      }),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), { party: PARTY })
    const resolved = await provider.resolveReceiverForExecute(1)

    assert.equal(resolved?.contractId, configuredCid)
  })

  it('resolveReceiverForExecute resolves keccak256(party) message receiver hints', async () => {
    const hashedParty = keccak256Utf8(PARTY)
    const entries = [
      makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, {
        partyOwner: PARTY,
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, RECEIVER_CONTRACT_ID, RECEIVER_BLOB, PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
        requiredCCVs: [EXECUTE_CCV_RAW],
      }),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), {
      party: PARTY,
      ccvs: [EXECUTE_CCV_HEX],
    })
    const resolved = await provider.resolveReceiverForExecute(1, hashedParty)

    assert.equal(resolved?.contractId, RECEIVER_CONTRACT_ID)
  })

  it('resolveReceiverForExecute resolves explicit contract IDs with 0x prefix', async () => {
    const longReceiverCid =
      '009d6a63b316ebffe5c495009c7dd9debf3a81cc05796f815b964e4ea09855d328ca1212205be120866d73817cef0ff776f558e0f6c3c14159567c0bc893484ad9b24375f5'
    const entries = [
      makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY, {
        partyOwner: PARTY,
      }),
      makeAcsEntry(RECEIVER_TEMPLATE_ID, longReceiverCid, RECEIVER_BLOB, PARTY, {
        owner: PARTY,
        receiverFinalityConfig: { tag: 'BlockDepth', value: 1 },
      }),
    ]

    const provider = new AcsDisclosureProvider(makeStubClient(entries), { party: PARTY })
    const resolved = await provider.resolveReceiverForExecute(1, `0x${longReceiverCid}`)

    assert.equal(resolved?.contractId, longReceiverCid)
  })
})
