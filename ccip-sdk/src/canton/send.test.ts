/**
 * Deterministic tests for `CantonChain.generateUnsignedSendMessage`.
 *
 * The command is built from explicit contract IDs and holding CIDs, so the only
 * external dependency is the EDS disclosure endpoint, which is faked. The tests
 * pin validation, message encoding, fee-token inputs, CCV routing, executor
 * mode and command-ID handling.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPSender } from '@chainlink/canton-contracts/ccip-sender-v2-2.1.0/CCIP/CCIPSender'

import { CCIPErrorCode } from '../errors/index.ts'
import type { AnyMessage } from '../types.ts'
import { RawInstanceAddress, parsePartyId } from './addressCodec.ts'
import { CantonChain } from './index.ts'

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const ACTIVE_PARTY = parsePartyId(`party::1220${'ab'.repeat(32)}`)
const OTHER_PARTY = parsePartyId(`other::1220${'34'.repeat(32)}`)
const CCIP_PARTY = parsePartyId(`ccipOwner::1220${'cd'.repeat(32)}`)
const DSO_PARTY = `DSO::1220${'ef'.repeat(32)}`
const NATIVE_TOKEN = `Amulet@${DSO_PARTY}`
const DEST_CHAIN_SELECTOR = 16015286601757825753n // Sepolia
const CCV_RAW = `ccv-1@ccvOwner::1220${'12'.repeat(32)}`

type EdsCall = { path: string; body: Record<string, unknown>; params?: unknown }

type EdsSendResponse = {
  contextData: Record<string, unknown>
  disclosedContracts: Record<string, unknown>[]
  ccvs: string[]
  executor?: string
  feeTokenConfigCid?: string
  feeTokenTransferFactoryCid?: string
  feeTokenTransferFactoryContext?: Record<string, unknown>
}

function sendResponse(overrides: Partial<EdsSendResponse> = {}): EdsSendResponse {
  return {
    contextData: { values: { choiceContext: { tag: 'AV_ContractId', value: 'ctx-cid' } } },
    disclosedContracts: [
      {
        templateId: 'tpl',
        contractId: 'disclosed-1',
        createdEventBlob: 'blob',
        synchronizerId: 'sync',
      },
    ],
    ccvs: [],
    feeTokenConfigCid: 'fee-config-cid',
    feeTokenTransferFactoryCid: 'fee-factory-cid',
    feeTokenTransferFactoryContext: { values: { factory: { tag: 'AV_ContractId' } } },
    ...overrides,
  }
}

type EdsOptions = {
  ccvResponse?: Record<string, unknown>
  executorResponse?: Record<string, unknown>
  tokenPoolResponse?: Record<string, unknown>
  /** Raw instance address returned by the TokenAdminRegistry lookup. */
  tokenPoolAddress?: string
}

function edsProvider(response: EdsSendResponse, calls: EdsCall[], options: EdsOptions = {}) {
  const post =
    (data: unknown) => async (path: string, init?: { body?: unknown; params?: unknown }) => {
      calls.push({
        path,
        body: (init?.body ?? {}) as Record<string, unknown>,
        params: init?.params,
      })
      return { data, error: undefined }
    }

  return {
    ccipClientFor: () => ({
      POST: post(response),
      GET: async (path: string, init?: { params?: unknown }) => {
        calls.push({ path, body: { params: init?.params } as Record<string, unknown> })
        return { data: { rawInstanceAddress: options.tokenPoolAddress }, error: undefined }
      },
    }),
    ccvClientFor: () => ({ POST: post(options.ccvResponse) }),
    executorClientFor: () => ({ POST: post(options.executorResponse) }),
    tokenPoolClientFor: () => ({ POST: post(options.tokenPoolResponse) }),
  }
}

function chainWith(eds: unknown, ccvs: readonly RawInstanceAddress[] = []): CantonChain {
  return Object.assign(Object.create(CantonChain.prototype), {
    logger: silentLogger,
    activeParty: ACTIVE_PARTY,
    ccipParty: CCIP_PARTY,
    nativeToken: { instrumentId: NATIVE_TOKEN, symbol: 'CC', decimals: 10 },
    ccvs,
    edsClientProvider: eds,
  }) as CantonChain
}

