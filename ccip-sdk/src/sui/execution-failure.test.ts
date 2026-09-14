/**
 * Tests for Sui failed-execution detection: synthetic `state=3` logs
 * reconstructed from failed OffRamp executions (effects status + the BCS
 * ExecutionReport in the transaction input), surfaced by getExecutionReceipts,
 * getLogs with `ExecutionStateChanged` topics (merged with successes), and
 * getTransaction — plus `decodeReceipt`/`parse`/`error` plumbing.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getBytes, hexlify } from 'ethers'

import { type ChainFamily, type NetworkInfo, networkInfo } from '../networks.ts'
import { ExecutionState } from '../types.ts'
import { getSuiExecutionFailureLog, getSuiFailureData, isSuiSkippedReport } from './logs.ts'
import { SuiChain } from './index.ts'

const PKG = '0x' + '77'.repeat(32)
const ADDRESS = `${PKG}::offramp`
const MESSAGE_ID = '0x' + 'ab'.repeat(32)
const SENDER = '0x' + '11'.repeat(32)
const RECEIVER = '0x' + '22'.repeat(32)
const TOKEN_RECEIVER = '0x' + '33'.repeat(32)
const SELECTOR = 0x0f10000000000001n
const DEST_SELECTOR = 0x0f10000000000002n

const ABORT_OFFRAMP =
  'MoveAbort(MoveLocation { module: ModuleId { address: 0x' +
  'ab'.repeat(32) +
  ', name: "offramp" }, ' +
  'function: 8, instruction: 12 }, 9) in command 2'
const ABORT_RECEIVER =
  'MoveAbort(MoveLocation { module: ModuleId { address: 0x' +
  'cd'.repeat(32) +
  ', name: "ccip_receive" }, ' +
  'function: 3, instruction: 7 }, 1) in command 2'
const NON_ABORT_ERROR = 'Transaction failed with a different error: 42'

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const u64 = (v: bigint) => bcs.u64().serialize(v).toBytes()
const u256 = (v: bigint) => bcs.u256().serialize(v).toBytes()
const u8vec = (v: Uint8Array) => bcs.vector(bcs.u8()).serialize(v).toBytes()

/** BCS encode of the OffRamp execution report, matching ExecutionReportBCS/deserialize_execution_report. */
function reportBytes(sequenceNumber = 7n): Uint8Array {
  return concatBytes([
    u64(SELECTOR),
    getBytes(MESSAGE_ID),
    u64(SELECTOR), // header_source_chain_selector
    u64(DEST_SELECTOR),
    u64(sequenceNumber),
    u64(0n), // nonce
    u8vec(getBytes(SENDER)),
    u8vec(Uint8Array.of()),
    getBytes(RECEIVER),
    u256(1000000n),
    getBytes(TOKEN_RECEIVER),
    Uint8Array.of(0), // token_amounts
    Uint8Array.of(0), // offchain_token_data
    Uint8Array.of(0), // proofs
  ])
}

const wrapVectorU8 = (bytes: Uint8Array) => bcs.vector(bcs.u8()).serialize(bytes).toBytes()

type FailureBlock = Parameters<typeof getSuiExecutionFailureLog>[0]

function offrampMoveCall(
  functionName: string,
  args: { Input: number }[],
  packageId = PKG,
): unknown {
  return {
    MoveCall: { package: packageId, module: 'offramp', function: functionName, arguments: args },
  }
}

/**
 * A failed `manually_init_execute` PTB: the report is the last pure input
 * (index 3), a reportContext-like arg sits before it for init_execute, and a
 * receiver module call stands between init and finish_execute.
 */
function failureBlock(
  overrides: {
    digest?: string
    checkpoint?: string
    timestampMs?: string
    error?: string
    report?: Uint8Array
    gas?: Partial<{ computationCost: string; storageCost: string; storageRebate: string }>
    events?: unknown[]
    sender?: string
  } = {},
): FailureBlock {
  const report = overrides.report ?? reportBytes()
  return {
    digest: overrides.digest ?? '0xTXFAIL',
    checkpoint: overrides.checkpoint ?? '101',
    timestampMs: overrides.timestampMs ?? '101000',
    events: overrides.events,
    effects: {
      status: { status: 'failure', error: overrides.error ?? ABORT_OFFRAMP },
      gasUsed: {
        computationCost: overrides.gas?.computationCost ?? '1000',
        storageCost: overrides.gas?.storageCost ?? '200',
        storageRebate: overrides.gas?.storageRebate ?? '100',
        nonRefundableStorageFee: '0',
      },
    },
    transaction: {
      data: {
        sender: overrides.sender ?? SENDER,
        transaction: {
          kind: 'ProgrammableTransaction',
          inputs: [
            { type: 'object', objectId: '0x1' },
            { type: 'object', objectId: '0x2' },
            { type: 'object', objectId: '0x6' },
            { type: 'pure', value: Array.from(report), valueType: 'vector<u8>' },
          ],
          transactions: [
            offrampMoveCall('manually_init_execute', [
              { Input: 0 },
              { Input: 1 },
              { Input: 2 },
              { Input: 3 },
            ]),
          ],
        },
      },
    },
  } as unknown as FailureBlock
}

