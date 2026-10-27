import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import type {
  Checkpoint,
  CheckpointPage,
  CoinBalance,
  CoinMetadata,
  DevInspectResults,
  DynamicFieldPage,
  GetObjectParams,
  GetOwnedObjectsParams,
  GetTransactionBlockParams,
  MultiGetTransactionBlocksParams,
  PaginatedCoins,
  PaginatedEvents,
  PaginatedObjectsResponse,
  QueryEventsParams,
  QueryTransactionBlocksParams,
  SuiMoveNormalizedModule,
  SuiMoveNormalizedModules,
  SuiObjectResponse,
  SuiTransactionBlockResponse,
} from '@mysten/sui/jsonRpc'
import { getBytes } from 'ethers'

// Register every chain family (notably Solana, for decodeAddress on the pool's
// SVM remotes) the way SDK consumers do via the package root
import '../index.ts'
import { type ChainLog, ExecutionState } from '../types.ts'
import type { SuiClientLike } from './client.ts'
import { executionFixtures } from './execution.test.data.ts'
import { SuiChain } from './index.ts'

// ── recorded-shape fixture data: the suite's own former seq-942 send (the
// shape template), plus the original token-transfer sends' values ──
const SUI_SELECTOR = 9762610643973837292n
const SEPOLIA_SELECTOR = 16015286601757825753n
const ONRAMP = '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d::onramp'
const OFFRAMP = '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp'
const SUI_FEE_TOKEN = '0x587c29de216efd4219573e08a1f6964d4fa7cb714518c2c8a0f29abfa264327d'
const CCIP_BNM_POOL = '0x6a97d9f8e0c6dcb294f0a5331f4ce58d09525f85eb7ddff4978c251c31947fe8'
const SEPOLIA_BNM = '0xfd57b4ddbf88a4e07ff4e34c487b99af2fe82a05'
const TOKEN_SEND_MESSAGE_ID = '0x7499d8925d1679ba79e7ea9601fbb9dd566369baeb1745e9a9aa5b42a16da9e1'
const TOKEN_SEND_RECEIVER = '0x000000000000000000000000000000000000dEaD'
const FULL_TOKEN_SEND_MESSAGE_ID =
  '0x657fa335d971bc95fa082ff831f18db38e2d49174b394d93ef820316bdaa9da5'

// decoded messageId/state comparisons shared by the execution suites: real
// event logs carry message_id as a byte array in parsedJson, synthetic failure
// logs as a hex string — decodeReceipt normalizes both
const failuresOf = (logs: ChainLog[], messageId: string) =>
  logs.filter(
    (log) =>
      SuiChain.decodeReceipt(log)?.messageId === messageId &&
      (log.data as { state?: number }).state === ExecutionState.Failed,
  )
const successesOf = (logs: ChainLog[], messageId: string) =>
  logs.filter(
    (log) =>
      SuiChain.decodeReceipt(log)?.messageId === messageId &&
      (log.data as { state?: number }).state === ExecutionState.Success,
  )

/**
 * A {@link SuiClientLike} replaying the recorded double-exec fixtures — the
 * deterministic regression below drives the REAL getLogs/getTransaction/
 * getExecutionReceipts code against it. Any call the recorded payload set
 * doesn't cover throws: extending the exercised code paths without extending
 * the fixtures fails loudly instead of replaying stale data. Served queries
 * are recorded on `served`, so tests can assert the code path DID consult a
 * given recorded transaction.
 */
class RecordedSuiClient implements SuiClientLike {
  readonly served: { method: string; key: string }[] = []

