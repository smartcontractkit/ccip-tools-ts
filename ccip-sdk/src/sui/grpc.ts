import { pureBcsSchemaFromTypeName } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import type {
  Checkpoint,
  CheckpointPage,
  CoinBalance,
  CoinMetadata,
  DevInspectResults,
  DevInspectTransactionBlockParams,
  DynamicFieldPage,
  EventId,
  GetBalanceParams,
  GetCoinMetadataParams,
  GetCoinsParams,
  GetDynamicFieldObjectParams,
  GetDynamicFieldsParams,
  GetNormalizedMoveModuleParams,
  GetNormalizedMoveModulesByPackageParams,
  GetObjectParams,
  GetOwnedObjectsParams,
  GetTransactionBlockParams,
  MultiGetTransactionBlocksParams,
  PaginatedCoins,
  PaginatedEvents,
  PaginatedObjectsResponse,
  PaginatedTransactionResponse,
  QueryEventsParams,
  QueryTransactionBlocksParams,
  SuiEvent,
  SuiMoveNormalizedModule,
  SuiMoveNormalizedModules,
  SuiObjectResponse,
  SuiTransactionBlockResponse,
} from '@mysten/sui/jsonRpc'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import type { SuiClientLike } from './client.ts'
import {
  type GrpcDatatype,
  type GrpcTypeRef,
  BcsCursor,
  decodeBcsMoveValue,
  dynamicFieldNameToBcs,
  eventBcsBytes,
  eventFilterToNormalized,
  grpcChainIdentifierToJsonRpc,
  grpcCheckpointToJsonRpc,
  grpcEventToJsonRpc,
  grpcObjectToJsonRpc,
  grpcPackageToDisassembled,
  grpcPackageToNormalizedModules,
  grpcSimulateToDevInspect,
  grpcTransactionEvents,
  grpcTransactionToJsonRpc,
  normalizeType,
  protoValueToJson,
  splitGenericArgs,
  transactionFilterToNormalized,
} from './grpc-shapes.ts'

/** Options for reaching a gRPC endpoint: URL, custom transport, or client. */
export type SuiGrpcChainClientOptions = {
  /** gRPC-Web endpoint base URL, e.g. `https://fullnode.testnet.sui.io:443`. */
  baseUrl?: string
  /** Caller-built `RpcTransport` (native gRPC etc.); wins over `baseUrl`. */
  transport?: NonNullable<ConstructorParameters<typeof SuiGrpcClient>[0]['transport']>
  /** Ready-made `SuiGrpcClient`; wins over both. */
  client?: SuiGrpcClient
  network?: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
  /** Rate-limited / profiled fetch for the built-in gRPC-Web transport. */
  fetch?: typeof globalThis.fetch
  /**
   * How long a FAILED package-descriptor fetch blocks retries, per package
   * (bounded negative cache — transient RPC failures recover on the next
   * render instead of poisoning the package for the client's life).
   * Default 5s; aligns with the SDK's default poll interval.
   */
  descriptorNegativeTtlMs?: number
}

// `transactions` alone would select every full transaction of the checkpoint
const CHECKPOINT_MASK = {
  paths: ['sequence_number', 'digest', 'summary.timestamp', 'summary.epoch'],
}
const CHECKPOINT_WITH_DIGESTS_MASK = { paths: [...CHECKPOINT_MASK.paths, 'transactions.digest'] }

/** Opaque cursor envelope: the gRPC position anchor a page resumes from. */
const encodeCursor = (anchor?: string | null): string | null =>
  anchor == null ? null : Buffer.from(JSON.stringify({ a: anchor }), 'utf8').toString('base64')
const decodeCursorAnchor = (cursor: string | null | undefined): string | undefined => {
  if (cursor == null) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { a?: string }
    return typeof parsed.a === 'string' ? parsed.a : undefined
  } catch {
    return undefined
  }
}

/** Default retry window for a FAILED descriptor fetch (see SuiGrpcChainClientOptions). */
const DEFAULT_DESCRIPTOR_NEGATIVE_TTL_MS = 5_000

/**
 * A gRPC-backed implementation of the SDK's Sui client surface
 * ({@link SuiClientLike}), translating results into the JSON-RPC response
 * shapes the Sui implementation was built against.
 *
 * This is the gRPC path parallel to HTTP: Sui's public fullnodes no longer
 * serve JSON-RPC at all, and the keyless JSON-RPC gateways the HTTP path used
 * are gone, while Sui's official gRPC endpoint (`fullnode.<net>.sui.io`)
 * remains. The adapter is built on `SuiGrpcClient` (plus the raw ledger
 * service for the calls the normalized client does not expose), so no gRPC
 * dependency beyond the already-present `@mysten/sui` package is introduced.
 *
 * Endpoints: the built-in gRPC-Web transport serves any gRPC-Web-enabled
 * endpoint; anything else (e.g. a native-gRPC transport the CLI builds with
 * its own dependencies) injects through {@linkcode SuiGrpcChainClient.from}.
 *
 * Intentional fidelity gaps vs JSON-RPC (no SDK consumer needs more; extend
 * deliberately if one appears):
 * - PTB pure inputs render `0x<hex of the BCS bytes>` — the SDK's report
 *   decoders (`toUint8Array`) consume that form — not JSON-RPC's decoded
 *   JSON values.
 * - `getBalance.coinObjectCount` is always 0 and `getCoins` coins carry
 *   `previousTransaction: ''` — the gRPC endpoints do not serve them.
 * - Package objects render `content.disassembled` as `{}`; the real
 *   disassembly is synthesized by `getPackageDisassembly`.
 * - Raw-transaction responses omit `signatures` (the raw service returns
 *   Signature messages, not JSON-RPC's base64 strings).
 * - `waitForTransaction` ignores `pollInterval` (the normalized client's own
 *   poll schedule applies).
 * - `devInspectTransactionBlock` rejects string transaction blocks.
 * - Filters: only the predicates gRPC serves — sender, function, affected
 *   object (transactions); type (owned objects); sender, event type, module
 *   (events). Unsupported filters throw rather than silently under-filter.
 * - `getCheckpoints` cursors: the adapter's envelope resumes exclusively
 *   after/before the anchor; a bare sequence number starts AT it.
 */