function initExecuteFailureBlock(overrides: { reportValue?: unknown } = {}): FailureBlock {
  const report = overrides.reportValue ?? Array.from(reportBytes())
  return {
    ...failureBlock(),
    digest: '0xTXINITFAIL',
    transaction: {
      data: {
        sender: SENDER,
        transaction: {
          kind: 'ProgrammableTransaction',
          inputs: [
            { type: 'object', objectId: '0x1' },
            { type: 'object', objectId: '0x2' },
            { type: 'object', objectId: '0x6' },
            // report_context: vector<vector<u8>> — must NOT be mistaken for a report
            {
              type: 'pure',
              value: [
                [1, 2],
                [3, 4, 5],
              ],
              valueType: 'vector<vector<u8>>',
            },
            { type: 'pure', value: report, valueType: 'vector<u8>' },
          ],
          transactions: [
            offrampMoveCall('init_execute', [
              { Input: 0 },
              { Input: 1 },
              { Input: 2 },
              { Input: 3 },
              { Input: 4 },
            ]),
          ],
        },
      },
    },
  } as unknown as FailureBlock
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of gen) out.push(v)
  return out
}

const network = networkInfo('sui:2') as NetworkInfo<typeof ChainFamily.Sui>

describe('Sui failed execution reconstruction', () => {
  it('builds a synthetic state=3 log from a failed manually_init_execute', () => {
    const log = getSuiExecutionFailureLog(failureBlock())
    assert.ok(log, 'expected a failure log')
    assert.equal(
      log.address,
      `${PKG}::offramp`,
      'module form, like real event logs in getTransaction',
    )
    assert.equal(log.topics[0], 'ExecutionStateChanged')
    assert.equal(log.index, 0, 'synthetic failures use uint-friendly index 0')
    assert.equal(log.transactionHash, '0xTXFAIL')
    assert.equal(log.blockNumber, 101)
    assert.equal(log.blockTimestamp, 101)
    assert.deepEqual(
      {
        message_id: (log.data as Record<string, unknown>).message_id,
        sequence_number: (log.data as Record<string, unknown>).sequence_number,
        source_chain_selector: (log.data as Record<string, unknown>).source_chain_selector,
        state: (log.data as Record<string, unknown>).state,
        gas_used: (log.data as Record<string, unknown>).gas_used,
      },
      {
        message_id: MESSAGE_ID,
        sequence_number: '7',
        source_chain_selector: SELECTOR.toString(),
        state: ExecutionState.Failed,
        gas_used: '1100', // 1000 + 200 - 100
      },
    )
    const returnData = (log.data as Record<string, unknown>).return_data as Record<string, string>
    assert.equal(returnData.effects_status, ABORT_OFFRAMP)
    assert.equal(returnData.function, 'manually_init_execute')
    assert.equal(returnData.location, '0x' + 'ab'.repeat(32) + '::offramp')
    assert.equal(returnData.function_index, '8')
    assert.equal(returnData.instruction, '12')
    assert.equal(returnData.abort_code, '9')
    assert.equal(returnData.dest_chain_selector, DEST_SELECTOR.toString())
    assert.equal(returnData.gas_used, '1100')
  })

  it('returns undefined for successful transactions', () => {
    const success = { ...failureBlock(), effects: { status: { status: 'success' } } }
    assert.equal(getSuiExecutionFailureLog(success as FailureBlock), undefined)
  })

  it('reads the report from init_execute at its own argument position, ignoring report_context', () => {
    const log = getSuiExecutionFailureLog(initExecuteFailureBlock())
    assert.ok(log, 'expected a failure log')
    assert.equal((log.data as { sequence_number: string }).sequence_number, '7')
  })

  it('accepts a hex-string pure value and a BCS vector<u8>-wrapped value', () => {
    const asHex = initExecuteFailureBlock({ reportValue: hexlify(reportBytes()) })
    const wrapped = initExecuteFailureBlock({
      reportValue: Array.from(wrapVectorU8(reportBytes(8n))),
    })
    const fromHex = getSuiExecutionFailureLog(asHex)
    const fromWrapped = getSuiExecutionFailureLog(wrapped)
    assert.equal((fromHex!.data as { sequence_number: string }).sequence_number, '7')
    assert.equal((fromWrapped!.data as { sequence_number: string }).sequence_number, '8')
  })

  it('returns undefined when no offramp call or report is present in the input', () => {
    const noReport = failureBlock()
    ;(noReport as { transaction: unknown }).transaction = {
      data: {
        sender: SENDER,
        transaction: {
          kind: 'ProgrammableTransaction',
          inputs: [],
          transactions: [offrampMoveCall('manually_init_execute', [])],
        },
      },
    }
    assert.equal(getSuiExecutionFailureLog(noReport), undefined)
  })

  it('decodes the abort from receiver-module errors without an offramp instruction', () => {
    const data = getSuiFailureData(ABORT_RECEIVER, 'init_execute', DEST_SELECTOR, 10n)
    assert.equal(data.location, '0x' + 'cd'.repeat(32) + '::ccip_receive')
    assert.equal(data.function_index, '3')
    assert.equal(data.instruction, '7')
    assert.equal(data.abort_code, '1')
    assert.equal(data.dest_chain_selector, DEST_SELECTOR.toString())
    assert.equal(data.gas_used, '10')
  })

  it('decodes the newer node format: unprefixed address, Identifier-wrapped name, function_name', () => {
    // As observed on cldev-style Sui testnet nodes:
    //   MoveAbort(MoveLocation { module: ModuleId { address: 5ef4b483…,
    //     name: Identifier("offramp_state_helper") }, function: 6,
    //     instruction: 8, function_name: Some("get_dest_token_transfer_data") }, 7)
    const data = getSuiFailureData(
      'MoveAbort(MoveLocation { module: ModuleId { address: ' +
        '5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf, ' +
        'name: Identifier("offramp_state_helper") }, function: 6, instruction: 8, ' +
        'function_name: Some("get_dest_token_transfer_data") }, 7) in command 1',
      'init_execute',
    )
    assert.equal(
      data.location,
      '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf::offramp_state_helper',
    )
    assert.equal(data.function_index, '6')
    assert.equal(data.instruction, '8')
    assert.equal(data.function_name, 'get_dest_token_transfer_data')
    assert.equal(data.abort_code, '7')
  })

  it('keeps the raw effects status for non-abort failures', () => {
    const data = getSuiFailureData(NON_ABORT_ERROR, 'finish_execute')
    assert.equal(data.effects_status, NON_ABORT_ERROR)
    assert.equal(data.location, undefined)
    assert.equal(data.abort_code, undefined)
  })

  it('synthesizes the failure even when the failed PTB left a stale success event behind', () => {
    const withStaleSuccess = failureBlock({
      events: [
        {
          type: `${ADDRESS}::ExecutionStateChanged`,
          parsedJson: { message_id: MESSAGE_ID, state: 2 },
        },
      ],
    })
    const log = getSuiExecutionFailureLog(withStaleSuccess)
    assert.ok(log, 'a failed transaction reports its failure regardless of partial events')
    assert.equal((log.data as { state: number }).state, ExecutionState.Failed)
  })

  it('does NOT surface the skipped-report guard: a failed double-execution attempt', () => {
    // The already-executed report path: pre_execute_single_report emits
    // SkippedAlreadyExecuted and returns an EMPTY ReceiverParams hot potato;
    // finish_execute then aborts unwrapping it — exactly the live tx
    // BGuoDp9oLQ… for message 0xdaad1218… (its success had committed earlier).
    // This is the newer node format, as observed live:
    //   MoveAbort(MoveLocation { module: ModuleId { address: 5ef4b483…,
    //     name: Identifier("offramp_state_helper") }, function: 6,
    //     instruction: 8, function_name: Some("get_dest_token_transfer_data") }, 7)
    const skipped = failureBlock({
      digest: '0xTXDUPEXEC',
      error:
        'MoveAbort(MoveLocation { module: ModuleId { address: ' +
        '5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf, ' +
        'name: Identifier("offramp_state_helper") }, function: 6, instruction: 8, ' +
        'function_name: Some("get_dest_token_transfer_data") }, 7) in command 1',
    })
    assert.equal(getSuiExecutionFailureLog(skipped), undefined)
  })

  it('does NOT surface the skipped-report guard on the no-token receiver path (ENoMessageToExtract)', () => {
    // A skipped report whose PTB bundles the receiver command instead of a token
    // pool: extract_any2sui_message aborts on the empty hot potato
    // (offramp_state_helper ENoMessageToExtract = 1) — same skip, different error.
    const skipped = failureBlock({
      digest: '0xTXDUPNORECEIVERFILE',
      error:
        'MoveAbort(MoveLocation { module: ModuleId { address: ' +
        '5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf, ' +
        'name: Identifier("offramp_state_helper") }, function: 7, instruction: 2, ' +
        'function_name: Some("extract_any2sui_message") }, 1) in command 2',
    })
    assert.equal(getSuiExecutionFailureLog(skipped), undefined)
  })

  it('still surfaces other offramp_state_helper abort codes as failures', () => {
    // e.g. ECCIPReceiveFailed (3): the receiver call failed — a real failed execution
    const data = getSuiFailureData(
      'MoveAbort(MoveLocation { module: ModuleId { address: ' +
        '5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf, ' +
        'name: Identifier("offramp_state_helper") }, function: 6, instruction: 8, ' +
        'function_name: Some("deconstruct_receiver_params") }, 3) in command 2',
      'init_execute',
    )
    assert.equal(isSuiSkippedReport(data), false)
    const log = getSuiExecutionFailureLog(failureBlock({ error: NON_ABORT_ERROR }))
    assert.ok(log, 'non-abort failures surface')
  })

  it('flags only the skipped-report module+code pair, not other modules with the same code', () => {
    // the effective-failure lane: managed_token::validate_mint aborts with the
    // same numeric code 7 — a REAL failed execution (live sui-testnet msg
    // 0x779543c6…) — and must not be skipped
    const data = getSuiFailureData(
      'MoveAbort(MoveLocation { module: ModuleId { address: ' +
        '2498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0, ' +
        'name: Identifier("managed_token") }, function: 16, instruction: 63, ' +
        'function_name: Some("validate_mint") }, 7) in command 1',
      'init_execute',
    )
    assert.equal(
      data.location,
      '0x2498ef5418740a8c422b9581cd9b8b56cc372938a2111557c158c46307d916f0::managed_token',
    )
    assert.equal(data.abort_code, '7')
    assert.equal(isSuiSkippedReport(data), false, 'other modules are not the skipped-report guard')
  })
})