  #txResponse = (digest: string) => {
    const tx = (executionFixtures.txResponses as Record<string, unknown>)[digest]
    if (!tx) throw new Error(`RecordedSuiClient: no recorded response for ${digest}`)
    return structuredClone(tx) as SuiClientLike['getTransactionBlock'] extends (
      ...args: never[]
    ) => Promise<infer T>
      ? T
      : never
  }

  async getChainIdentifier() {
    return executionFixtures.chainIdentifier
  }

  async getLatestCheckpointSequenceNumber() {
    return executionFixtures.latestCheckpoint
  }

  async getTransactionBlock(input: GetTransactionBlockParams) {
    this.served.push({ method: 'getTransactionBlock', key: input.digest })
    return this.#txResponse(input.digest)
  }

  async multiGetTransactionBlocks(input: MultiGetTransactionBlocksParams) {
    // the recorded tx responses ARE the meta entries (digest, checkpoint,
    // timestampMs, effects) the callers read
    this.served.push({ method: 'multiGetTransactionBlocks', key: input.digests.join(',') })
    return input.digests.map((digest) => this.#txResponse(digest))
  }

  async #paged<Page>(
    pages: { cursor: unknown; page: Page }[],
    cursor: unknown,
    describe: string,
  ): Promise<Page> {
    const page = pages.find((p) => p.cursor === (cursor ?? null))
    if (!page) throw new Error(`RecordedSuiClient: unexpected ${describe} cursor ${String(cursor)}`)
    return structuredClone(page.page)
  }

  async queryEvents(input: QueryEventsParams) {
    const filter = input.query as { MoveEventType?: string }
    if (!filter.MoveEventType?.endsWith('::ExecutionStateChanged'))
      throw new Error(`RecordedSuiClient: unexpected event filter ${JSON.stringify(input.query)}`)
    this.served.push({ method: 'queryEvents', key: filter.MoveEventType })
    return this.#paged(
      executionFixtures.eventsPages.map(({ cursor, page }) => ({ cursor, page })),
      input.cursor ?? null,
      'queryEvents',
    ) as Promise<PaginatedEvents>
  }

  async queryTransactionBlocks(input: QueryTransactionBlocksParams) {
    const filter = input.filter as {
      MoveFunction?: { package: string; module: string; function: string }
    }
    if (!filter.MoveFunction)
      throw new Error('RecordedSuiClient: only MoveFunction filters are recorded')
    const key = `${filter.MoveFunction.package}::offramp::${filter.MoveFunction.function}`
    this.served.push({ method: 'queryTransactionBlocks', key })
    const { digests, ...page } = await this.#paged(
      executionFixtures.executePages
        .filter(
          ({ filter: f }) =>
            f.package === filter.MoveFunction!.package &&
            f.module === filter.MoveFunction!.module &&
            f.function === filter.MoveFunction!.function,
        )
        .map(({ cursor, page }) => ({ cursor, page })),
      input.cursor ?? null,
      `queryTransactionBlocks(${filter.MoveFunction.package.slice(0, 10)}…::${filter.MoveFunction.function})`,
    )
    // the listed transactions are served from the recorded tx responses
    return { ...page, data: digests.map((digest) => this.#txResponse(digest)) }
  }

  async getOwnedObjects(_input: GetOwnedObjectsParams): Promise<PaginatedObjectsResponse> {
    this.served.push({ method: 'getOwnedObjects', key: _input.owner as string })
    // the recorded payload IS a real client response; the literal's inferred
    // types just don't overlap the SDK's discriminated unions
    return structuredClone(
      executionFixtures.offRampOwnedObjects,
    ) as unknown as PaginatedObjectsResponse
  }

  async getObject(input: GetObjectParams) {
    this.served.push({ method: 'getObject', key: input.id })
    const obj = (executionFixtures.objectResponses as Record<string, unknown>)[input.id]
    if (!obj) throw new Error(`RecordedSuiClient: no recorded object ${input.id}`)
    return structuredClone(obj) as SuiClientLike['getObject'] extends (
      ...args: never[]
    ) => Promise<infer T>
      ? T
      : never
  }

  // everything else the recorded paths never touch — a call here means the
  // exercised code grew past the fixtures: extend execution.test.data.ts
  async getCheckpoint(): Promise<Checkpoint> {
    throw new Error('RecordedSuiClient: unexpected getCheckpoint')
  }
  async getCheckpoints(): Promise<CheckpointPage> {
    throw new Error('RecordedSuiClient: unexpected getCheckpoints')
  }
  async devInspectTransactionBlock(): Promise<DevInspectResults> {
    throw new Error('RecordedSuiClient: unexpected devInspectTransactionBlock')
  }
  async getDynamicFields(): Promise<DynamicFieldPage> {
    throw new Error('RecordedSuiClient: unexpected getDynamicFields')
  }
  async getDynamicFieldObject(): Promise<SuiObjectResponse> {
    throw new Error('RecordedSuiClient: unexpected getDynamicFieldObject')
  }
  async getNormalizedMoveModule(): Promise<SuiMoveNormalizedModule> {
    throw new Error('RecordedSuiClient: unexpected getNormalizedMoveModule')
  }
  async getNormalizedMoveModulesByPackage(): Promise<SuiMoveNormalizedModules> {
    throw new Error('RecordedSuiClient: unexpected getNormalizedMoveModulesByPackage')
  }
  async getBalance(): Promise<CoinBalance> {
    throw new Error('RecordedSuiClient: unexpected getBalance')
  }
  async getCoins(): Promise<PaginatedCoins> {
    throw new Error('RecordedSuiClient: unexpected getCoins')
  }
  async getCoinMetadata(): Promise<CoinMetadata | null> {
    throw new Error('RecordedSuiClient: unexpected getCoinMetadata')
  }
  async signAndExecuteTransaction(): Promise<SuiTransactionBlockResponse> {
    throw new Error('RecordedSuiClient: unexpected signAndExecuteTransaction')
  }
  async waitForTransaction(): Promise<SuiTransactionBlockResponse> {
    throw new Error('RecordedSuiClient: unexpected waitForTransaction')
  }
}