export class SuiGrpcChainClient implements SuiClientLike {
  readonly #client: SuiGrpcClient
  readonly #baseUrl: string | undefined
  /** How long a FAILED descriptor fetch blocks retries, per package. */
  readonly #descriptorNegativeTtlMs: number
  /** Fully-qualified datatype name → descriptor, per package. */
  readonly #datatypes = new Map<string, Map<string, GrpcDatatype>>()
  /** In-flight descriptor fetches, so concurrent fixups share one call. */
  readonly #datatypeFetches = new Map<string, Promise<void>>()
  /** Package → time of the last FAILED descriptor fetch (negative cache). */
  readonly #datatypeFailures = new Map<string, number>()

  private constructor(client: SuiGrpcClient, baseUrl?: string, descriptorNegativeTtlMs?: number) {
    this.#client = client
    this.#baseUrl = baseUrl
    this.#descriptorNegativeTtlMs = descriptorNegativeTtlMs ?? DEFAULT_DESCRIPTOR_NEGATIVE_TTL_MS
  }

  static from(options: SuiGrpcChainClientOptions): SuiGrpcChainClient {
    const ttl = options.descriptorNegativeTtlMs
    if (options.client) return new SuiGrpcChainClient(options.client, undefined, ttl)
    const network = options.network ?? 'testnet'
    if (options.transport)
      return new SuiGrpcChainClient(
        new SuiGrpcClient({ network, transport: options.transport }),
        undefined,
        ttl,
      )
    if (options.baseUrl)
      return new SuiGrpcChainClient(
        new SuiGrpcClient({
          network,
          baseUrl: options.baseUrl,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
        options.baseUrl,
        ttl,
      )
    throw new CCIPError(
      CCIPErrorCode.ARGUMENT_INVALID,
      'SuiGrpcChainClient requires one of: client, transport, baseUrl',
    )
  }

  static fromBaseUrl(baseUrl: string, fetchImpl?: typeof globalThis.fetch): SuiGrpcChainClient {
    return SuiGrpcChainClient.from({ baseUrl, fetch: fetchImpl })
  }

  /** The underlying `SuiGrpcClient` (for callers that need raw service access). */
  get underlying(): SuiGrpcClient {
    return this.#client
  }

  get baseUrl(): string | undefined {
    return this.#baseUrl
  }

  // ── chain identity ──

  /**
   * The gRPC chain identifier is the base58 genesis checkpoint digest; the
   * JSON-RPC one is its first 4 bytes hexlified (`4c78adac` for testnet).
   * Reports the JSON-RPC form so `SuiChain.fromUrl`'s network mapping applies
   * to both transports.
   */
  async getChainIdentifier(): Promise<string> {
    const { chainIdentifier } = await this.#client.getChainIdentifier()
    return grpcChainIdentifierToJsonRpc(chainIdentifier)
  }

  async getLatestCheckpointSequenceNumber(): Promise<string> {
    const { response } = await this.#client.ledgerService.getServiceInfo({})
    if (response.checkpointHeight == null)
      throw new CCIPError(
        CCIPErrorCode.DATA_PARSE_FAILED,
        'gRPC endpoint reported no checkpoint height',
      )
    return response.checkpointHeight.toString()
  }

  // ── checkpoints ──

  async getCheckpoint(input: { id: string }): Promise<Checkpoint> {
    return this.#getCheckpoint(input.id)
  }

  async #getCheckpoint(id: string): Promise<Checkpoint> {
    const checkpointId = /^\d+$/.test(id)
      ? { oneofKind: 'sequenceNumber' as const, sequenceNumber: BigInt(id) }
      : { oneofKind: 'digest' as const, digest: id }
    const { response } = await this.#client.ledgerService.getCheckpoint({
      checkpointId,
      readMask: CHECKPOINT_MASK,
    })
    if (!response.checkpoint)
      throw new CCIPError(CCIPErrorCode.BLOCK_NOT_FOUND, `Checkpoint not found: ${id}`, {
        isTransient: true,
      })
    return grpcCheckpointToJsonRpc(response.checkpoint) as unknown as Checkpoint
  }

  async getCheckpoints(input: {
    cursor?: string | null
    limit?: number | null
    descendingOrder?: boolean | null
    signal?: AbortSignal
  }): Promise<CheckpointPage> {
    const limit = input.limit ?? 100
    const descending = input.descendingOrder ?? false

    // Cursor bookkeeping: the SDK threads our cursor strings opaquely. A
    // descending walk starts at the tip; ascending starts at genesis (or at
    // the cursor's checkpoint). Cursors come in two shapes: our own envelope
    // (encodeCursor of a sequence number — resume EXCLUSIVELY after/before it,
    // the anchor was the previous page's last item) and a bare sequence number
    // (callers like the SDK's checkpoint walk pass `String(fromCheckpoint)` —
    // resume AT it, the first page must include that checkpoint).
    let high: bigint
    let low: bigint
    let latest: bigint | undefined
    const anchorSeq = (
      cursor: string | null | undefined,
    ): { seq: bigint; exclusive: boolean } | undefined => {
      const anchor = decodeCursorAnchor(cursor)
      if (anchor != null && /^\d+$/.test(anchor)) return { seq: BigInt(anchor), exclusive: true }
      if (cursor != null && /^\d+$/.test(cursor)) return { seq: BigInt(cursor), exclusive: false }
      return undefined
    }
    if (descending) {
      const anchor = anchorSeq(input.cursor)
      high =
        anchor == null
          ? BigInt(await this.getLatestCheckpointSequenceNumber())
          : anchor.exclusive
            ? anchor.seq - 1n
            : anchor.seq
      low = high - BigInt(limit - 1) < 0n ? 0n : high - BigInt(limit - 1)
    } else {
      const anchor = anchorSeq(input.cursor)
      low = anchor == null ? 0n : anchor.exclusive ? anchor.seq + 1n : anchor.seq
      latest = BigInt(await this.getLatestCheckpointSequenceNumber())
      high = low + BigInt(limit - 1)
      if (high > latest) high = latest
    }
    if (low > high) return { data: [], hasNextPage: false, nextCursor: null }

    const data: Checkpoint[] = []
    const call = this.#client.ledgerService.listCheckpoints({
      startCheckpoint: low,
      endCheckpoint: high + 1n, // exclusive upper bound
      readMask: CHECKPOINT_WITH_DIGESTS_MASK,
    })
    for await (const frame of call.responses) {
      if (frame.checkpoint)
        data.push(
          grpcCheckpointToJsonRpc(
            frame.checkpoint as unknown as Parameters<typeof grpcCheckpointToJsonRpc>[0],
          ) as unknown as Checkpoint,
        )
    }
    // the stream walks ascending regardless of the requested page order
    data.sort((left, right) =>
      left.sequenceNumber === right.sequenceNumber
        ? 0
        : BigInt(left.sequenceNumber!) < BigInt(right.sequenceNumber!)
          ? -1
          : 1,
    )
    if (descending) data.reverse()

    const last = data[data.length - 1]
    const reachedBoundary =
      last != null && BigInt(last.sequenceNumber) === (descending ? 0n : latest)
    return {
      data,
      hasNextPage: !reachedBoundary && data.length === limit,
      nextCursor: last ? encodeCursor(String(last.sequenceNumber)) : null,
    }
  }

  // ── transactions ──

  async getTransactionBlock(
    input: GetTransactionBlockParams,
  ): Promise<SuiTransactionBlockResponse> {
    const tx = await this.#getTransactionTx(input.digest, input.options)
    await this.#fixupTxJson(tx)
    return grpcTransactionToJsonRpc(tx, input.options) as unknown as SuiTransactionBlockResponse
  }

  async multiGetTransactionBlocks(
    input: MultiGetTransactionBlocksParams,
  ): Promise<SuiTransactionBlockResponse[]> {
    const results: SuiTransactionBlockResponse[] = []
    for (let i = 0; i < input.digests.length; i += 50) {
      const batch = input.digests.slice(i, i + 50)
      const { response } = await this.#client.ledgerService.batchGetTransactions({
        digests: batch,
        readMask: transactionReadMask(input.options),
      })
      for (const result of response.transactions) {
        if (result.result.oneofKind !== 'transaction') {
          const message =
            result.result.oneofKind === 'error' ? result.result.error.message : 'not found'
          // JSON-RPC's phrasing for a pruned/unknown tx: consumers match it to
          // fall back to prune-tolerant strategies
          throw notFoundTransactionError(`Could not find the referenced transaction: ${message}`)
        }
        const tx = result.result.transaction as unknown as Parameters<
          typeof grpcTransactionToJsonRpc
        >[0]
        await this.#fixupTxJson(tx)
        results.push(
          grpcTransactionToJsonRpc(tx, input.options) as unknown as SuiTransactionBlockResponse,
        )
      }
    }
    return results
  }

  async queryTransactionBlocks(
    input: QueryTransactionBlocksParams,
  ): Promise<PaginatedTransactionResponse> {
    // InputObject (and other affected-object/sender filters the normalized
    // layer does not expose) route through the raw ledger service's DNF filter
    if (input.filter != null && 'InputObject' in input.filter && input.filter.InputObject)
      return this.#queryTransactionsByAffectedObject(
        input.filter.InputObject,
        input.options,
        input.cursor,
        input.limit,
        input.order ?? 'ascending',
        input.signal,
      )
    const limit = input.limit ?? 50
    const descending = (input.order ?? 'ascending') === 'descending'
    // JSON-RPC pages with an opaque string cursor per direction; the gRPC
    // bounds are position anchors (`after`/`before`), exclusive. A page's
    // cursor carries the page's end anchor; resuming continues strictly
    // after (ascending) / before (descending) it.
    const anchor = decodeCursorAnchor(input.cursor)

    // The normalized client does its own limit+1 lookahead and positions
    // `endCursor` after the items it returns — ask for exactly `limit` so
    // resuming from our encoded cursor never skips an item. NOT_FOUND (a
    // position the node pruned) is rephrased with JSON-RPC's wording so the
    // SDK's prune-tolerant retry strategies keep matching.
    const res = await this.#client
      .listTransactions({
        filter: transactionFilterToNormalized(input.filter),
        include: transactionInclude(input.options),
        order: input.order ?? 'ascending',
        ...(descending ? { before: anchor } : { after: anchor }),
        limit,
        signal: input.signal,
      })
      .catch((error: unknown) => {
        if (isGrpcNotFound(error))
          throw notFoundTransactionError('Could not find the referenced transaction')
        throw error
      })

    const data: SuiTransactionBlockResponse[] = []
    for (const wrapped of res.transactions) {
      // TransactionResult guarantees exactly one variant
      const tx = wrapped.Transaction ?? wrapped.FailedTransaction
      await this.#fixupTxJson(tx)
      data.push(
        grpcTransactionToJsonRpc(tx, input.options) as unknown as SuiTransactionBlockResponse,
      )
    }
    return {
      data,
      hasNextPage: res.hasNextPage,
      nextCursor: encodeCursor(res.endCursor),
    }
  }

  /**
   * Transactions that took `objectId` as an input (or created/mutated it), via
   * the raw ledger service's affected-object DNF filter — the normalized
   * client's TransactionFilter only exposes sender/function.
   */
  async #queryTransactionsByAffectedObject(
    objectId: string,
    options: GetTransactionBlockParams['options'],
    cursor: string | null | undefined,
    limit: number | null | undefined,
    order: 'ascending' | 'descending',
    signal?: AbortSignal,
  ): Promise<PaginatedTransactionResponse> {
    const pageSize = limit ?? 50
    const descending = order === 'descending'
    const anchor = decodeCursorAnchor(cursor)
    const call = this.#client.ledgerService.listTransactions({
      filter: {
        terms: [
          {
            literals: [
              {
                negated: false,
                predicate: {
                  oneofKind: 'affectedObject',
                  affectedObject: { objectId: normalizeSuiAddress(objectId) },
                },
              },
            ],
          },
        ],
      },
      readMask: transactionReadMask(options),
      options: {
        limit: pageSize + 1,
        // Ordering: ASCENDING=0, DESCENDING=1 (sui.rpc.v2.Ordering)
        ordering: (descending ? 1 : 0) as never,
        // the anchors are protobuf `bytes`
        ...(descending
          ? { before: anchor ? new Uint8Array(Buffer.from(anchor, 'base64')) : undefined }
          : { after: anchor ? new Uint8Array(Buffer.from(anchor, 'base64')) : undefined }),
      },
      ...(signal ? { abort: signal } : {}),
    })
    // limit+1 lookahead, mirroring the normalized client: an item past the page
    // marks hasMore and the cursor stays at the last ACCEPTED item's watermark
    // (a frame's watermark leads its item), so resuming from it never skips the
    // lookahead item. End reasons: ITEM_LIMIT/SCAN_LIMIT mean more data;
    // CHECKPOINT_BOUND/CURSOR_BOUND/LEDGER_TIP mean the scan finished.
    const collected: Parameters<typeof grpcTransactionToJsonRpc>[0][] = []
    let endAnchor: string | undefined
    let sawLookahead = false
    let endReason: number | undefined
    try {
      for await (const frame of call.responses) {
        if (frame.transaction) {
          if (collected.length >= pageSize) {
            sawLookahead = true
            break
          }
          collected.push(
            frame.transaction as unknown as Parameters<typeof grpcTransactionToJsonRpc>[0],
          )
        }
        if (frame.watermark?.cursor)
          endAnchor = Buffer.from(frame.watermark.cursor).toString('base64')
        if (frame.end) endReason = frame.end.reason
      }
    } catch (error) {
      // a pruned scan position: rephrase with JSON-RPC's wording so the SDK's
      // prune-tolerant retry strategies keep matching
      if (isGrpcNotFound(error))
        throw notFoundTransactionError('Could not find the referenced transaction')
      throw error
    }
    return {
      data: await Promise.all(
        collected.map(async (tx) => {
          await this.#fixupTxJson(tx)
          return grpcTransactionToJsonRpc(tx, options) as unknown as SuiTransactionBlockResponse
        }),
      ),
      hasNextPage:
        sawLookahead || endReason === 1 /* ITEM_LIMIT */ || endReason === 2 /* SCAN_LIMIT */,
      nextCursor: encodeCursor(endAnchor),
    }
  }

  // ── objects ──

  async getObject(input: GetObjectParams): Promise<SuiObjectResponse> {
    const { object } = await this.#client.getObject({
      objectId: input.id,
      include: objectInclude(input.options),
      signal: input.signal,
    })
    ;(object as { json?: unknown }).json = await this.#renderObjectFields(object)
    return grpcObjectToJsonRpc(
      object as unknown as Parameters<typeof grpcObjectToJsonRpc>[0],
      input.options,
    ) as unknown as SuiObjectResponse
  }

  async getOwnedObjects(input: GetOwnedObjectsParams): Promise<PaginatedObjectsResponse> {
    const limit = input.limit ?? 50
    // the gRPC owned-objects listing only takes a type filter; anything else
    // would silently return UNFILTERED data — refuse it instead
    if (input.filter != null && !('StructType' in input.filter))
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        `Unsupported Sui object filter: ${Object.keys(input.filter).join(', ')}`,
      )
    // the server's page token IS the cursor: ask for exactly `limit`, and pass
    // its token/hasNextPage through unchanged (a limit+1 read would position
    // the token past an item we dropped — skipping one object per page)
    const res = await this.#client.listOwnedObjects({
      owner: input.owner,
      type:
        input.filter != null && 'StructType' in input.filter ? input.filter.StructType : undefined,
      include: { owner: true, ...objectInclude(input.options) },
      cursor: input.cursor ?? undefined,
      limit,
      signal: input.signal,
    })
    return {
      data: res.objects.map((object) =>
        grpcObjectToJsonRpc(
          object as unknown as Parameters<typeof grpcObjectToJsonRpc>[0],
          input.options,
        ),
      ) as unknown as SuiObjectResponse[],
      hasNextPage: res.hasNextPage,
      nextCursor: res.cursor ?? null,
    }
  }

  async getDynamicFields(input: GetDynamicFieldsParams): Promise<DynamicFieldPage> {
    const limit = input.limit ?? 50
    // the server's page token IS the cursor: ask for exactly `limit` and pass
    // its token/hasNextPage through (see getOwnedObjects — a limit+1 read skips)
    const res = await this.#client.listDynamicFields({
      parentId: input.parentId,
      cursor: input.cursor ?? undefined,
      limit,
      signal: input.signal,
    })
    return {
      data: res.dynamicFields.map((field) =>
        grpcDynamicFieldToJsonRpc(field, input.parentId),
      ) as never,
      hasNextPage: res.hasNextPage,
      nextCursor: res.cursor ?? null,
    }
  }

  async getDynamicFieldObject(input: GetDynamicFieldObjectParams): Promise<SuiObjectResponse> {
    // JSON-RPC's getDynamicFieldObject serves BOTH plain dynamic fields (a
    // table's entry object, keyed by the raw name type) and dynamic OBJECT
    // fields (a wrapped object). The normalized layer splits them, and the
    // field-id derivation differs (the Wrapper type), so resolve via
    // getDynamicField, which computes the id from the raw name type, then read
    // the field object (or the wrapped child object) with getObject.
    const { dynamicField } = await this.#client.getDynamicField({
      parentId: input.parentId,
      name: dynamicFieldNameToBcs(input.name),
      signal: input.signal,
    })
    const objectId =
      dynamicField.$kind === 'DynamicObject' ? dynamicField.childId : dynamicField.fieldId
    const { object } = await this.#client.getObject({
      objectId,
      include: objectInclude({ showContent: true, showType: true }),
      signal: input.signal,
    })
    ;(object as { json?: unknown }).json = await this.#renderObjectFields(object)
    return grpcObjectToJsonRpc(object as unknown as Parameters<typeof grpcObjectToJsonRpc>[0], {
      showContent: true,
      showType: true,
    }) as unknown as SuiObjectResponse
  }

  // ── packages ──

  async getNormalizedMoveModule(
    input: GetNormalizedMoveModuleParams,
  ): Promise<SuiMoveNormalizedModule> {
    const modules = await this.getNormalizedMoveModulesByPackage({ package: input.package })
    const module = modules[input.module]
    if (!module)
      throw new CCIPError(
        CCIPErrorCode.RPC_NOT_FOUND,
        `Module not found: ${input.package}::${input.module}`,
      )
    return module as SuiMoveNormalizedModule
  }

  async getNormalizedMoveModulesByPackage(
    input: GetNormalizedMoveModulesByPackageParams,
  ): Promise<SuiMoveNormalizedModules> {
    const { response } = await this.#client.movePackageService.getPackage({
      packageId: input.package,
    })
    if (!response.package)
      throw new CCIPError(CCIPErrorCode.RPC_NOT_FOUND, `Package not found: ${input.package}`)
    return grpcPackageToNormalizedModules(response.package) as unknown as SuiMoveNormalizedModules
  }

  /**
   * The JSON-RPC package object's `content.disassembled` has no gRPC
   * equivalent, so this synthesizes a disassembly-like source per module from
   * the package service's metadata: it carries the pieces consumers parse —
   * module names (the keys), `use <addr>::<module>` import lines,
   * `<field>_object_id:` field names, and `struct` names.
   */
  async getPackageDisassembly(packageId: string): Promise<Record<string, string>> {
    const { response } = await this.#client.movePackageService.getPackage({
      packageId,
    })
    if (!response.package)
      throw new CCIPError(CCIPErrorCode.RPC_NOT_FOUND, `Package not found: ${packageId}`)
    return grpcPackageToDisassembled(response.package)
  }

  // ── coins / metadata ──

  async getBalance(input: GetBalanceParams): Promise<CoinBalance> {
    const res = await this.#client.getBalance({
      owner: input.owner,
      coinType: input.coinType || undefined,
    })
    return {
      coinObjectCount: 0,
      coinType: res.balance.coinType,
      lockedBalance: {},
      totalBalance: res.balance.balance,
    }
  }

  async getCoins(input: GetCoinsParams): Promise<PaginatedCoins> {
    const limit = input.limit ?? 50
    // the server's page token IS the cursor: ask for exactly `limit` and pass
    // its token/hasNextPage through (see getOwnedObjects — a limit+1 read skips)
    const res = await this.#client.listCoins({
      owner: input.owner,
      coinType: input.coinType || undefined,
      cursor: input.cursor ?? undefined,
      limit,
    })
    return {
      data: res.objects.map((coin) => ({
        balance: coin.balance,
        coinObjectId: coin.objectId,
        coinType: coin.type,
        digest: coin.digest,
        version: coin.version,
        // the gRPC coin listing carries no previous-tx digest; report empty
        // rather than mis-reporting the object digest
        previousTransaction: '',
      })),
      hasNextPage: res.hasNextPage,
      nextCursor: res.cursor ?? null,
    }
  }

  async getCoinMetadata(input: GetCoinMetadataParams): Promise<CoinMetadata | null> {
    const res = await this.#client.getCoinMetadata({ coinType: input.coinType })
    return res.coinMetadata
  }

  // ── events ──

  async queryEvents(input: QueryEventsParams): Promise<PaginatedEvents> {
    const limit = input.limit ?? 50
    const descending = (input.order ?? 'ascending') === 'descending'
    // JSON-RPC's event cursor is {txDigest, eventSeq}; ours is the gRPC ledger
    // position. The position envelope rides in the EventId's txDigest slot
    // (opaque: SDK consumers thread cursors verbatim) and is decoded on the
    // next page.
    const anchor =
      input.cursor && typeof input.cursor !== 'string'
        ? decodeEventAnchor(input.cursor.txDigest)
        : undefined

    // The normalized client does its own limit+1 lookahead and positions
    // `endCursor` after the events it returns — ask for exactly `limit` so
    // resuming from our encoded cursor never skips an event. A NOT_FOUND
    // position (pruned / lagging backend) is rephrased with JSON-RPC's
    // retention-boundary wording — the SDK switches to the checkpoint walk on
    // it, which serves whatever the node still retains.
    const res = await (async () => {
      try {
        return await this.#client.listEvents({
          filter: eventFilterToNormalized(input.query),
          order: input.order ?? 'ascending',
          ...(descending ? { before: anchor } : { after: anchor }),
          limit,
          signal: input.signal,
        })
      } catch (error) {
        if (isGrpcNotFound(error))
          throw new CCIPError(
            CCIPErrorCode.TRANSACTION_NOT_FOUND,
            'Could not find the referenced transaction events',
          )
        throw error
      }
    })()

    for (const event of res.events)
      (event as { json?: unknown }).json = await this.#renderEventJson(event)
    const last = res.events[res.events.length - 1]
    // An empty page can't advance the cursor (nextCursor stays the input's), so
    // the backend's hasNextPage would strand a !hasNextPage caller on it forever
    return {
      data: res.events.map((event) => grpcEventToJsonRpc(event)) as unknown as SuiEvent[],
      hasNextPage: last ? res.hasNextPage : false,
      nextCursor: last
        ? { txDigest: encodeEventAnchor(res.endCursor), eventSeq: String(last.eventIndex) }
        : (input.cursor as EventId | null),
    }
  }

  // ── execution ──

  async devInspectTransactionBlock(
    input: DevInspectTransactionBlockParams,
  ): Promise<DevInspectResults> {
    let transaction: Parameters<SuiGrpcClient['simulateTransaction']>[0]['transaction']
    if (typeof input.transactionBlock === 'string')
      throw new CCIPError(
        CCIPErrorCode.METHOD_UNSUPPORTED,
        'devInspectTransactionBlock: string transactions are not supported',
      )
    if (input.transactionBlock instanceof Uint8Array) {
      transaction = input.transactionBlock
    } else {
      input.transactionBlock.setSenderIfNotSet(input.sender)
      transaction = input.transactionBlock
    }
    const result = await this.#client.simulateTransaction({
      transaction,
      include: { effects: true, events: true, commandResults: true },
      doGasSelection: true,
    })
    return grpcSimulateToDevInspect(
      result as unknown as Parameters<typeof grpcSimulateToDevInspect>[0],
    ) as unknown as DevInspectResults
  }

  async signAndExecuteTransaction(
    input: Parameters<SuiClientLike['signAndExecuteTransaction']>[0],
  ): Promise<SuiTransactionBlockResponse> {
    const result = await this.#client.signAndExecuteTransaction({
      transaction: input.transaction as Parameters<
        SuiGrpcClient['signAndExecuteTransaction']
      >[0]['transaction'],
      signer: input.signer,
      include: transactionInclude(input.options),
      signal: input.signal,
    })
    const tx = result.Transaction ?? result.FailedTransaction
    await this.#fixupTxJson(tx)
    return grpcTransactionToJsonRpc(tx, input.options) as unknown as SuiTransactionBlockResponse
  }

  async waitForTransaction(
    input: Parameters<SuiClientLike['waitForTransaction']>[0],
  ): Promise<SuiTransactionBlockResponse> {
    const { timeout, pollInterval: _pollInterval, ...rest } = input
    const result = await this.#client.waitForTransaction({
      digest: rest.digest,
      include: transactionInclude(rest.options),
      signal: rest.signal,
      ...(timeout != null ? { timeout } : {}),
    })
    const tx = result.Transaction ?? result.FailedTransaction
    await this.#fixupTxJson(tx)
    return grpcTransactionToJsonRpc(tx, rest.options) as unknown as SuiTransactionBlockResponse
  }

  // ── internals ──

  /**
   * Resolves a fully-qualified datatype name (`0xpkg::module::Name`) to its
   * descriptor, fetching (and caching) the defining package's descriptors on
   * first use. Unresolvable datatypes return undefined — the fixup leaves
   * those values untouched.
   *
   * A FAILED fetch is only negatively cached for `descriptorNegativeTtlMs`:
   * transient RPC failures (load-balanced proxies, startup races) must retry
   * on later renders instead of poisoning the package for the client's life.
   */
  async #resolveDatatype(typeName: string): Promise<GrpcDatatype | undefined> {
    // generic instantiations resolve to their bare generic datatype; the
    // normalized (short) address form keeps the cache keys consistent
    const bareType = normalizeType(typeName).split('<')[0]!
    const pkg = bareType.split('::')[0]!
    if (!pkg) return undefined
    if (!this.#datatypes.has(pkg)) {
      // a failed fetch retries after the negative TTL instead of staying poisoned
      const failedAt = this.#datatypeFailures.get(pkg)
      if (failedAt != null && Date.now() - failedAt < this.#descriptorNegativeTtlMs)
        return undefined
      const inflight = this.#datatypeFetches.get(pkg)
      if (inflight) await inflight
      else {
        const fetch = this.#client.movePackageService
          .getPackage({ packageId: pkg })
          .then(({ response }) => {
            const cache = new Map<string, GrpcDatatype>()
            for (const module of response.package?.modules ?? []) {
              // protobuf-ts initializes repeated fields to []
              for (const datatype of module.datatypes) {
                const name =
                  datatype.typeName ?? `${pkg}::${module.name ?? ''}::${datatype.name ?? ''}`
                // lookups normalize (short) addresses; cache keys must match
                cache.set(normalizeType(name), datatype)
              }
            }
            this.#datatypeFailures.delete(pkg)
            this.#datatypes.set(pkg, cache)
          })
          .catch(() => {
            this.#datatypeFailures.set(pkg, Date.now())
          })
          .finally(() => this.#datatypeFetches.delete(pkg))
        this.#datatypeFetches.set(pkg, fetch)
        await fetch
      }
    }
    return this.#datatypes.get(pkg)?.get(bareType)
  }

  /**
   * Pre-fetches every package descriptor the type graph of `typeName` needs,
   * so the render walk's synchronous lookups resolve across packages (e.g.
   * `0x2::linked_table::LinkedTable<…>` fields inside a ccip state struct).
   * Unresolvable branches are skipped: their values render untouched.
   */
  async #ensureDatatypesFor(typeName: string): Promise<void> {
    const queue = [typeName]
    const seen = new Set<string>()
    while (queue.length) {
      const next = queue.shift()!
      // the entry's own generic args (Field<u64, DestChainConfig> binds T1/T2)
      // feed the queue, so the walk can resolve every bound datatype
      queue.push(...splitGenericArgs(next))
      const bare = next.split('<')[0]!
      if (seen.has(bare)) continue
      seen.add(bare)
      // resolve the datatype (fetching its package if needed), then ALWAYS
      // collect its field types: a cached package's datatypes may reference
      // OTHER packages (a Table<u64, DestChainConfig> field pulls in 0x2),
      // which the walk's synchronous lookups need fetched
      let datatype = this.#resolveDatatypeSync(bare)
      if (!datatype) datatype = await this.#resolveDatatype(bare)
      if (!datatype) continue
      for (const field of datatype.fields ?? []) this.#collectTypeNames(field.type, queue)
      for (const variant of datatype.variants ?? [])
        for (const field of variant.fields ?? []) this.#collectTypeNames(field.type, queue)
    }
  }

  #collectTypeNames(type: GrpcTypeRef | undefined, queue: string[]): void {
    if (!type) return
    // the queue walk also follows the type string's generic bindings
    if (type.typeName) queue.push(type.typeName)
    for (const inner of type.typeParameterInstantiation ?? []) this.#collectTypeNames(inner, queue)
  }

  async #renderObjectFields(object: {
    type?: string
    json?: unknown
    content?: Uint8Array
  }): Promise<unknown> {
    if (!object.type || object.type.startsWith('package') || object.content == null)
      return object.json
    // decode the object's BCS content: the ledger's json rendering can be
    // incomplete (large/nested fields render empty) and differs from JSON-RPC's;
    // BCS + the descriptors is always complete. The raw json is the fallback
    // when descriptors can't resolve.
    await this.#ensureDatatypesFor(object.type)
    try {
      const decoded = decodeBcsMoveValue(
        new BcsCursor(object.content),
        { type: 10, typeName: normalizeStructTag(object.type) },
        (name) => this.#resolveDatatypeSync(name),
        'object',
      )
      // the top-level struct comes back wrapped; JSON-RPC content.fields IS the top level
      return (decoded as { fields?: unknown }).fields ?? decoded
    } catch {
      return object.json
    }
  }

  /** Renders an event's parsedJson (nested structs stay unwrapped). */
  async #renderEventJson(event: {
    eventType?: string
    json?: unknown
    bcs?: unknown
  }): Promise<unknown> {
    const bcsBytes = eventBcsBytes(event as never)
    if (bcsBytes == null || !event.eventType) return protoValueToJson(event.json)
    // decode the event's BCS content (always complete); the ledger's json
    // rendering can be incomplete (large fields render empty)
    await this.#ensureDatatypesFor(event.eventType)
    try {
      return decodeBcsMoveValue(
        new BcsCursor(bcsBytes),
        { type: 10, typeName: normalizeType(event.eventType) },
        (name) => this.#resolveDatatypeSync(name),
        'event',
      )
    } catch {
      return protoValueToJson(event.json)
    }
  }

  /** Synchronous descriptor lookup for already-fetched packages (render walks). */
  #resolveDatatypeSync(typeName: string): GrpcDatatype | undefined {
    // normalized (short) address form: descriptor typeNames and consumer type
    // strings mix padded/unpadded addresses
    const bareType = normalizeType(typeName).split('<')[0]!
    const pkg = bareType.split('::')[0]!
    const hit = this.#datatypes.get(pkg)?.get(bareType)
    return hit
  }

  /** Renders every event's parsedJson of a transaction (raw proto or normalized shapes). */
  async #fixupTxJson(tx: { events?: unknown }): Promise<void> {
    for (const event of grpcTransactionEvents(tx as never))
      event.json = await this.#renderEventJson(event)
  }

  async #getTransactionTx(
    digest: string,
    options: GetTransactionBlockParams['options'],
  ): Promise<Parameters<typeof grpcTransactionToJsonRpc>[0]> {
    let response: { transaction?: unknown }
    try {
      ;({ response } = await this.#client.ledgerService.getTransaction({
        digest,
        readMask: transactionReadMask(options),
      }))
    } catch (error) {
      // the transport throws NOT_FOUND for a pruned/unknown tx before any
      // response check; rephrase with JSON-RPC's wording so consumers' prune
      // strategies keep matching
      if (isGrpcNotFound(error))
        throw notFoundTransactionError(`Could not find the referenced transaction ${digest}`)
      throw error
    }
    if (!response.transaction)
      // JSON-RPC's phrasing for a pruned/unknown tx: consumers match it to
      // fall back to prune-tolerant strategies
      throw notFoundTransactionError(`Could not find the referenced transaction ${digest}`)
    return response.transaction as unknown as Parameters<typeof grpcTransactionToJsonRpc>[0]
  }
}

