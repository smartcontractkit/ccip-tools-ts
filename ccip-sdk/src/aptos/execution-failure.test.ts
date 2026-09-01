/** Tests for reconstructing failed Aptos execution receipts from user transactions. */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import {
  type Aptos,
  type Client,
  type ClientRequest,
  type UserTransactionResponse,
  AptosConfig,
  Network,
  TransactionResponseType,
} from '@aptos-labs/ts-sdk'
import { hexlify } from 'ethers'

import { networkInfo } from '../networks.ts'
import { type ChainLog, ExecutionState } from '../types.ts'
import { getAptosExecutionFailureLog, streamAptosLogs } from './logs.ts'
import { ExecutionReportCodec } from './types.ts'
import { AptosChain } from './index.ts'

const ADDRESS = '0xcafe::offramp'
const TX_HASH = `0x${'1'.repeat(64)}`
const VM_STATUS = `Move abort in ${ADDRESS}: code 65537`
const MESSAGE_ID = `0x${Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('')}`

const REPORT = hexlify(
  ExecutionReportCodec.serialize({
    sourceChainSelector: 123n,
    messageId: Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)),
    headerSourceChainSelector: 123n,
    destChainSelector: 456n,
    sequenceNumber: 7n,
    nonce: 0n,
    sender: Uint8Array.from([1, 2]),
    data: Uint8Array.from([3]),
    receiver: Uint8Array.from(Array(32).fill(4)),
    gasLimit: 100n,
    tokenAmounts: [],
    offchainTokenData: [],
    proofs: [],
  }).toBytes(),
)

function failedTransaction(
  functionName = `${ADDRESS}::manually_execute`,
  args: unknown[] = [REPORT],
): UserTransactionResponse {
  return {
    type: TransactionResponseType.User,
    version: '100',
    hash: TX_HASH,
    state_change_hash: '0x0',
    event_root_hash: '0x0',
    state_checkpoint_hash: null,
    gas_used: '42',
    success: false,
    vm_status: VM_STATUS,
    accumulator_root_hash: '0x0',
    changes: [],
    sender: '0x1',
    sequence_number: '0',
    replay_protection_nonce: '0',
    max_gas_amount: '1000',
    gas_unit_price: '1',
    expiration_timestamp_secs: '1000',
    payload: {
      type: 'entry_function_payload',
      function: functionName,
      type_arguments: [],
      arguments: args,
    },
    events: [],
    timestamp: '100000000',
  } as unknown as UserTransactionResponse
}

/** A committed, successful, non-CCIP user transaction — fills ledger versions the scan walks past. */
function fillerTransaction(version: number): Record<string, unknown> {
  return {
    type: TransactionResponseType.User,
    version: String(version),
    hash: `0x${version.toString(16).padStart(64, '0')}`,
    timestamp: `${version}000000`,
    success: true,
    vm_status: 'Executed successfully',
    gas_used: '1',
    sender: '0x1',
    payload: {
      type: 'entry_function_payload',
      function: '0x1::aptos_account::transfer',
      type_arguments: [],
      arguments: [],
    },
    events: [],
  }
}