describe('SuiChain.getExecutionReceipts failure detection', () => {
  const successEvent = (seq: string) => ({
    type: `${ADDRESS}::ExecutionStateChanged`,
    parsedJson: {
      message_id: MESSAGE_ID,
      message_hash: '0x' + 'cd'.repeat(32),
      sequence_number: seq,
      source_chain_selector: SELECTOR.toString(),
      state: 2,
    },
  })

  function makeChain(responses: Record<string, unknown[]>) {
    const client = {
      getObject: mock.fn(async () => {
        throw new Error('no such object')
      }),
      getOwnedObjects: mock.fn(async () => {
        throw new Error('no such object')
      }),
      queryTransactionBlocks: mock.fn(
        async ({ filter }: { filter: { MoveFunction: { function: string } } }) => ({
          data: responses[filter.MoveFunction.function] ?? [],
          hasNextPage: false,
          nextCursor: null,
        }),
      ),
      getTransactionBlock: mock.fn(async () => ({})),
    } as unknown as SuiJsonRpcClient
    return new SuiChain(client, network)
  }

  it('yields a state=3 receipt with the decoded error, then ends on success', async () => {
    const chain = makeChain({
      // init_execute walks first; newest first — the failure shows up before the success
      init_execute: [
        failureBlock({ digest: '0xTXFAIL', checkpoint: '102' }),
        {
          digest: '0xTXOK',
          checkpoint: '101',
          timestampMs: '101000',
          effects: { status: { status: 'success' } },
          events: [successEvent('7')],
        },
        // below the floor — the descending walk must stop, not page forever
        { digest: '0xTXOLD', checkpoint: '90', effects: { status: { status: 'success' } } },
      ],
      manually_init_execute: [],
    })
    const execs = await collect(
      chain.getExecutionReceipts({ offRamp: ADDRESS, messageId: MESSAGE_ID, startBlock: 100 }),
    )
    assert.equal(execs.length, 2)
    const [failure, success] = execs
    assert.equal(failure!.receipt.state, ExecutionState.Failed)
    assert.equal(failure!.receipt.messageId, MESSAGE_ID)
    assert.equal(failure!.receipt.sequenceNumber, 7n)
    assert.equal(failure!.receipt.sourceChainSelector, SELECTOR)
    assert.equal(failure!.receipt.gasUsed, 1100n)
    assert.equal(failure!.log.blockNumber, 102)
    assert.equal(failure!.log.index, 0)
    assert.deepEqual(failure!.error, failure!.receipt.returnData as Record<string, unknown>)
    assert.equal(success!.receipt.state, ExecutionState.Success)
  })

  it('applies messageId/sourceChainSelector filters to failures too', async () => {
    const chain = makeChain({
      init_execute: [failureBlock({ digest: '0xTXFAIL', checkpoint: '102' })],
      manually_init_execute: [
        {
          digest: '0xTXOK',
          checkpoint: '101',
          effects: { status: { status: 'success' } },
          events: [successEvent('7')],
        },
      ],
    })
    const mismatch = await collect(
      chain.getExecutionReceipts({
        offRamp: ADDRESS,
        messageId: '0x' + 'ee'.repeat(32), // no receipt matches
        startBlock: 100,
      }),
    )
    assert.equal(mismatch.length, 0)
    const wrongSource = await collect(
      chain.getExecutionReceipts({
        offRamp: ADDRESS,
        sourceChainSelector: 999n,
        startBlock: 100,
      }),
    )
    assert.equal(wrongSource.length, 0)
  })

  it('does not end the stream on failures; only a success does', async () => {
    const chain = makeChain({
      manually_init_execute: [
        failureBlock({ digest: '0xTXFAIL1', checkpoint: '103' }),
        failureBlock({ digest: '0xTXFAIL2', checkpoint: '102' }),
      ],
      init_execute: [],
    })
    const execs = await collect(chain.getExecutionReceipts({ offRamp: ADDRESS, startBlock: 100 }))
    assert.deepEqual(
      execs.map((e) => e.receipt.state),
      [ExecutionState.Failed, ExecutionState.Failed],
    )
  })
})