/**
 * Token-transfer decode, recorded-shape fixture — SYNTHETIC.
 *
 * The suite originally asserted this decode against two live CCIP-BnM sends
 * (sui → sepolia, seqs 93/94). Both aged past every reachable endpoint's
 * retention and their payloads are unrecoverable, and re-recording would
 * mean a fresh hardcoded send expiring in ~a week — so this fixture keeps
 * their exact decode coverage permanently: the event SHAPE is the real
 * CCIPMessageSent rendering (taken from the suite's live seq-942 send), and
 * the VALUES are the original sends' (message ids, amounts, addresses —
 * preserved in git history). It runs with no network.
 */
describe('SuiChain CCIPMessageSent decode (recorded-shape fixture)', () => {
  // the getTransaction log shape: address = <pkg>::<module>, topics = [event
  // name], data = the event's parsedJson
  const sender = '0x466c64282c1a3368d59d2690cda7d84cae809df28c3da5a7550d33bf9cfb9186'
  const receiverEvm = '0x89810cb91a5fe67dDf3483182f08e1559A5699De'
  const receiverBytes = getBytes(receiverEvm)
  const destTokenBytes = getBytes(SEPOLIA_BNM)
  const sourcePoolBytes = getBytes(CCIP_BNM_POOL)
  const messageIdBytes = (id: string) => getBytes(id)
  // the pool's extraData carries the local decimals (9 => le bytes 0x09…)
  const EXTRA_DATA_DECIMALS_9 = `0x${'00'.repeat(31)}09`
  // the real send's extra args (SuiExtraArgsV1: tag, gas limit, allowOOO)
  const EXTRA_ARGS = '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001'

  const tokenAmount = (amount: string) => ({
    dest_token_address: [...destTokenBytes],
    source_pool_address: [...sourcePoolBytes],
    amount,
    extra_data: [...getBytes(EXTRA_DATA_DECIMALS_9)],
  })
  const eventLog = (
    messageId: string,
    sequenceNumber: string,
    tokenAmounts: unknown[],
    receiver = receiverBytes,
  ) => ({
    address: ONRAMP,
    topics: ['CCIPMessageSent'],
    index: 0,
    blockNumber: 372_600_800,
    blockTimestamp: 1_760_000_000,
    // the original seq-94 send's digest (fixture data — never fetched)
    transactionHash: '2KgmjsUwqKkS2EKPzr1beE2vtFB7knr1Ue23JFM1gDLt',
    data: {
      dest_chain_selector: SEPOLIA_SELECTOR.toString(),
      message: {
        data: [],
        extra_args: [...getBytes(EXTRA_ARGS)],
        fee_token: SUI_FEE_TOKEN,
        fee_token_amount: '86589748',
        fee_value_juels: '7070936000000000',
        header: {
          dest_chain_selector: SEPOLIA_SELECTOR.toString(),
          message_id: [...messageIdBytes(messageId)],
          nonce: '0',
          sequence_number: sequenceNumber,
          source_chain_selector: SUI_SELECTOR.toString(),
        },
        receiver: [...receiver],
        sender,
        token_amounts: tokenAmounts,
      },
      sequence_number: sequenceNumber,
    },
  })

  // the two original sends' decodes, with the original assertions
  for (const want of [
    {
      messageId: '0xd5e9fb64d36e13e692858b82b5fa309d1b900d5526356f48c9ea3a6a967c6a5e',
      sequenceNumber: 94n,
      amount: 1_200_000n,
    },
    {
      messageId: FULL_TOKEN_SEND_MESSAGE_ID,
      sequenceNumber: 93n,
      amount: 1_000_000_000n,
    },
  ]) {
    it(`decodes the seq ${want.sequenceNumber} token-transfer send (amounts, addresses, decimals)`, () => {
      const message = SuiChain.decodeMessage(
        eventLog(want.messageId, want.sequenceNumber.toString(), [
          tokenAmount(want.amount.toString()),
        ]) as never,
      ) as unknown as {
        messageId: string
        destChainSelector: bigint
        sequenceNumber: bigint
        receiver: string
        tokenAmounts: {
          amount: bigint
          destTokenAddress: string
          sourcePoolAddress: string
          extraData: string
        }[]
      }
      assert.ok(message)
      assert.equal(message.messageId, want.messageId)
      assert.equal(message.destChainSelector, SEPOLIA_SELECTOR)
      assert.equal(message.sequenceNumber, want.sequenceNumber)
      assert.equal(message.receiver, receiverEvm)

      const [tokenAmount_] = message.tokenAmounts
      assert.ok(tokenAmount_)
      assert.equal(tokenAmount_.amount, want.amount)
      assert.equal(tokenAmount_.destTokenAddress.toLowerCase(), SEPOLIA_BNM)
      assert.equal(tokenAmount_.sourcePoolAddress.toLowerCase(), CCIP_BNM_POOL)
      assert.equal(tokenAmount_.extraData, EXTRA_DATA_DECIMALS_9)
    })
  }

  it('decodes a tokenless send with an empty token_amounts array', () => {
    const message = SuiChain.decodeMessage(
      // the live seq-942 send's form: a 32-byte receiver (the padded Sui
      // address the SDK's sender supplies) — kept as the shape template
      eventLog(TOKEN_SEND_MESSAGE_ID, '942', [], getBytes(TOKEN_SEND_RECEIVER)) as never,
    ) as unknown as { tokenAmounts: unknown[]; receiver: string }
    assert.ok(message)
    assert.deepEqual(message.tokenAmounts, [])
    assert.equal(message.receiver, TOKEN_SEND_RECEIVER)
  })
})