/** The event-cursor anchor rides in the JSON-RPC EventId's txDigest slot. */
const EVENT_ANCHOR_TAG = 'grpc:'
const encodeEventAnchor = (anchor: string | null | undefined): string =>
  anchor == null ? `${EVENT_ANCHOR_TAG}null` : `${EVENT_ANCHOR_TAG}${anchor}`
const decodeEventAnchor = (txDigest: string): string | undefined => {
  if (!txDigest.startsWith(EVENT_ANCHOR_TAG)) return undefined
  const anchor = txDigest.slice(EVENT_ANCHOR_TAG.length)
  return anchor === '' || anchor === 'null' ? undefined : anchor
}

/** Whether an error is the transport's NOT_FOUND RpcError (no import needed: the code is a string property). */
function isGrpcNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error != null && (error as { code?: string }).code === 'NOT_FOUND'
  )
}

/**
 * A pruned/unknown transaction, in JSON-RPC's phrasing — consumers match it to
 * fall back to prune-tolerant strategies (withLookupRetry treats it as transient).
 */
function notFoundTransactionError(message: string): Error {
  return new CCIPError(CCIPErrorCode.TRANSACTION_NOT_FOUND, message, { isTransient: true })
}

/** options → readMask paths (ExecutedTransaction-relative, for the raw service calls). */
function transactionReadMask(options: GetTransactionBlockParams['options']): {
  paths: string[]
} {
  const paths = ['digest', 'timestamp', 'checkpoint']
  if (options?.showInput) paths.push('transaction')
  if (options?.showEffects) paths.push('effects')
  // `events` includes each event's BCS `contents`
  if (options?.showEvents) paths.push('events')
  if (options?.showBalanceChanges) paths.push('balance_changes')
  return { paths }
}