describe('SuiChain.getLogs merges failure scans with event streams', () => {
  const successEvent = (checkpoint: string, digest: string, seq: string) => ({
    id: { txDigest: digest, eventSeq: seq },
    packageId: PKG,
    parsedJson: {
      message_id: MESSAGE_ID,
      message_hash: '0x' + 'cd'.repeat(32),
      sequence_number: '7',
      source_chain_selector: SELECTOR.toString(),
      state: 2,
    },
    sender: SENDER,
    timestampMs: `${Number(checkpoint) * 1000}`,
    transactionModule: 'offramp',
    type: `${ADDRESS}::ExecutionStateChanged`,
  })

  const commitEvent = (checkpoint: string, digest: string) => ({
    id: { txDigest: digest, eventSeq: '1' },
    packageId: PKG,
    parsedJson: { blessed_merkle_roots: [], unblessed_merkle_roots: [], price_updates: {} },
    sender: SENDER,
    timestampMs: `${Number(checkpoint) * 1000}`,
    transactionModule: 'offramp',
    type: `${ADDRESS}::CommitReportAccepted`,
  })

  type FakeServices = {
    latest?: () => string | Promise<string>
    eventsByType?: Record<string, unknown[]>
    /** Per-function scan pages (a tx targets exactly one execute function, so each fn walks its own result set). */
    scanPages?: Record<string, unknown[]>
    txMeta?: (digest: string) => { checkpoint: string; timestampMs: string; status: string }
    scanError?: Error
    multiGetShowEffects?: boolean
    /** When set, queryEvents always fails with the retention-boundary error (walk mode). */
    brokenQueryEvents?: boolean
    /** Checkpoint pages for walk mode, with the tx digests each carries. */
    checkpoints?: Array<{ sequenceNumber: string; timestampMs: string; transactions: string[] }>
    /** Events per tx digest, returned by multiGetTransactionBlocks (walk mode). */
    eventsByDigest?: Record<string, unknown[]>
  }

  function makeStreamClient(services: FakeServices) {
    const {
      latest = () => '103',
      eventsByType = {},
      scanPages = {},
      txMeta,
      scanError,
      multiGetShowEffects = true,
      brokenQueryEvents = false,
      checkpoints,
      eventsByDigest = {},
    } = services
    const queryEvents = mock.fn(async ({ query }: { query: { MoveEventType: string } }) => {
      if (brokenQueryEvents) throw new Error('Could not find the referenced transaction events')
      return {
        data: eventsByType[query.MoveEventType] ?? [],
        hasNextPage: false,
        nextCursor: null,
      }
    })
    const queryTransactionBlocks = mock.fn(
      async ({ filter }: { filter: { MoveFunction: { function: string } } }) => {
        if (scanError) throw scanError
        return {
          data: scanPages[filter.MoveFunction.function] ?? [],
          hasNextPage: false,
          nextCursor: null,
        }
      },
    )
    const multiGetTransactionBlocks = mock.fn(
      async ({ digests, options }: { digests: string[]; options?: { showEffects?: boolean } }) =>
        digests.map((digest) => {
          if (!txMeta) return { digest }
          return {
            digest,
            checkpoint: txMeta(digest).checkpoint,
            timestampMs: txMeta(digest).timestampMs,
            ...(options?.showEffects || multiGetShowEffects
              ? { effects: { status: { status: txMeta(digest).status } } }
              : {}),
            ...(eventsByDigest[digest] ? { events: eventsByDigest[digest] } : {}),
          }
        }),
    )
    const client = {
      getObject: mock.fn(async () => {
        throw new Error('no such object')
      }),
      getOwnedObjects: mock.fn(async () => {
        throw new Error('no such object')
      }),
      getLatestCheckpointSequenceNumber: mock.fn(latest),
      ...(checkpoints && {
        getCheckpoints: mock.fn(async () => ({
          data: checkpoints.map(({ sequenceNumber, timestampMs, transactions }) => ({
            sequenceNumber,
            timestampMs,
            transactions,
          })),
          hasNextPage: false,
          nextCursor: null,
        })),
      }),
      queryEvents,
      queryTransactionBlocks,
      multiGetTransactionBlocks,
      getTransactionBlock: mock.fn(async () => ({})),
    } as unknown as SuiJsonRpcClient
    return { client, queryEvents, queryTransactionBlocks, multiGetTransactionBlocks }
  }

  it('merges synthetic failures with successes in ascending order and suppresses stale success markers', async () => {
    // TX_BAD failed but its PTB left an ExecutionStateChanged(state=2) event:
    // the event path must not report it, the failure scan must
    const { client } = makeStreamClient({
      txMeta: (digest) =>
        digest === '0xTXBAD'
          ? { checkpoint: '101', timestampMs: '101000', status: 'failure' }
          : { checkpoint: '102', timestampMs: '102000', status: 'success' },
      eventsByType: {
        [`${ADDRESS}::ExecutionStateChanged`]: [
          successEvent('102', '0xTXOK', '2'),
          successEvent('101', '0xTXBAD', '1'), // stale success marker of the failed PTB
        ],
      },
      scanPages: {
        // below-floor block proves the descending walk stops, not pages forever
        init_execute: [
          failureBlock({ digest: '0xTXFAIL', checkpoint: '101' }),
          failureBlock({ digest: '0xTXOLD', checkpoint: '99' }),
        ],
        manually_init_execute: [],
      },
    })
    const chain = new SuiChain(client, network)
    const logs = await collect(
      chain.getLogs({
        address: ADDRESS,
        topics: ['ExecutionStateChanged'],
        startBlock: 100,
        endBlock: 102,
      }),
    )
    assert.deepEqual(
      logs.map((l) => [l.blockNumber, l.transactionHash]),
      [
        [101, '0xTXFAIL'],
        [102, '0xTXOK'],
      ],
      'stale success marker suppressed; failure merged ascending',
    )
    const failure = logs[0]!
    assert.equal(failure.index, 0)
    assert.deepEqual(failure.topics, ['ExecutionStateChanged'])
    assert.equal((failure.data as Record<string, unknown>).state, ExecutionState.Failed)
    assert.equal((failure.data as Record<string, unknown>).message_id, MESSAGE_ID)
    assert.equal(failure.blockTimestamp, 101)
  })

  it('keeps multi-topic streams globally ascending with failures interleaved', async () => {
    const { client } = makeStreamClient({
      eventsByType: {
        [`${ADDRESS}::CommitReportAccepted`]: [commitEvent('100', '0xTXCOMMIT')],
        [`${ADDRESS}::ExecutionStateChanged`]: [successEvent('102', '0xTXOK', '1')],
      },
      scanPages: {
        init_execute: [failureBlock({ digest: '0xTXFAIL', checkpoint: '101' })],
        manually_init_execute: [],
      },
      txMeta: (digest) =>
        digest === '0xTXOK'
          ? { checkpoint: '102', timestampMs: '102000', status: 'success' }
          : { checkpoint: '100', timestampMs: '100000', status: 'success' },
    })
    const chain = new SuiChain(client, network)
    const logs = await collect(
      chain.getLogs({
        address: ADDRESS,
        topics: ['CommitReportAccepted', 'ExecutionStateChanged'],
        startBlock: 100,
        endBlock: 102,
      }),
    )
    assert.deepEqual(
      logs.map((l) => [l.blockNumber, l.topics[0], l.transactionHash]),
      [
        [100, 'CommitReportAccepted', '0xTXCOMMIT'],
        [101, 'ExecutionStateChanged', '0xTXFAIL'],
        [102, 'ExecutionStateChanged', '0xTXOK'],
      ],
    )
  })

  it('keeps scanning for failures in walkMode (queryEvents retention failure)', async () => {
    // The deprecated queryEvents API is broken on retention boundaries: the
    // stream falls back to the checkpoint walk — which only sees events, so
    // without the failure scan failed executions would be silently skipped.
    const { client } = makeStreamClient({
      brokenQueryEvents: true,
      checkpoints: [
        { sequenceNumber: '101', timestampMs: '101000', transactions: ['0xTXBAD', '0xTXFAIL'] },
      ],
      eventsByDigest: {
        // stale success marker of the failed PTB — suppressed, not re-reported
        '0xTXBAD': [successEvent('101', '0xTXBAD', '1')],
      },
      scanPages: {
        init_execute: [failureBlock({ digest: '0xTXFAIL', checkpoint: '101' })],
        manually_init_execute: [],
      },
      txMeta: (digest) =>
        digest === '0xTXOK'
          ? { checkpoint: '102', timestampMs: '102000', status: 'success' }
          : { checkpoint: '101', timestampMs: '101000', status: 'failure' },
    })
    const chain = new SuiChain(client, network)
    const logs = await collect(
      chain.getLogs({
        address: ADDRESS,
        topics: ['ExecutionStateChanged'],
        startBlock: 100,
        endBlock: 102,
      }),
    )
    assert.deepEqual(
      logs.map((l) => [l.blockNumber, l.transactionHash, l.index]),
      [[101, '0xTXFAIL', 0]],
      'the failure scan runs in walkMode; the stale success marker stays suppressed',
    )
  })

  it('surfaces a watch-mode failure committed after the stream started', async () => {
    let tip = 102
    let scanCalls = 0
    const { client } = makeStreamClient({
      latest: () => String(tip),
      eventsByType: {
        [`${ADDRESS}::ExecutionStateChanged`]: [successEvent('102', '0xTXOK', '1')],
      },
      scanPages: {},
      txMeta: (digest) =>
        digest === '0xTXOK'
          ? { checkpoint: '102', timestampMs: '102000', status: 'success' }
          : { checkpoint: '103', timestampMs: '103000', status: 'failure' },
    })
    // Round 1: no failures visible; round 2 (tip advanced) the failed tx is
    // checkpointed and the descending scan finds it. Each execute function
    // walks its own pagination, so only the init_execute walk finds it.
    ;(
      client.queryTransactionBlocks as unknown as ReturnType<typeof mock.fn>
    ).mock.mockImplementation(
      async ({ filter }: { filter: { MoveFunction: { function: string } } }) => {
        scanCalls++
        if (scanCalls <= 2) return { data: [], hasNextPage: false, nextCursor: null }
        if (filter.MoveFunction.function === 'manually_init_execute') {
          return { data: [], hasNextPage: false, nextCursor: null }
        }
        return {
          data: [failureBlock({ digest: '0xTXFAIL', checkpoint: '103' })],
          hasNextPage: false,
          nextCursor: null,
        }
      },
    )
    const chain = new SuiChain(client, network)
    const ac = new AbortController()
    // the node's tip advances while the stream is watching
    const advance = setTimeout(() => {
      tip = 103
    }, 30)
    const logs = await collect(
      chain.getLogs({
        address: ADDRESS,
        topics: ['ExecutionStateChanged'],
        startBlock: 101,
        watch: AbortSignal.any([ac.signal, AbortSignal.timeout(500)]),
        pollInterval: 20,
      }),
    )
    clearTimeout(advance)
    ac.abort()
    assert.deepEqual(
      logs.map((l) => [l.blockNumber, l.transactionHash, (l.data as { state: number }).state]),
      [
        [102, '0xTXOK', 2],
        [103, '0xTXFAIL', ExecutionState.Failed],
      ],
    )
  })

  it('degrades to successes-only streaming with a one-time warning when the scan is unavailable', async () => {
    const warnings: string[] = []
    const { client } = makeStreamClient({
      scanError: new Error('rate limited'),
      eventsByType: {
        [`${ADDRESS}::ExecutionStateChanged`]: [successEvent('101', '0xTXOK', '1')],
      },
      txMeta: () => ({ checkpoint: '101', timestampMs: '101000', status: 'success' }),
    })
    const chain = new SuiChain(client, network, {
      logger: { warn: (msg: string) => warnings.push(msg) } as never,
    })
    const logs = await collect(
      chain.getLogs({
        address: ADDRESS,
        topics: ['ExecutionStateChanged'],
        startBlock: 100,
        endBlock: 101,
      }),
    )
    assert.equal(logs.length, 1)
    assert.equal(logs[0]!.transactionHash, '0xTXOK')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /failure scan is unavailable|failure-scan is unavailable/)
  })
})

