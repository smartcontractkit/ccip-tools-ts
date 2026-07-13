import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import '../index.ts'
import { CCIPAPIClient } from '../api/index.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../networks.ts'
import type { CantonClient, JsGetActiveContractsResponse } from './client/index.ts'
import { AcsDisclosureProvider } from './explicit-disclosures/acs.ts'
import type { EdsDisclosureProvider } from './explicit-disclosures/eds.ts'
import { CantonChain } from './index.ts'
import type { TokenMetadataClient } from './token-metadata/client.ts'
import type { TransferInstructionClient } from './transfer-instruction/client.ts'

const PARTY = 'party1::aabbcc'

const ROUTER_CONTRACT_ID = 'router-cid-001'
const ROUTER_BLOB = 'router-blob'
const ROUTER_TEMPLATE_ID = 'pkg-router:CCIP.PerPartyRouter:PerPartyRouter'

const RECEIVER_CONTRACT_ID = 'receiver-cid-002'
const RECEIVER_BLOB = 'receiver-blob'
const RECEIVER_TEMPLATE_ID = 'pkg-receiver:CCIP.CCIPReceiver:CCIPReceiver'

function makeAcsEntry(
  templateId: string,
  contractId: string,
  createdEventBlob: string,
  signatory: string,
): JsGetActiveContractsResponse {
  return {
    contractEntry: {
      JsActiveContract: {
        synchronizerId: 'synchronizer::001122',
        createdEvent: {
          templateId,
          contractId,
          createdEventBlob,
          signatories: [signatory],
          createArgument: { partyOwner: signatory, owner: signatory },
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

const EXECUTE_ACS: JsGetActiveContractsResponse[] = [
  makeAcsEntry(ROUTER_TEMPLATE_ID, ROUTER_CONTRACT_ID, ROUTER_BLOB, PARTY),
  makeAcsEntry(RECEIVER_TEMPLATE_ID, RECEIVER_CONTRACT_ID, RECEIVER_BLOB, PARTY),
]

function makeStubClient(acsEntries: JsGetActiveContractsResponse[]): CantonClient {
  return {
    getLedgerEnd: async () => ({ offset: 42 }),
    getActiveContracts: async () => acsEntries,
  } as unknown as CantonClient
}

/** EVM → Canton v2 payload: bare hex encodedMessage (no `0x`), as returned by CCIP API. */
const BARE_ENCODED_MESSAGE =
  '0180a125ef7e2d41dade41ba4fc9d91ad900000000000000ec000531b00000c350000000009a25b2b8f01e3d98ba406630f8a1cda063753407b874762588f561351b46838e2003519eac48d545c4d0ecdc3e3022e443d9e878867827eecb37d5e5a60ae0c98914c6a246a9acdaae651708706494720f79c3e5d0a12028b2421067c474960f680ee23de0c86ce91d3ec7b24f8f5819289160f4d124a7148C244f0B2164E6A3BED74ab429B0ebd661Bb14CA00000000000568656c6c6f'

const MESSAGE_ID = '0x62c8432ef490e06659677a0163bca342fffc62a2b6fbc3a871a312c4ecab53ff'

function makeEdsStub() {
  const fetchExecutionDisclosures = mock.fn(async () => ({
    contextData: 'global-context',
    disclosedContracts: [],
  }))
  const fetchCcvExecuteDisclosure = mock.fn(async () => ({
    contractId: 'ccv-cid',
    contextData: 'ccv-context',
    disclosedContracts: [],
  }))
  const fetchTokenPoolExecuteDisclosure = mock.fn()

  const eds = {
    fetchExecutionDisclosures,
    fetchCcvExecuteDisclosure,
    fetchTokenPoolExecuteDisclosure,
  } as unknown as EdsDisclosureProvider

  return { eds, fetchExecutionDisclosures, fetchCcvExecuteDisclosure }
}

function makeTestCantonChain(apiClient: CCIPAPIClient, eds: EdsDisclosureProvider): CantonChain {
  const client = makeStubClient(EXECUTE_ACS)
  const acs = new AcsDisclosureProvider(client, { party: PARTY })
  const cantonNetwork = networkInfo('canton:TestNet') as NetworkInfo<typeof ChainFamily.Canton>
  return new CantonChain(
    client,
    acs,
    eds,
    {} as TransferInstructionClient,
    {} as TransferInstructionClient,
    {} as TokenMetadataClient,
    'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
    'https://indexer.testnet.ccip.chain.link',
    cantonNetwork,
    PARTY,
    { apiClient, logger: console },
  )
}

describe('CantonChain.generateUnsignedExecute (messageId)', () => {
  it('resolves messageId via CCIP API and builds Execute JsCommands', async () => {
    const mockFetch = mock.fn(() =>
      Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              offramp: '0xd03375cb15a7179bfbfa7cfb843250a6b26e4ddc7a4c30e7bc1777cf3afbf580',
              encodedMessage: BARE_ENCODED_MESSAGE,
              ccvData: ['0xe9a05a200240'],
              verifierAddresses: [
                '0xec1e288bcf8bbf034ac2d31b67f9b15a3f1f828d086c5b9d8fc2866129cd02fe',
              ],
            }),
          ),
      }),
    )
    const apiClient = new CCIPAPIClient('https://api.test', { fetch: mockFetch as any })
    const { eds, fetchExecutionDisclosures, fetchCcvExecuteDisclosure } = makeEdsStub()
    const chain = makeTestCantonChain(apiClient, eds)

    const unsigned = await chain.generateUnsignedExecute({
      messageId: MESSAGE_ID,
      payer: PARTY,
      _cantonReceiverCid: RECEIVER_CONTRACT_ID,
    } as unknown as Parameters<CantonChain['generateUnsignedExecute']>[0])

    assert.equal(unsigned.family, ChainFamily.Canton)
    assert.equal(unsigned.commands.commands.length, 1)
    assert.equal(
      (unsigned.commands.commands[0] as { ExerciseCommand: { choice: string } }).ExerciseCommand
        .choice,
      'Execute',
    )
    assert.equal(mockFetch.mock.callCount(), 1)
    const fetchUrl = (mockFetch.mock.calls[0] as unknown as { arguments: string[] }).arguments[0]!
    assert.match(fetchUrl, /execution-inputs/)
    assert.equal(fetchExecutionDisclosures.mock.callCount(), 1)
    assert.equal(fetchCcvExecuteDisclosure.mock.callCount(), 1)

    const choiceArgument = (
      unsigned.commands.commands[0] as {
        ExerciseCommand: { choiceArgument: { encodedMessage: string } }
      }
    ).ExerciseCommand.choiceArgument
    assert.equal(choiceArgument.encodedMessage, BARE_ENCODED_MESSAGE.toLowerCase())
  })

  it('accepts pre-resolved offRamp + input without calling the API', async () => {
    const mockFetch = mock.fn()
    const apiClient = new CCIPAPIClient('https://api.test', { fetch: mockFetch as any })
    const { eds, fetchExecutionDisclosures } = makeEdsStub()
    const chain = makeTestCantonChain(apiClient, eds)

    await chain.generateUnsignedExecute({
      offRamp: '0xd03375cb15a7179bfbfa7cfb843250a6b26e4ddc7a4c30e7bc1777cf3afbf580',
      input: {
        encodedMessage: `0x${BARE_ENCODED_MESSAGE}`,
        verifications: [
          {
            ccvData: '0xdeadbeef',
            destAddress: '0xec1e288bcf8bbf034ac2d31b67f9b15a3f1f828d086c5b9d8fc2866129cd02fe',
          },
        ],
      },
      payer: PARTY,
      _cantonReceiverCid: RECEIVER_CONTRACT_ID,
    } as unknown as Parameters<CantonChain['generateUnsignedExecute']>[0])

    assert.equal(mockFetch.mock.callCount(), 0)
    assert.equal(fetchExecutionDisclosures.mock.callCount(), 1)
  })
})
