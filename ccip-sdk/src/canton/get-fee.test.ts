/**
 * Unit tests for {@link CantonChain.getFee}: GetFee choice-argument derivation
 * (Send args minus `feeTokenInput`), prepare-only submission, and result
 * parsing into fee-token smallest units.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Send } from '@chainlink/canton-contracts/ccip-sender-v2-2.1.0/CCIP/CCIPSender'
import { encodeBase64 } from 'ethers'

import { CantonChain } from './index.ts'

const OWNER = 'sender::1220ab'
const CCIP_SENDER_CID = '#sender-cid'

function encodeVarint(value: number): number[] {
  const bytes: number[] = []
  let v = value
  do {
    let byte = v & 0x7f
    v = Math.floor(v / 128)
    if (v > 0) byte |= 0x80
    bytes.push(byte)
  } while (v > 0)
  return bytes
}

function field(fieldNumber: number, payload: number[]): number[] {
  return [...encodeVarint((fieldNumber << 3) | 2), ...encodeVarint(payload.length), ...payload]
}

function stringField(fieldNumber: number, text: string): number[] {
  return field(fieldNumber, [...new TextEncoder().encode(text)])
}

/** A PreparedTransaction with a GetFee exercise returning the given numerics. */
function preparedTransaction(numerics: Array<[string, string]>): Uint8Array {
  return preparedTransactionFromNodes([
    transactionNode(CCIP_SENDER_CID, 'GetFee', getResultValue(numerics)),
  ])
}

/** A PreparedTransaction whose GetFee result record omits field labels (positional). */
function preparedTransactionUnlabeled(numerics: string[]): Uint8Array {
  const resultValue = field(
    14,
    numerics.flatMap((numeric) =>
      // Record entry (2) → RecordField { Value (2) { Numeric (6) } } — no label (1)
      field(2, field(2, field(6, [...new TextEncoder().encode(numeric)]))),
    ),
  )
  return preparedTransactionFromNodes([transactionNode(CCIP_SENDER_CID, 'GetFee', resultValue)])
}

/** Daml Value { 14: Record { 2: RecordField { 1: label, 2: Value { 6: numeric } } } }. */
function getResultValue(numerics: Array<[string, string]>): number[] {
  return field(
    14,
    numerics.flatMap(([label, numeric]) =>
      field(2, [
        ...stringField(1, label),
        ...field(2, field(6, [...new TextEncoder().encode(numeric)])),
      ]),
    ),
  )
}

/** DamlTransaction.Node { node_id = 1, v1 Node { 3: Exercise } } for one exercise. */
function transactionNode(contractId: string, choice: string, resultValue: number[]): number[] {
  const exercise = [
    ...stringField(2, contractId),
    ...stringField(9, choice),
    ...field(13, resultValue),
  ]
  return [...stringField(1, 'root'), ...field(1000, field(3, exercise))]
}

function preparedTransactionFromNodes(nodes: number[][]): Uint8Array {
  return new Uint8Array(
    field(
      1,
      nodes.flatMap((n) => field(3, n)),
    ),
  )
}

const SEND_ARGS = {
  destinationChainSelector: '16015286601757825753',
  message: {
    receiver: 'abc',
    payload: '',
    tokenTransfer: null,
    feeToken: { admin: 'a', id: 'b' },
    extraArgs: {},
  },
  routerCid: '#router-cid',
  ccvSendInputs: [],
  tokenTransferInput: null,
  executorInput: null,
  context: { values: {} },
  feeTokenInput: { senderInputCids: [] },
} as unknown as Send

function chainWith(preparedTransactionB64?: string): {
  chain: CantonChain
  prepareRequests: Array<Record<string, unknown>>
} {
  const prepareRequests: Array<Record<string, unknown>> = []
  const chain = Object.assign(Object.create(CantonChain.prototype), {
    network: { family: 'canton' },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    activeParty: OWNER,
    ledgerApiClient: {
      prepareSubmission: async (request: Record<string, unknown>) => {
        prepareRequests.push(request)
        return {
          preparedTransaction: preparedTransactionB64 ?? '',
          preparedTransactionHash: 'deadbeef',
        }
      },
    },
  }) as CantonChain
  ;(
    chain as unknown as { buildSendChoiceArgs: CantonChain['buildSendChoiceArgs'] }
  ).buildSendChoiceArgs = async () => ({
    sendArgs: SEND_ARGS,
    disclosedContracts: [{ contractId: CCIP_SENDER_CID } as never],
    ccipSenderCid: CCIP_SENDER_CID,
  })
  return { chain, prepareRequests }
}