/** options → the normalized client's transaction include flags. */
function transactionInclude(options: GetTransactionBlockParams['options']) {
  return {
    ...(options?.showInput ? { transaction: true } : {}),
    ...(options?.showEffects ? { effects: true } : {}),
    ...(options?.showEvents ? { events: true } : {}),
    ...(options?.showBalanceChanges ? { balanceChanges: true } : {}),
  }
}

/** options → the normalized client's object include flags. */
function objectInclude(options: GetObjectParams['options']) {
  return {
    type: true as const,
    ...(options?.showContent ? { content: true as const, json: true as const } : {}),
    ...(options?.showOwner ? { owner: true as const } : {}),
    ...(options?.showPreviousTransaction ? { previousTransaction: true as const } : {}),
    ...(options?.showDisplay ? { display: true as const } : {}),
  }
}

/** Normalized dynamic-field entry → JSON-RPC DynamicFieldInfo. */
function grpcDynamicFieldToJsonRpc(
  field: {
    fieldId?: string
    childId?: string
    $kind?: string
    type?: string
    valueType?: string
    name?: { type?: string; bcs?: Uint8Array; json?: unknown }
  },
  parentId: string,
): Record<string, unknown> {
  const nameType = field.name?.type ?? ''
  let nameValue: unknown
  if (field.name?.bcs && nameType) {
    try {
      nameValue = dynamicFieldNameValue(nameType, field.name.bcs)
    } catch {
      nameValue = undefined
    }
  }
  return {
    id: { parentId, ...(field.childId ? { objectId: field.childId } : {}) },
    objectId: field.childId ?? field.fieldId ?? '',
    objectType: field.valueType ?? '',
    type: field.$kind === 'DynamicObject' ? 'dynamic_object_field' : 'dynamic_field',
    version: '0',
    digest: '',
    bcsEncoding: 'base64',
    bcsName: '',
    ...(nameValue !== undefined ? { name: { type: nameType, value: nameValue } } : {}),
  }
}

/** Decodes a dynamic-field NAME value the way JSON-RPC renders it. */
function dynamicFieldNameValue(type: string, bytes: Uint8Array): unknown {
  if (type === 'address') return `0x${Buffer.from(bytes).toString('hex')}`
  if (type.includes('::')) {
    // struct names: the JSON-RPC render is the value's address form when the
    // bytes are an address; otherwise leave undecoded
    if (bytes.length === 32) return `0x${Buffer.from(bytes).toString('hex')}`
    return undefined
  }
  return pureBcsSchemaFromTypeName(type as never).parse(bytes)
}