function extraArgs(overrides: Record<string, unknown> = {}): AnyMessage['extraArgs'] {
  return {
    feeTokenHoldingCids: ['fee-holding-1'],
    perPartyRouterCid: 'router-cid',
    ccipSenderCid: 'sender-cid',
    ...overrides,
  } as unknown as AnyMessage['extraArgs']
}

function sendOpts(
  overrides: {
    extraArgs?: Record<string, unknown>
    message?: Partial<AnyMessage>
    sender?: string
  } = {},
) {
  return {
    router: '',
    destChainSelector: DEST_CHAIN_SELECTOR,
    sender: overrides.sender ?? ACTIVE_PARTY,
    message: {
      receiver: `0x${'ab'.repeat(32)}`,
      data: '0xdeadbeef',
      tokenAmounts: [],
      extraArgs: extraArgs(overrides.extraArgs),
      ...overrides.message,
    } as AnyMessage,
  }
}

type ExerciseCommand = {
  ExerciseCommand: {
    templateId: string
    contractId: string
    choice: string
    choiceArgument: {
      destinationChainSelector: string
      message: {
        receiver: string
        payload: string
        tokenTransfer: unknown
        feeToken: { admin: string; id: string }
        extraArgs: {
          tag: string
          value: {
            gasLimit: string
            ccvs: string[]
            executor: { tag: string; value: Record<string, unknown> }
            tokenArgs: string
            tokenReceiver: string
          }
        }
      }
      routerCid: string
      feeTokenInput: {
        senderInputCids: string[]
        feeTokenConfigCid: string
        feeTokenTransferFactory: string
        feeTokenExtraArgs: { context: unknown; meta: unknown }
      }
      ccvSendInputs: Array<{ ccvAddress: { unpack: string }; ccvCid: string; context: unknown }>
      tokenTransferInput: unknown
      executorInput: unknown
      context: unknown
    }
  }
}

function exerciseOf(unsigned: { commands: { commands: readonly unknown[] } }): ExerciseCommand {
  const commands = unsigned.commands.commands
  assert.equal(commands.length, 1)
  return commands[0] as unknown as ExerciseCommand
}