const FEE_OPTS = {
  router: 'ccipsender',
  destChainSelector: 16015286601757825753n,
  message: { receiver: '0xabc', data: '0x' },
} as Parameters<CantonChain['getFee']>[0]

describe('CantonChain.getFee', () => {
  it('parses the fee from the prepared GetFee exercise result', async () => {
    const { chain } = chainWith(
      encodeBase64(
        preparedTransaction([
          ['feeTokenAmount', '1.5000000000'],
          ['poolFeeTokenAmount', '0.2500000000'],
        ]),
      ),
    )
    const fee = await chain.getFee(FEE_OPTS)
    assert.equal(fee, 15000000000n)
  })

  it('falls back to positional fields when record labels are omitted', async () => {
    const { chain } = chainWith(
      encodeBase64(preparedTransactionUnlabeled(['1.5000000000', '0.2500000000'])),
    )
    const fee = await chain.getFee(FEE_OPTS)
    assert.equal(fee, 15000000000n)
  })

  it('exercises GetFee with the Send arguments minus feeTokenInput', async () => {
    const { chain, prepareRequests } = chainWith(
      encodeBase64(preparedTransaction([['feeTokenAmount', '0.0000000001']])),
    )
    await chain.getFee(FEE_OPTS)
    assert.equal(prepareRequests.length, 1)

    const request = prepareRequests[0]!
    assert.deepEqual(request.actAs, [OWNER])
    assert.deepEqual(request.readAs, [])
    const command = (
      request.commands as Array<{
        ExerciseCommand?: {
          choice: string
          contractId: string
          templateId: string
          choiceArgument: unknown
        }
      }>
    )[0]!.ExerciseCommand!
    assert.equal(command.choice, 'GetFee')
    assert.equal(command.contractId, CCIP_SENDER_CID)
    assert.match(command.templateId, /CCIP\.CCIPSender:CCIPSender$/)

    const choiceArgument = command.choiceArgument as Record<string, unknown>
    assert.ok(!('feeTokenInput' in choiceArgument))
    const sendArgsCopy = SEND_ARGS as unknown as Record<string, unknown>
    for (const key of Object.keys(sendArgsCopy)) {
      if (key === 'feeTokenInput') continue
      assert.deepEqual(choiceArgument[key], sendArgsCopy[key], `mismatched field ${key}`)
    }
  })

  it('rejects when the prepared transaction has no GetFee result', async () => {
    const { chain } = chainWith()
    await assert.rejects(() => chain.getFee(FEE_OPTS), /did not include a GetFee exercise result/)
  })

  it('ignores nested same-name exercises on other contracts', async () => {
    // A nested CrossChainVerifier-style GetFee on another contract, listed
    // before the root CCIPSender.GetFee exercise (nested nodes come first).
    const verifierQuote = getResultValue([
      ['ccvInstanceId', 'committeeverifier-pttst'],
      ['feeUSDCents', '0.'],
    ])
    const { chain } = chainWith(
      encodeBase64(
        preparedTransactionFromNodes([
          transactionNode('#verifier-cid', 'GetFee', verifierQuote),
          transactionNode(
            CCIP_SENDER_CID,
            'GetFee',
            getResultValue([['feeTokenAmount', '3.3999999999']]),
          ),
        ]),
      ),
    )
    const fee = await chain.getFee(FEE_OPTS)
    assert.equal(fee, 33999999999n)
  })

  it('rejects non-numeric feeTokenAmount values', async () => {
    const { chain } = chainWith(
      encodeBase64(preparedTransaction([['feeTokenAmount', 'committeeverifier-pttst']])),
    )
    await assert.rejects(() => chain.getFee(FEE_OPTS), /unexpected GetFee exercise result/)
  })

  it('rejects when the GetFee result has no numeric field', async () => {
    // exercise_result: Value { 14: Record { 2: RecordField { 2: Value { 14: Record {} } } } }
    const nonNumericResult = field(14, field(2, field(14, [])))
    const { chain } = chainWith(
      encodeBase64(
        preparedTransactionFromNodes([
          transactionNode(CCIP_SENDER_CID, 'GetFee', nonNumericResult),
        ]),
      ),
    )
    await assert.rejects(() => chain.getFee(FEE_OPTS), /unexpected GetFee exercise result/)
  })
})