describe('Sui failed execution detection regression (recorded payloads)', () => {
  // The double-executed message phenomenon, from the REAL recorded payloads
  // (execution.test.data.ts — see its provenance header): a committed
  // sepolia → sui text message (seq 168) whose first execution SUCCEEDED (bot
  // init_execute F9jVv5…, cp 396_192_399, emitting ExecutionStateChanged state
  // 2) and whose later duplicate manually_init_execute (AhvqUfUn…, cp
  // 397_545_835) hit the offramp's already-executed guard —
  // SkippedAlreadyExecuted, and the PTB COMPLETED (a text-only skip aborts
  // nothing): no state event, and no failed execution for the streams to
  // reconstruct. The ORIGINAL suite's fixture had a duplicate that ABORTED
  // unwrapping the empty ReceiverParams hot potato — that abort path is
  // covered by execution-failure.test.ts's mocked-abort reconstruction tests;
  // this recorded regression covers the narrow phenomenon the chain still
  // shows: the duplicate attempt emits nothing the streams may report. The
  // three tests run the REAL getLogs/getTransaction/getExecutionReceipts code
  // against the recorded client — hermetic, and never expiring with the
  // chain's retention.
  const SUCCESS_TX = 'F9jVv5MCyauwHoVaYHRiKuYBhgBrGwHdRL1UNL4EyE9v'
  const SUCCESS_CHECKPOINT = 396_192_399
  const DUPLICATE_TX = 'AhvqUfUnPagbF73cuFZd67pK6h2SYcNbW1vrqwuTBtGo'
  const DUPLICATE_CHECKPOINT = 397_545_835
  const OFFRAMP_PKG = OFFRAMP.split('::')[0]!
  const LATEST_OFFRAMP_PKG = '0xf9494e5c9ae47c696ac45123d4b60cb6d57db611b524379d0cdf04a2ae9eabe6'
  const MESSAGE_ID = '0x1e15bb1159b4780663b642313b999bca63ab1016bfc05cc20a8cdff05480f742'
  const SEQUENCE = 168n
  const SOURCE_SELECTOR = SEPOLIA_SELECTOR
  // the range INCLUDES the duplicate attempt (+100): the getLogs stream (and
  // its failure scan) must be seen to consult — and ignore — it
  const DOUBLE_EXEC_RANGE = {
    startBlock: 396_192_299,
    endBlock: DUPLICATE_CHECKPOINT + 100,
  }

  let chain: SuiChain
  let client: RecordedSuiClient
  before(async () => {
    // fromClient probes the recorded liveness values; the fake client serves
    // everything else from the recorded pages (and throws on anything else)
    client = new RecordedSuiClient()
    chain = await SuiChain.fromClient(client, 'recorded://sui-testnet/execution-fixtures')
  })

  it('getLogs emits the success and ignores the double-exec attempt within the same range', async () => {
    const logs: ChainLog[] = []
    for await (const log of chain.getLogs({
      address: OFFRAMP,
      topics: ['ExecutionStateChanged'],
      ...DOUBLE_EXEC_RANGE,
    })) {
      logs.push(log)
    }
    // the client actually ran the execution-failure scan (the caller package's
    // two execute-function listings) — the scan found no failed executions.
    // NOTE the scan covers the CALLER's package only: the duplicate ran on the
    // latest package, so per-tx duplicate suppression is proven by the
    // getTransaction test below, not by this scan.
    assert.ok(
      client.served.some(
        ({ method, key }) =>
          method === 'queryTransactionBlocks' &&
          key === `${OFFRAMP_PKG}::offramp::manually_init_execute`,
      ),
      "the failure scan queried the caller package's manually_init_execute",
    )
    // the stream hydrated BOTH successes' tx metas (the events pages carry
    // them), then merged them ascending
    assert.ok(
      client.served.some(
        ({ method, key }) => method === 'multiGetTransactionBlocks' && key.includes(SUCCESS_TX),
      ),
      'the stream hydrated the success tx meta',
    )

    // the earlier attempt's real success event surfaces; the duplicate
    // execution attempt emits no state event, so no failure may surface
    assert.equal(successesOf(logs, MESSAGE_ID).length, 1, 'exactly the committed success')
    assert.equal(failuresOf(logs, MESSAGE_ID).length, 0, 'no failure surfaces for the message')
    const success = successesOf(logs, MESSAGE_ID)[0]!
    assert.equal(success.transactionHash, SUCCESS_TX)
    assert.equal(success.blockNumber, SUCCESS_CHECKPOINT)
    const receipt = SuiChain.decodeReceipt(success)
    assert.ok(receipt)
    assert.equal(receipt.state, ExecutionState.Success)
    assert.equal(receipt.messageId, MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, SEQUENCE)
    assert.equal(success.address, OFFRAMP)
    // the recorded page's other event is another message's success (cp
    // 396_690_211, inside the range): it streams too — the filters key on the
    // decoded message id
    assert.ok(
      logs.some((log) => log.transactionHash !== SUCCESS_TX),
      'the other in-range event streamed',
    )

    // the merged stream stays globally ascending (block, then log index)
    for (let i = 1; i < logs.length; i++)
      assert.ok(
        logs[i]!.blockNumber >= logs[i - 1]!.blockNumber,
        `log ${i} must not precede its predecessor`,
      )
    // dedupe keys stay unique across both sources
    const keys = new Set(logs.map((log) => `${log.transactionHash}:${log.index}`))
    assert.equal(logs.length, logs.length && keys.size)
  })

  it('getTransaction does not reconstruct a failure from the skipped double-exec attempt', async () => {
    const tx = await chain.getTransaction(DUPLICATE_TX)
    const failure = tx.logs.find((log) => log.topics[0] === 'ExecutionStateChanged')
    assert.equal(failure, undefined, 'the skipped double-exec attempt is not a failed execution')
  })

  it('getExecutionReceipts emits only the success of a double-executed message, breaking on it', async () => {
    const executions = []
    for await (const execution of chain.getExecutionReceipts({
      offRamp: OFFRAMP,
      messageId: MESSAGE_ID,
      sourceChainSelector: SOURCE_SELECTOR,
      sequenceNumber: SEQUENCE,
      startBlock: SUCCESS_CHECKPOINT - 100,
    })) {
      executions.push(execution)
    }
    // the walk consulted the latest package's init_execute listing (its page
    // carries the success) and the success ENDED the stream — the usual
    // break-on-success contract — so the remaining manually_init_execute
    // listing (which carries the duplicate) was never reached
    assert.ok(
      client.served.some(
        ({ method, key }) =>
          method === 'queryTransactionBlocks' &&
          key === `${LATEST_OFFRAMP_PKG}::offramp::init_execute`,
      ),
      "the receipts walk queried the latest package's init_execute (the success is in its page)",
    )
    assert.ok(
      !client.served.some(
        ({ method, key }) =>
          method === 'queryTransactionBlocks' &&
          key === `${LATEST_OFFRAMP_PKG}::offramp::manually_init_execute`,
      ),
      "break-on-success short-circuits the remaining listings (the duplicate's page is never reached)",
    )
    assert.equal(executions.length, 1)
    const { receipt, log } = executions[0]!
    assert.equal(receipt.state, ExecutionState.Success)
    assert.equal(receipt.messageId, MESSAGE_ID)
    assert.equal(receipt.sequenceNumber, SEQUENCE)
    assert.equal(receipt.sourceChainSelector, SOURCE_SELECTOR)
    assert.equal(log.address, OFFRAMP)
    assert.equal(log.blockNumber, SUCCESS_CHECKPOINT)
    assert.equal(log.transactionHash, SUCCESS_TX)
  })
})