describe('CantonChain.generateUnsignedSendMessage', () => {
  it('builds the CCIPSender.Send command with the resolved disclosures', async () => {
    const calls: EdsCall[] = []
    const response = sendResponse()
    const chain = chainWith(edsProvider(response, calls))

    const unsigned = await chain.generateUnsignedSendMessage(
      sendOpts({ extraArgs: { commandId: 'cmd-1', gasLimit: 250_000n } }),
    )

    assert.equal(unsigned.family, 'CANTON')
    assert.equal(unsigned.commands.commandId, 'cmd-1')
    assert.deepEqual(unsigned.commands.actAs, [ACTIVE_PARTY])
    assert.deepEqual(unsigned.commands.disclosedContracts, response.disclosedContracts)

    const { ExerciseCommand } = exerciseOf(unsigned)
    assert.equal(ExerciseCommand.templateId, CCIPSender.templateId)
    assert.equal(ExerciseCommand.contractId, 'sender-cid')
    assert.equal(ExerciseCommand.choice, 'Send')

    const args = ExerciseCommand.choiceArgument
    assert.equal(args.destinationChainSelector, DEST_CHAIN_SELECTOR.toString())
    assert.equal(args.message.receiver, 'ab'.repeat(32))
    assert.equal(args.message.payload, 'deadbeef')
    assert.equal(args.message.tokenTransfer, null)
    assert.deepEqual(args.message.feeToken, { admin: DSO_PARTY, id: 'Amulet' })
    assert.equal(args.message.extraArgs.tag, 'V3')
    assert.equal(args.message.extraArgs.value.gasLimit, '250000')
    assert.deepEqual(args.message.extraArgs.value.ccvs, [])
    assert.equal(args.message.extraArgs.value.executor.tag, 'Executor_UseDefault')
    assert.deepEqual(args.message.extraArgs.value.executor.value, { executorArgs: '' })
    assert.equal(args.message.extraArgs.value.tokenArgs, '')
    assert.equal(args.message.extraArgs.value.tokenReceiver, '')

    assert.equal(args.routerCid, 'router-cid')
    assert.deepEqual(args.feeTokenInput.senderInputCids, ['fee-holding-1'])
    assert.equal(args.feeTokenInput.feeTokenConfigCid, 'fee-config-cid')
    assert.equal(args.feeTokenInput.feeTokenTransferFactory, 'fee-factory-cid')
    assert.deepEqual(
      args.feeTokenInput.feeTokenExtraArgs.context,
      response.feeTokenTransferFactoryContext,
    )
    assert.deepEqual(args.feeTokenInput.feeTokenExtraArgs.meta, { values: {} })
    assert.equal(args.context, response.contextData)
    assert.deepEqual(args.ccvSendInputs, [])
    assert.equal(args.tokenTransferInput, null)
    assert.equal(args.executorInput, null)

    // The EDS request mirrors the message that the on-ledger command will send.
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.path, '/ccip/v1/global/message/send')
    const sent = calls[0]!.body['message'] as Record<string, unknown>
    assert.equal(sent['destinationChainSelector'], DEST_CHAIN_SELECTOR.toString())
    assert.equal(sent['sender'], ACTIVE_PARTY)
    assert.equal(sent['receiver'], 'ab'.repeat(32))
    assert.equal(sent['payload'], 'deadbeef')
    const sentFeeToken = sent['feeToken'] as { admin: string; id: string }
    assert.equal(sentFeeToken.admin, DSO_PARTY)
    assert.equal(sentFeeToken.id, 'Amulet')
    assert.deepEqual(sent['executor'], { type: '' })
    assert.equal(sent['gasLimit'], 250_000)
    assert.deepEqual(calls[0]!.body['senderRequiredCCVs'], [])
    assert.deepEqual(calls[0]!.body['tokenPoolRequiredCCVs'], [])
  })

  it('generates a command ID when none is supplied', async () => {
    const chain = chainWith(edsProvider(sendResponse(), []))

    const unsigned = await chain.generateUnsignedSendMessage(sendOpts())

    assert.match(unsigned.commands.commandId, /^ccip-send-\d+-[a-z0-9]+$/)
  })

  it('uses Executor_NoExecutor when executorMode is none', async () => {
    const calls: EdsCall[] = []
    const chain = chainWith(edsProvider(sendResponse(), calls))

    const unsigned = await chain.generateUnsignedSendMessage(
      sendOpts({ extraArgs: { executorMode: 'none' } }),
    )

    const args = exerciseOf(unsigned).ExerciseCommand.choiceArgument
    assert.equal(args.message.extraArgs.value.executor.tag, 'Executor_NoExecutor')
    assert.deepEqual((calls[0]!.body['message'] as Record<string, unknown>)['executor'], {
      type: 'noExecutor',
    })
  })

  it('routes configured CCVs into senderRequiredCCVs and the command inputs', async () => {
    const calls: EdsCall[] = []
    const ccv = RawInstanceAddress.fromString(CCV_RAW)
    const response = sendResponse({
      ccvs: [CCV_RAW],
      disclosedContracts: [{ templateId: 'tpl', contractId: 'disclosed-1' }],
    })
    const chain = chainWith(
      edsProvider(response, calls, {
        ccvResponse: {
          rawInstanceAddress: CCV_RAW,
          disclosedContracts: [{ templateId: 'ccv-tpl', contractId: 'ccv-disclosed' }],
          contractId: 'ccv-cid',
          contextData: { values: { ccv: true } },
        },
      }),
      [ccv],
    )

    const unsigned = await chain.generateUnsignedSendMessage(sendOpts())

    assert.deepEqual(calls[0]!.body['senderRequiredCCVs'], [CCV_RAW])
    const args = exerciseOf(unsigned).ExerciseCommand.choiceArgument
    assert.equal(args.ccvSendInputs.length, 1)
    assert.deepEqual(args.ccvSendInputs[0]!.ccvAddress, { unpack: CCV_RAW })
    assert.equal(args.ccvSendInputs[0]!.ccvCid, 'ccv-cid')
    assert.deepEqual(args.ccvSendInputs[0]!.context, { values: { ccv: true } })
    assert.deepEqual(unsigned.commands.disclosedContracts, [
      { templateId: 'tpl', contractId: 'disclosed-1' },
      { templateId: 'ccv-tpl', contractId: 'ccv-disclosed' },
    ])
  })

  it('prefers explicit ccvRawAddresses over the configured CCVs', async () => {
    const calls: EdsCall[] = []
    const configured = RawInstanceAddress.fromString(CCV_RAW)
    const explicit = `ccv-2@ccvOwner::1220${'56'.repeat(32)}`
    const chain = chainWith(
      edsProvider(sendResponse({ ccvs: [explicit] }), calls, {
        ccvResponse: {
          rawInstanceAddress: explicit,
          disclosedContracts: [],
          contractId: 'ccv-2-cid',
          contextData: {},
        },
      }),
      [configured],
    )

    await chain.generateUnsignedSendMessage(
      sendOpts({ extraArgs: { ccvRawAddresses: [explicit] } }),
    )

    assert.deepEqual(calls[0]!.body['senderRequiredCCVs'], [explicit])
  })

  it('routes the EDS executor through executorInput', async () => {
    const calls: EdsCall[] = []
    const executor = `executor-1@executorOwner::1220${'78'.repeat(32)}`
    const chain = chainWith(
      edsProvider(sendResponse({ executor }), calls, {
        executorResponse: {
          disclosedContracts: [{ templateId: 'executor-tpl', contractId: 'executor-disclosed' }],
          contractId: 'executor-cid',
          contextData: { values: { executor: true } },
        },
      }),
    )

    const unsigned = await chain.generateUnsignedSendMessage(sendOpts())

    const args = exerciseOf(unsigned).ExerciseCommand.choiceArgument
    assert.deepEqual(args.executorInput, {
      executorCid: 'executor-cid',
      context: { values: { executor: true } },
    })
    assert.deepEqual(unsigned.commands.disclosedContracts, [
      {
        templateId: 'tpl',
        contractId: 'disclosed-1',
        createdEventBlob: 'blob',
        synchronizerId: 'sync',
      },
      { templateId: 'executor-tpl', contractId: 'executor-disclosed' },
    ])
    assert.equal(calls.length, 2)
    assert.equal(calls[1]!.path, '/ccip/v1/external/executor/{address}/send')
    assert.deepEqual(calls[1]!.params, { path: { address: executor } })
  })

  it('routes a token transfer through the registry and token pool disclosures', async () => {
    const calls: EdsCall[] = []
    const pool = `pool-1@poolOwner::1220${'9a'.repeat(32)}`
    const token = `TOKEN-A@${DSO_PARTY}`
    const chain = chainWith(
      edsProvider(sendResponse(), calls, {
        tokenPoolAddress: pool,
        tokenPoolResponse: {
          requiredCCVs: [],
          disclosedContracts: [{ templateId: 'pool-tpl', contractId: 'pool-disclosed' }],
          contractId: 'pool-cid',
          contextData: { values: { pool: true } },
        },
      }),
    )

    const unsigned = await chain.generateUnsignedSendMessage(
      sendOpts({
        extraArgs: { tokenTransferHoldingCids: ['token-holding-1'] },
        message: { data: '0x', tokenAmounts: [{ token, amount: 5n }] },
      }),
    )

    assert.equal(calls.length, 3)
    assert.match(calls[0]!.path, /^\/ccip\/v1\/global\/TokenAdminRegistry\/token\//)
    assert.match(calls[1]!.path, /^\/ccip\/v1\/external\/tokenPool\//)
    assert.equal(calls[2]!.path, '/ccip/v1/global/message/send')

    const args = exerciseOf(unsigned).ExerciseCommand.choiceArgument
    assert.deepEqual(args.message.tokenTransfer, {
      token: { admin: DSO_PARTY, id: 'TOKEN-A' },
      amount: '0.0000000005',
    })
    assert.deepEqual(args.tokenTransferInput, {
      tokenPoolCid: 'pool-cid',
      senderInputCids: ['token-holding-1'],
      context: { values: { pool: true } },
    })
    assert.deepEqual(args.message.extraArgs.value.gasLimit, '0', 'token-only sends need no gas')
    assert.deepEqual(unsigned.commands.disclosedContracts, [
      { templateId: 'pool-tpl', contractId: 'pool-disclosed' },
      {
        templateId: 'tpl',
        contractId: 'disclosed-1',
        createdEventBlob: 'blob',
        synchronizerId: 'sync',
      },
    ])

    const sent = calls[2]!.body['message'] as Record<string, unknown>
    assert.deepEqual(sent['tokenTransfer'], {
      token: { admin: DSO_PARTY, id: 'TOKEN-A' },
      amount: '0.0000000005',
      holdingContractIds: ['token-holding-1'],
    })
    assert.deepEqual(calls[2]!.body['tokenPoolRequiredCCVs'], [])
  })

  it('requires a sender', async () => {
    const chain = chainWith(edsProvider(sendResponse(), []))

    await assert.rejects(
      () => chain.generateUnsignedSendMessage(sendOpts({ sender: '' })),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, CCIPErrorCode.WALLET_INVALID)
        assert.match((error as Error).message, /sender \(party ID\) is required/)
        return true
      },
    )
  })

  it('requires the sender to be the active party', async () => {
    const chain = chainWith(edsProvider(sendResponse(), []))

    await assert.rejects(
      () => chain.generateUnsignedSendMessage(sendOpts({ sender: OTHER_PARTY })),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, CCIPErrorCode.WALLET_INVALID)
        assert.match((error as Error).message, /cannot differ from active party/)
        return true
      },
    )
  })

  it('rejects more than one token transfer', async () => {
    const chain = chainWith(edsProvider(sendResponse(), []))

    await assert.rejects(
      () =>
        chain.generateUnsignedSendMessage(
          sendOpts({
            message: {
              tokenAmounts: [
                { token: `TOKEN-A@${DSO_PARTY}`, amount: 1n },
                { token: `TOKEN-B@${DSO_PARTY}`, amount: 2n },
              ],
            },
          }),
        ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, CCIPErrorCode.METHOD_UNSUPPORTED)
        assert.match((error as Error).message, /only one token transfer is supported/)
        return true
      },
    )
  })

  it('rejects a zero token transfer amount', async () => {
    const chain = chainWith(edsProvider(sendResponse(), []))

    await assert.rejects(
      () =>
        chain.generateUnsignedSendMessage(
          sendOpts({
            extraArgs: { tokenTransferHoldingCids: ['token-holding-1'] },
            message: {
              data: '0x',
              tokenAmounts: [{ token: `TOKEN-A@${DSO_PARTY}`, amount: 0n }],
            },
          }),
        ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, CCIPErrorCode.METHOD_UNSUPPORTED)
        assert.match((error as Error).message, /amount must be greater than zero/)
        return true
      },
    )
  })

  it('rejects a fee token without a transfer factory', async () => {
    const chain = chainWith(
      edsProvider(sendResponse({ feeTokenTransferFactoryCid: undefined }), []),
    )

    await assert.rejects(
      () => chain.generateUnsignedSendMessage(sendOpts()),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, CCIPErrorCode.CANTON_API_ERROR)
        assert.match((error as Error).message, /feeTokenTransferFactoryCid/)
        return true
      },
    )
  })

  it('surfaces an EDS send-disclosure failure', async () => {
    const chain = chainWith({
      ccipClientFor: () => ({
        POST: async () => ({ data: undefined, error: { error: 'eds unavailable' } }),
      }),
    })

    await assert.rejects(
      () => chain.generateUnsignedSendMessage(sendOpts()),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, CCIPErrorCode.CANTON_API_ERROR)
        assert.match((error as Error).message, /failed to fetch CCIP send disclosures/)
        assert.match((error as Error).message, /eds unavailable/)
        return true
      },
    )
  })
})