describe('SuiChain.getTransaction failure reconstruction', () => {
  const successEvent = {
    id: { txDigest: '0xTX', eventSeq: '0' },
    packageId: PKG,
    parsedJson: { message_id: MESSAGE_ID, state: 2 },
    sender: SENDER,
    timestampMs: '101000',
    transactionModule: 'offramp',
    type: `${ADDRESS}::ExecutionStateChanged`,
  }

  function makeChain(getTransactionBlock: unknown) {
    const client = {
      getTransactionBlock: mock.fn(async () => getTransactionBlock),
    } as unknown as SuiJsonRpcClient
    return new SuiChain(client, network)
  }

  it('replaces stale success markers with the synthetic failure log and decodes tx.error', async () => {
    const chain = makeChain({
      digest: '0xTX',
      checkpoint: '101',
      timestampMs: '101000',
      events: [successEvent],
      effects: {
        status: { status: 'failure', error: ABORT_OFFRAMP },
        gasUsed: {
          computationCost: '1000',
          storageCost: '200',
          storageRebate: '100',
          nonRefundableStorageFee: '0',
        },
      },
      transaction: failureBlock().transaction,
    })
    const tx = await chain.getTransaction('0xTX')
    assert.equal(tx.hash, '0xTX')
    assert.equal(tx.blockNumber, 101)
    assert.equal(tx.from, SENDER)
    assert.equal(tx.logs.length, 1, 'the stale success marker is not reported as a success')
    const failure = tx.logs[0]!
    assert.equal(failure.index, 0)
    assert.equal((failure.data as Record<string, unknown>).state, ExecutionState.Failed)
    assert.deepEqual(
      tx.error as Record<string, unknown>,
      {
        effectsStatus: ABORT_OFFRAMP,
        function: 'manually_init_execute',
        location: '0x' + 'ab'.repeat(32) + '::offramp',
        functionIndex: 8n,
        instruction: 12n,
        abortCode: 9n,
        destChainSelector: DEST_SELECTOR,
        gasUsed: 1100n,
      },
      'camelCased like decodeReceipt, digit strings bigint-ified',
    )
  })

  it('leaves successful transactions untouched', async () => {
    const chain = makeChain({
      digest: '0xTXOK',
      checkpoint: '102',
      timestampMs: '102000',
      events: [successEvent],
      effects: { status: { status: 'success' } },
      transaction: failureBlock().transaction,
    })
    const tx = await chain.getTransaction('0xTXOK')
    assert.equal(tx.error, undefined)
    assert.equal(tx.logs.length, 1)
    assert.equal((tx.logs[0]!.data as { state: number }).state, 2)
  })

  it('decodes the synthetic failure into a state=3 receipt with error via getExecutionReceiptsInTx', async () => {
    const chain = makeChain({
      digest: '0xTX',
      checkpoint: '101',
      timestampMs: '101000',
      effects: {
        status: { status: 'failure', error: ABORT_OFFRAMP },
        gasUsed: {
          computationCost: '1000',
          storageCost: '200',
          storageRebate: '100',
          nonRefundableStorageFee: '0',
        },
      },
      transaction: failureBlock().transaction,
    })
    // The CLI's `show <messageId>` path filters by the API's bare-package
    // `offramp` (no `::offramp` module suffix) — the synthetic log's address
    // must match it, exactly like real event logs do.
    const execs = await chain.getExecutionReceiptsInTx('0xTX', { offRamp: PKG })
    assert.equal(execs.length, 1)
    assert.equal(execs[0]!.receipt.state, ExecutionState.Failed)
    assert.equal(execs[0]!.receipt.messageId, MESSAGE_ID)
    assert.equal(execs[0]!.receipt.sequenceNumber, 7n)
    assert.equal(execs[0]!.receipt.gasUsed, 1100n)
    assert.deepEqual(execs[0]!.error, execs[0]!.receipt.returnData)
  })

  it('matches the offRamp filter in every caller form (short, padded, module)', async () => {
    // a package id with a leading zero nibble: its SHORT form differs from the
    // node's padded log-address form, like the real offramp's does
    const padded = '0x0' + '7'.repeat(63)
    const short = '0x' + '7'.repeat(63)
    const block = structuredClone(failureBlock()) as FailureBlock & {
      transaction: NonNullable<FailureBlock['transaction']> & {
        data: { transaction: { transactions: { MoveCall: { package: string } }[] } }
      }
    }
    block.transaction.data.transaction.transactions[0]!.MoveCall.package = short
    const chain = makeChain(block)
    // the API / decoded messages carry the short form, discovery the padded
    // module form; the node's log addresses are full padded package ids
    for (const offRamp of [short, padded, `${padded}::offramp`]) {
      const execs = await chain.getExecutionReceiptsInTx('0xTXFAIL', { offRamp })
      assert.equal(execs.length, 1, `offRamp ${offRamp} should match`)
      assert.equal(execs[0]!.receipt.state, ExecutionState.Failed)
    }
  })

  it('decodes the synthetic log via SuiChain.decodeReceipt', () => {
    const receipt = SuiChain.decodeReceipt(getSuiExecutionFailureLog(failureBlock())!)
    assert.equal(receipt!.state, ExecutionState.Failed)
    assert.equal(receipt!.messageId, MESSAGE_ID)
    assert.equal(receipt!.sequenceNumber, 7n)
    assert.equal(receipt!.sourceChainSelector, SELECTOR)
    assert.equal(receipt!.messageHash, undefined)
    assert.equal(receipt!.gasUsed, 1100n)
    assert.deepEqual(
      receipt!.returnData,
      {
        effectsStatus: ABORT_OFFRAMP,
        function: 'manually_init_execute',
        location: '0x' + 'ab'.repeat(32) + '::offramp',
        functionIndex: 8n,
        instruction: 12n,
        abortCode: 9n,
        destChainSelector: DEST_SELECTOR,
        gasUsed: 1100n,
      },
      'camelCase+bigint, like tx.error and every other family',
    )
  })

  it('matches the offRamp filter for SUCCESSFUL receipts in every caller form', async () => {
    // regression: real event logs are `<package>::<module>` (Move event types are
    // `<package>::<module>::<Struct>`), so normalizing only the filter — or only
    // to a bare package id — silently dropped every successful receipt
    const padded = '0x0' + '7'.repeat(63)
    const short = '0x' + '7'.repeat(63)
    const chain = makeChain({
      digest: '0xTXOK',
      checkpoint: '101',
      timestampMs: '101000',
      events: [
        {
          type: `${padded}::offramp::ExecutionStateChanged`,
          parsedJson: {
            message_id: MESSAGE_ID,
            message_hash: '0x' + 'cd'.repeat(32),
            sequence_number: '7',
            source_chain_selector: SELECTOR.toString(),
            state: 2,
          },
        },
      ],
      effects: { status: { status: 'success' } },
    })
    for (const offRamp of [short, padded, `${padded}::offramp`, `${short}::offramp`]) {
      const execs = await chain.getExecutionReceiptsInTx('0xTXOK', { offRamp })
      assert.equal(execs.length, 1, `offRamp ${offRamp} should match`)
      assert.equal(execs[0]!.receipt.state, ExecutionState.Success)
    }
  })
})