function providerFor(tx: UserTransactionResponse) {
  const calls: number[] = []
  const getTransactions = mock.fn(async ({ options }: { options?: { offset?: number } }) => {
    const offset = Number(options?.offset ?? 0)
    calls.push(offset)
    return offset <= Number(tx.version) ? [tx] : []
  })
  const provider = {
    getTransactions,
    getLedgerInfo: async () => ({ ledger_version: tx.version }),
    getTransactionByVersion: async () => tx,
    getTransactionByHash: async () => tx,
  } as unknown as Aptos
  return { provider, calls }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

/** A Logger capturing `warn` calls, for degradation-warning assertions. */
function capturingLogger(warnings: string[]) {
  return {
    debug: () => {},
    info: () => {},
    warn: (message: unknown) => {
      warnings.push(String(message))
    },
    error: () => {},
  }
}

/**
 * An event-handle-capable provider backed by a fake fullnode `Client` (the shape
 * used by logs.test.ts) plus a fake `queryIndexer` serving the two GraphQL
 * documents the failure scan issues: the per-contract `user_transactions`
 * candidate query and the `processor_status` ingested-tip query. The `/transactions`
 * REST route remains for the un-indexed tail walk. A mutable ledger tip and an
 * `onLedgerInfo` hook let watch tests "commit" new versions between poll rounds;
 * `indexerTip`/`noIndexer` shape the indexer's view of the same world.
 */
function handleProvider(world: {
  events?: Record<
    string,
    { version: string; sequence_number: string; type: string; data: unknown }[]
  >
  txs?: Record<string, unknown>[]
  ledgerVersion?: number | string
  /** The indexer's ingested tip; defaults to the ledger version (fully caught up). */
  indexerTip?: number
  /** Omit queryIndexer entirely: the failure scan degrades with a warning. */
  noIndexer?: boolean
  onLedgerInfo?: () => void
  txRequests?: { start: number; limit: number }[]
  indexerQueries?: { where: unknown; limit: number }[]
}) {
  const events = world.events ?? {}
  const txs = world.txs ?? []
  const txRequests = world.txRequests
  const indexerQueries = world.indexerQueries
  const client: Client = {
    async provider<Req, Res>(req: ClientRequest<Req>) {
      const url = decodeURIComponent(req.url)
      const params = (req.params ?? {}) as { start?: number; limit?: number }
      if (url.endsWith('/transactions')) {
        const start = Number(params.start ?? 0)
        const limit = Number(params.limit ?? 100)
        txRequests?.push({ start, limit })
        const page = txs
          .map((tx) => ({ tx, version: Number(tx.version) }))
          .filter(({ version }) => version >= start && version < start + limit)
          .sort((left, right) => left.version - right.version)
          .map(({ tx }) => tx)
        return {
          status: 200,
          statusText: 'OK',
          data: page as unknown as Res,
          headers: {},
          config: req,
          request: null,
          response: null,
        }
      }
      for (const [suffix, data] of Object.entries(events)) {
        if (url.includes(suffix)) {
          const start = params.start
          const limit = params.limit ?? 100
          const page =
            start == null
              ? data.slice(Math.max(data.length - limit, 0))
              : data.slice(start, start + limit)
          return {
            status: 200,
            statusText: 'OK',
            data: page as unknown as Res,
            headers: {},
            config: req,
            request: null,
            response: null,
          }
        }
      }
      throw new Error(`unmocked Aptos fullnode request: ${url}`)
    },
  }
  const config = new AptosConfig({
    network: Network.MAINNET,
    fullnode: 'https://fake.aptos.internal',
    client,
  })
  // Mirrors the indexer's user_transactions row: a user tx calling
  // `<package>::<module>::<function>` at `version`, filtered by the where-clause's
  // version range and contract/module/function conditions (canonical long-form
  // contract address, exactly like the processors write it).
  const isIndexedCandidate = (tx: Record<string, unknown>, where: Record<string, any>) => {
    if (tx.type !== TransactionResponseType.User) return false
    const fn = (tx.payload as { function?: string } | undefined)?.function ?? ''
    const [pkg, module, fun] = fn.split('::')
    const long = pkg ? `0x${pkg.replace(/^0x/, '').padStart(64, '0')}`.toLowerCase() : undefined
    const version = Number(tx.version)
    const range = where.version ?? {}
    if (version < Number(range._gte ?? 0) || version >= Number(range._lt ?? Infinity)) return false
    if (long !== (where.entry_function_contract_address ?? {})._eq) return false
    if (module !== (where.entry_function_module_name ?? {})._eq) return false
    const names = (where.entry_function_function_name ?? {})._in as string[] | undefined
    if (names && (fun == null || !names.includes(fun))) return false
    return true
  }
  const provider = {
    config,
    view: mock.fn(async () => ['0xstate']),
    getLedgerInfo: mock.fn(async () => {
      world.onLedgerInfo?.()
      return { ledger_version: String(world.ledgerVersion ?? 0) }
    }),
    getTransactionByVersion: mock.fn(async ({ ledgerVersion }: { ledgerVersion: number }) => {
      const tx = txs.find((tx) => Number(tx.version) === ledgerVersion)
      if (tx) return tx
      // Fallback stub for lookups the world has no tx for (event blockTimestamps).
      return {
        type: 'user_transaction',
        hash: `0xhash${ledgerVersion}`,
        timestamp: `${ledgerVersion}000000`,
      }
    }),
    ...(world.noIndexer
      ? {}
      : {
          queryIndexer: mock.fn(
            async ({ query }: { query: { query: string; variables?: unknown } }) => {
              if (query.query.includes('processor_status')) {
                return {
                  processor_status: [
                    { last_success_version: String(world.indexerTip ?? world.ledgerVersion ?? 0) },
                  ],
                }
              }
              if (query.query.includes('user_transactions')) {
                const { where, limit } = query.variables as {
                  where: Record<string, any>
                  limit: number
                }
                indexerQueries?.push({ where, limit })
                const matches = txs
                  .filter((tx) => isIndexedCandidate(tx, where))
                  .sort((left, right) => Number(left.version) - Number(right.version))
                  .slice(0, limit)
                return { user_transactions: matches.map((tx) => ({ version: String(tx.version) })) }
              }
              throw new Error(`unmocked indexer query: ${query.query.slice(0, 60)}`)
            },
          ),
        }),
  } as unknown as Aptos
  return provider
}

const successEventAt = (version: number, sequenceNumber: number, data = {}) => ({
  version: String(version),
  sequence_number: String(sequenceNumber),
  type: `${ADDRESS}::ExecutionStateChanged`,
  data: {
    message_id: MESSAGE_ID,
    sequence_number: '7',
    source_chain_selector: '123',
    state: ExecutionState.Success,
    ...data,
  },
})

describe('Aptos failed execution reconstruction', () => {
  it('emits a failed synthetic log for manually_execute without consulting event handles', async () => {
    const { provider, calls } = providerFor(failedTransaction())
    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 100,
          versionAsHash: true,
        },
      ),
    )

    assert.equal(logs.length, 1)
    assert.deepEqual(calls, [100])
    assert.equal(logs[0]!.transactionHash, '100')
    assert.equal(logs[0]!.index, 0)
    const receipt = AptosChain.decodeReceipt(logs[0]!)
    assert.ok(receipt)
    assert.equal(receipt.messageId, MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, 7n)
    assert.equal(receipt.sourceChainSelector, 123n)
    assert.equal(receipt.state, ExecutionState.Failed)
    assert.equal(receipt.gasUsed, 42n)
    const returnData = receipt.returnData as Record<string, unknown>
    assert.equal(returnData.vmStatus, VM_STATUS)
    assert.equal(returnData.location, ADDRESS)
    assert.equal(returnData.abortCode, 65537n)
  })

  it('finds the report after proof arguments used by execute', async () => {
    const tx = failedTransaction(`${ADDRESS}::execute`, [[`0x${'aa'.repeat(32)}`, '0x01'], REPORT])
    const { provider } = providerFor(tx)
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const execution = await chain.getExecutionReceiptInTx(TX_HASH)

    assert.equal(execution.receipt.state, ExecutionState.Failed)
    assert.equal(execution.receipt.messageId, MESSAGE_ID)
    assert.equal(execution.receipt.sequenceNumber, 7n)
    assert.equal(execution.receipt.gasUsed, 42n)
    const error = execution.error as Record<string, unknown>
    assert.equal(error.vmStatus, VM_STATUS)
    assert.equal(error.abortCode, 65537n)
  })

  it('follows multisig payloads one level down to find the report', async () => {
    const inner = failedTransaction()
    const tx = {
      ...inner,
      payload: {
        type: 'multisig_payload',
        multisig_address: '0x1',
        transaction_payload: inner.payload,
      },
    } as UserTransactionResponse
    const { provider } = providerFor(tx)
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const execution = await chain.getExecutionReceiptInTx(TX_HASH)

    assert.equal(execution.receipt.state, ExecutionState.Failed)
    assert.equal(execution.receipt.messageId, MESSAGE_ID)
  })

  it('follows multisig payloads one level down to find the report', async () => {
    const inner = failedTransaction()
    const tx = {
      ...inner,
      payload: {
        type: 'multisig_payload',
        multisig_address: '0x1',
        transaction_payload: inner.payload,
      },
    } as UserTransactionResponse
    const { provider } = providerFor(tx)
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const execution = await chain.getExecutionReceiptInTx(TX_HASH)

    assert.equal(execution.receipt.state, ExecutionState.Failed)
    assert.equal(execution.receipt.messageId, MESSAGE_ID)
  })

  it('returns failed receipts from getExecutionReceipts and preserves the VM error', async () => {
    const { provider } = providerFor(failedTransaction())
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const executions = await collect(
      chain.getExecutionReceipts({
        offRamp: ADDRESS,
        messageId: MESSAGE_ID,
        sourceChainSelector: 123n,
        startBlock: 100,
      }),
    )

    assert.equal(executions.length, 1)
    assert.equal(executions[0]!.receipt.state, ExecutionState.Failed)
    assert.equal((executions[0]!.error as Record<string, unknown>).vmStatus, VM_STATUS)
  })

  it('emits a bare-address synthetic log and matches the offRamp filter in every caller form', async () => {
    // the default (no address) — e.g. getTransaction: the log's address is the
    // OffRamp's bare address, exactly like real event logs' (event types prefix
    // with it) — so getExecutionReceiptsInTx filters match failures like successes
    const log = getAptosExecutionFailureLog(failedTransaction())
    assert.ok(log)
    assert.equal(log.address, '0xcafe', 'bare address, like real event logs')

    // callers pass the filter in several forms: bare (the API's offramp / decoded
    // messages), case-variant, and the SDK-discovery module form
    const { provider } = providerFor(failedTransaction())
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const pkg = ADDRESS.slice(0, ADDRESS.lastIndexOf('::'))
    for (const offRamp of [pkg, pkg.toUpperCase(), ADDRESS]) {
      const executions = await chain.getExecutionReceiptsInTx(TX_HASH, {
        offRamp,
        messageId: MESSAGE_ID,
      })
      assert.equal(executions.length, 1, `offRamp ${offRamp} should match`)
      assert.equal(executions[0]!.receipt.state, ExecutionState.Failed)
    }
  })

  it('keeps successful execution events on the transaction-backed path', async () => {
    const tx = failedTransaction()
    tx.success = true
    tx.vm_status = 'Executed successfully'
    tx.events = [
      {
        type: `${ADDRESS}::ExecutionStateChanged`,
        sequence_number: '9',
        data: {
          message_id: MESSAGE_ID,
          sequence_number: '7',
          source_chain_selector: '123',
          state: ExecutionState.Success,
        },
      },
    ] as never
    const { provider } = providerFor(tx)
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const executions = await collect(
      chain.getExecutionReceipts({
        offRamp: ADDRESS,
        messageId: MESSAGE_ID,
        sourceChainSelector: 123n,
        startBlock: 100,
      }),
    )

    assert.equal(executions.length, 1)
    assert.equal(executions[0]!.receipt.state, ExecutionState.Success)
    assert.equal(executions[0]!.receipt.sequenceNumber, 7n)
  })

  it('never surfaces an already-executed skip (SkippedAlreadyExecuted) as a failure', async () => {
    // The Aptos OffRamp handles the duplicate-attempt pattern at the contract
    // level, unlike Sui: it emits SkippedAlreadyExecuted and RETURNS, so the
    // transaction SUCCEEDS (transmit has no duplicate-report guard) and the
    // failure reconstruction is unreachable — no state=3 receipt can surface
    // for a report whose message was already executed.
    const tx = failedTransaction()
    tx.success = true
    tx.vm_status = 'Executed successfully'
    tx.events = [
      {
        type: `${ADDRESS}::SkippedAlreadyExecuted`,
        sequence_number: '10',
        data: { source_chain_selector: '123', sequence_number: '7' },
      },
    ] as never
    assert.equal(getAptosExecutionFailureLog(tx), undefined)
    const { provider } = providerFor(tx)
    const chain = new AptosChain(provider, networkInfo('aptos:2'))
    const executions = await collect(
      chain.getExecutionReceipts({
        offRamp: ADDRESS,
        messageId: MESSAGE_ID,
        sourceChainSelector: 123n,
        startBlock: 100,
      }),
    )
    assert.equal(executions.length, 0)
  })

  it('merges synthetic failures with event-handle successes without changing success indexes', async () => {
    const provider = handleProvider({
      events: { execution_state_changed_events: [successEventAt(101, 9)] },
      txs: [failedTransaction(), fillerTransaction(101)],
      ledgerVersion: 101,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 101,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index, log.topics[0]]),
      [
        [100, 0, 'ExecutionStateChanged'],
        [101, 9, 'ExecutionStateChanged'],
      ],
      'the failure merges in ascending order; success logs keep their handle sequence number as index',
    )
  })

  it('merges synthetic failures into multi-topic streams in globally ascending order', async () => {
    const failed = failedTransaction()
    failed.version = '101'
    const provider = handleProvider({
      events: {
        commit_report_accepted_events: [
          {
            version: '100',
            sequence_number: '0',
            type: `${ADDRESS}::CommitReportAccepted`,
            data: { blessed_merkle_roots: [], unblessed_merkle_roots: [] },
          },
        ],
        execution_state_changed_events: [successEventAt(102, 9)],
      },
      txs: [fillerTransaction(100), failed, fillerTransaction(102)],
      ledgerVersion: 102,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['CommitReportAccepted', 'ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 102,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index, log.topics[0]]),
      [
        [100, 0, 'CommitReportAccepted'],
        [101, 0, 'ExecutionStateChanged'],
        [102, 9, 'ExecutionStateChanged'],
      ],
      'commit event, synthetic failure and execution success interleave by version',
    )
  })

  it('surfaces a watch-mode failure committed after the stream started, with no success event to unblock it', async () => {
    // Regression: a naive merge of the event stream with the failure scan blocks
    // on the event stream's idle poll wait, withholding the failure until some
    // unrelated success arrives. Here the ONLY logs are one success (round 1) and
    // one failure committed between rounds — the failure must still come out.
    const failed = failedTransaction()
    failed.version = '102'
    const world: Parameters<typeof handleProvider>[0] & { ledgerInfos: number } = {
      events: { execution_state_changed_events: [successEventAt(101, 9)] },
      txs: [fillerTransaction(101)],
      ledgerVersion: 101,
      ledgerInfos: 0,
      onLedgerInfo() {
        // "Commit" the failed execution once the failure scan re-resolves its tip
        // for a later poll round (the first resolution happens at stream start).
        if (world.ledgerInfos++ >= 1) {
          world.txs!.push(failed)
          world.ledgerVersion = 102
        }
      },
    }
    const provider = handleProvider(world)

    const ac = new AbortController()
    const logs: ChainLog[] = []
    for await (const log of streamAptosLogs(
      { provider },
      {
        address: ADDRESS,
        topics: ['ExecutionStateChanged'],
        startBlock: 100,
        watch: AbortSignal.any([ac.signal, AbortSignal.timeout(1000)]),
        pollInterval: 10,
        versionAsHash: true,
      },
    )) {
      logs.push(log)
      if (log.index === 0) ac.abort()
    }

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index]),
      [
        [101, 9],
        [102, 0],
      ],
      'the late-committed failure must surface on its own — not wait for a success event',
    )
    const receipt = AptosChain.decodeReceipt(logs[1]!)
    assert.ok(receipt)
    assert.equal(receipt.state, ExecutionState.Failed)
    assert.equal(receipt.messageId, MESSAGE_ID)
  })

  it('resumes strictly past a synthetic-failure hint', async () => {
    const provider = handleProvider({
      events: { execution_state_changed_events: [successEventAt(101, 9)] },
      txs: [failedTransaction(), fillerTransaction(101)],
      ledgerVersion: 101,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 101,
          versionAsHash: true,
          since: {
            address: ADDRESS,
            topics: ['ExecutionStateChanged'],
            index: 0,
            blockNumber: 100,
            transactionHash: '100',
          },
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index]),
      [[101, 9]],
      'the hinted failure is not re-emitted and the hinted version is not re-scanned',
    )
  })

  it('resumes a success-event hint by handle seq while the failure scan floors at the next version', async () => {
    const failed = failedTransaction()
    failed.version = '102'
    const provider = handleProvider({
      events: { execution_state_changed_events: [successEventAt(101, 9)] },
      txs: [fillerTransaction(101), failed],
      ledgerVersion: 102,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 102,
          versionAsHash: true,
          since: {
            address: ADDRESS,
            topics: ['ExecutionStateChanged'],
            index: 9,
            blockNumber: 101,
            transactionHash: '101',
          },
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index]),
      [[102, 0]],
      'the hinted success is not re-emitted, and the failure strictly after it is not skipped',
    )
  })

  it('positions a startTime-only scan past the timestamp boundary before scanning', async () => {
    const failed = failedTransaction()
    failed.version = '101'
    failed.timestamp = '101000000'
    const provider = handleProvider({
      events: { execution_state_changed_events: [] },
      txs: [fillerTransaction(100), failed],
      ledgerVersion: 101,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startTime: 100.5,
          endBlock: 101,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => log.blockNumber),
      [101],
      'startTime alone satisfies the start requirement; the scan is positioned by a version binary search, not walked from zero',
    )
  })

  it('pages indexer candidates past a full page without losing later failures', async () => {
    const failed = failedTransaction(`${ADDRESS}::execute`, [
      [`0x${'aa'.repeat(32)}`, '0x01'],
      REPORT,
    ])
    failed.version = '250'
    failed.timestamp = '250000000'
    // 150 successful execute calls (no logs of their own) force candidate
    // pagination: the first 100-row page is FULL, so the failure at 250 only
    // surfaces from the second page.
    const offRampCalls = Array.from({ length: 150 }, (_, i) => ({
      ...fillerTransaction(i + 1),
      payload: {
        type: 'entry_function_payload',
        function: `${ADDRESS}::execute`,
        type_arguments: [],
        arguments: [],
      },
    }))
    const indexerQueries: { where: Record<string, any>; limit: number }[] = []
    const provider = handleProvider({
      events: { execution_state_changed_events: [] },
      txs: [...offRampCalls, failed],
      ledgerVersion: 250,
      indexerQueries,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 1,
          endBlock: 250,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index]),
      [[250, 0]],
      'the failure past a full candidate page is still found',
    )
    assert.deepEqual(
      indexerQueries.map((query) => query.where.version),
      [
        { _gte: 1, _lt: 251 },
        { _gte: 101, _lt: 251 },
      ],
      'the candidate cursor advances past a full page and re-queries the remainder',
    )
  })

  it('clamps a numeric endBlock past the tip: the indexer window is clamped and the stream still ends', async () => {
    const indexerQueries: { where: Record<string, any>; limit: number }[] = []
    const txRequests: { start: number; limit: number }[] = []
    const provider = handleProvider({
      // No events at all: the failure scan alone keeps the stream alive and must
      // still terminate without handle states.
      events: { execution_state_changed_events: [] },
      txs: Array.from({ length: 100 }, (_, i) => fillerTransaction(i + 1)),
      ledgerVersion: 100,
      txRequests,
      indexerQueries,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 1,
          endBlock: 500,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(logs, [])
    // The scan target clamps to the ledger tip (100): exactly one candidate query
    // covering [1, 101) — never a request past the tip, indexer or REST.
    assert.deepEqual(
      indexerQueries.map((query) => query.where.version),
      [{ _gte: 1, _lt: 101 }],
    )
    assert.deepEqual(txRequests, [])
  })

  it('walks the un-indexed tail via the fullnode when the indexer lags behind the ledger', async () => {
    const failed = failedTransaction()
    failed.version = '101'
    failed.timestamp = '101000000'
    const txRequests: { start: number; limit: number }[] = []
    const provider = handleProvider({
      events: { execution_state_changed_events: [] },
      txs: [fillerTransaction(100), failed, fillerTransaction(102)],
      ledgerVersion: 102,
      indexerTip: 100, // the execution at 101 is committed but not indexed yet
      txRequests,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 102,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index]),
      [[101, 0]],
      'the failure committed past the ingested tip is still found, via the bounded RPC tail walk',
    )
    // The tail request is range-clamped through the target — start 101, exactly the 2 remaining versions.
    assert.deepEqual(txRequests, [{ start: 101, limit: 2 }])
  })

  it('truncates with a warning when the indexer is too far behind the ledger to walk the tail', async () => {
    const failed = failedTransaction()
    failed.version = '15000'
    failed.timestamp = '15000000000'
    const txRequests: { start: number; limit: number }[] = []
    const warnings: string[] = []
    const provider = handleProvider({
      events: { execution_state_changed_events: [] },
      txs: [failed],
      ledgerVersion: 20000,
      indexerTip: 5000, // 15000 un-indexed versions — beyond the tail-walk budget
      txRequests,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider, logger: capturingLogger(warnings) },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 0,
          endBlock: 20000,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs,
      [],
      'the failure deep in the un-indexed tail is not surfaced by a one-shot scan',
    )
    assert.deepEqual(
      txRequests,
      [],
      'the whole-ledger walk is exactly what the indexer exists to avoid',
    )
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /truncated to the indexed prefix/)
  })

  it('skips failure detection with a warning when no indexer is available, still streaming successes', async () => {
    const warnings: string[] = []
    const provider = handleProvider({
      events: { execution_state_changed_events: [successEventAt(101, 9)] },
      txs: [failedTransaction(), fillerTransaction(101)],
      ledgerVersion: 101,
      noIndexer: true,
    })

    const logs = await collect(
      streamAptosLogs(
        { provider, logger: capturingLogger(warnings) },
        {
          address: ADDRESS,
          topics: ['ExecutionStateChanged'],
          startBlock: 100,
          endBlock: 101,
          versionAsHash: true,
        },
      ),
    )

    assert.deepEqual(
      logs.map((log) => [log.blockNumber, log.index]),
      [[101, 9]],
      'successes still stream from the event handles; only failure detection is degraded',
    )
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /Indexer v2/)
  })

  it('getExecutionReceipts surfaces a failed execution with decoded VM error via the event-handle provider', async () => {
    const failed = failedTransaction()
    failed.version = '101'
    failed.timestamp = '101000000'
    const provider = handleProvider({
      events: { execution_state_changed_events: [] },
      txs: [fillerTransaction(100), failed],
      ledgerVersion: 101,
    })
    const chain = new AptosChain(provider, networkInfo('aptos:2'))

    const executions = await collect(
      chain.getExecutionReceipts({
        offRamp: ADDRESS,
        messageId: MESSAGE_ID,
        sourceChainSelector: 123n,
        startBlock: 100,
      }),
    )

    assert.equal(executions.length, 1)
    assert.equal(executions[0]!.receipt.state, ExecutionState.Failed)
    assert.equal(executions[0]!.receipt.messageId, MESSAGE_ID)
    assert.equal(executions[0]!.receipt.gasUsed, 42n)
    const error = executions[0]!.error as Record<string, unknown>
    assert.equal(error.vmStatus, VM_STATUS)
    assert.equal(error.location, ADDRESS)
    assert.equal(error.abortCode, 65537n)
    assert.equal(error.function, `${ADDRESS}::manually_execute`)
  })
})
