/**
 * Pure gRPC→JSON-RPC shape translations used by {@link ./grpc.ts}.
 *
 * The gRPC normalized layer (SuiGrpcClient + the raw sui.rpc.v2 services)
 * renders results in its own shapes; every SDK consumer was built against the
 * JSON-RPC shapes. These helpers rebuild the JSON-RPC renderings from the
 * normalized fields, keeping the translation table in one testable place.
 *
 * Inputs are typed structurally (only the fields each helper consumes), so the
 * helpers are unit-testable without wiring a gRPC transport.
 */
import { pureBcsSchemaFromTypeName } from '@mysten/sui/bcs'
import type { SuiEventFilter, TransactionFilter } from '@mysten/sui/jsonRpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import bs58 from 'bs58'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'

/** normalizeStructTag, guarded: bare addresses and non-tag strings pass through. */
export function normalizeType(type: string): string {
  return type.includes('::') && type.split('::').length >= 3 ? normalizeStructTag(type) : type
}

// ── structural input types (normalized gRPC shapes, only consumed fields) ──

export type GrpcTimestamp = { seconds?: bigint | string; nanos?: number | string }

export type GrpcCheckpoint = {
  sequenceNumber?: bigint | string
  digest?: string
  summary?: {
    epoch?: bigint | string
    timestamp?: GrpcTimestamp
  }
  transactions?: { digest?: string }[]
}

export type GrpcExecutionError = {
  $kind?: string
  message?: string
  command?: number
  MoveAbort?: { abortCode?: string; location?: GrpcMoveLocation; cleverError?: unknown } | undefined
}

export type GrpcMoveLocation = {
  package?: string
  module?: string
  function?: number
  instruction?: number
  functionName?: string
}

export type GrpcEvent = {
  packageId?: string
  module?: string
  sender?: string
  eventType?: string
  /** normalized layer: raw bytes */
  bcs?: Uint8Array | null
  /** raw proto: the Bcs message */
  contents?: { value?: Uint8Array } | null
  json?: unknown
  checkpoint?: string | null
  transactionDigest?: string
  eventIndex?: number | string | null
}

/** The event's BCS bytes: the normalized layer's `bcs`, or the raw proto's `contents` message. */
export function eventBcsBytes(event: GrpcEvent): Uint8Array | undefined {
  const bytes = event.bcs ?? event.contents?.value
  return bytes?.length ? bytes : undefined
}

export type GrpcTransaction = {
  digest?: string
  epoch?: string | null
  /** normalized layer: ms since epoch; raw proto: google.protobuf.Timestamp. */
  timestampMs?: number | null
  timestamp?: GrpcTimestamp | null
  checkpoint?: bigint | string | null
  status?: { success?: boolean | null; error?: GrpcExecutionError | null } | null
  effects?: {
    status?: { success?: boolean | null; error?: GrpcExecutionError | null } | null
    gasUsed?: {
      computationCost?: string
      storageCost?: string
      storageRebate?: string
      nonRefundableStorageFee?: string
    } | null
    changedObjects?:
      | {
          objectId?: string
          idOperation?: string | null
          outputOwner?: Record<string, unknown> | null
          inputOwner?: Record<string, unknown> | null
        }[]
      | null
    created?:
      | { owner?: unknown; reference?: { objectId?: string; version?: string; digest?: string } }[]
      | null
    gasObject?: { objectId?: string } | null
    eventsDigest?: string | null
    dependencies?: string[] | null
    lamportVersion?: string | null
  } | null
  transaction?: GrpcTransactionData | null
  signatures?: string[]
  balanceChanges?: unknown
  /** raw proto: TransactionEvents wrapper; normalized layer: flat array. */
  events?: { events?: GrpcEvent[] } | GrpcEvent[] | null
}

export type GrpcArgument =
  | { $kind: 'GasCoin'; GasCoin: true }
  | { $kind: 'Input'; Input: number }
  | { $kind: 'Result'; Result: number }
  | { $kind: 'NestedResult'; NestedResult: [number, number] }

export type GrpcCommand = Record<
  | 'MoveCall'
  | 'TransferObjects'
  | 'SplitCoins'
  | 'MergeCoins'
  | 'Publish'
  | 'MakeMoveVec'
  | 'Upgrade',
  unknown
> & { $kind?: string }

export type GrpcTransactionData = {
  sender?: string | null
  gasData?: {
    budget?: string | null
    owner?: string | null
    price?: string | null
    payment?: { objectId?: string; version?: string; digest?: string }[] | null
  } | null
  expiration?: { $kind?: string } | null
  commands?: GrpcCommand[] | null
  inputs?: GrpcInput[] | null
  version?: string | number | null
}

export type GrpcInput =
  | { $kind: 'Pure'; Pure: { bytes?: string | Uint8Array } }
  | { $kind: 'Object'; Object: Record<string, unknown> }
  /** normalized: $kind discriminates; raw proto: numeric kind, no $kind. */
  | { $kind?: string; kind?: number; [key: string]: unknown }

export type GrpcObject = {
  objectId?: string
  version?: string
  digest?: string
  type?: string
  owner?: Record<string, unknown> | null
  previousTransaction?: string | null
  json?: unknown
  content?: Uint8Array
}

// ── JSON-RPC output types (only the fields the helpers produce) ──

type JsonRpcCheckpoint = {
  epoch: string
  digest: string
  sequenceNumber: string
  timestampMs: string
  transactions: string[]
}

type JsonRpcEvent = {
  id: { txDigest: string; eventSeq: string }
  packageId: string
  parsedJson: unknown
  sender: string
  timestampMs?: string
  transactionModule: string
  type: string
  bcs: string
  bcsEncoding: 'base64'
}

type JsonRpcArgument =
  | 'GasCoin'
  | { Input: number }
  | { Result: number }
  | { NestedResult: [number, number] }

type JsonRpcCallArg =
  | {
      type: 'object'
      digest: string
      objectId: string
      objectType: 'immOrOwnedObject'
      version: string
    }
  | {
      type: 'object'
      initialSharedVersion: string
      mutable: boolean
      objectId: string
      objectType: 'sharedObject'
    }
  | { type: 'object'; digest: string; objectId: string; objectType: 'receiving'; version: string }
  | { type: 'pure'; value: unknown; valueType?: string | null }

// ── helpers ──

/**
 * The gRPC chain identifier is the base58 genesis checkpoint digest; JSON-RPC's
 * `sui_getChainIdentifier` is its first 4 bytes hexlified (e.g. `4c78adac`).
 */
export function grpcChainIdentifierToJsonRpc(base58: string): string {
  const bytes = bs58.decode(base58)
  if (bytes.length < 4)
    throw new CCIPError(
      CCIPErrorCode.DATA_PARSE_FAILED,
      `gRPC chain identifier too short: ${base58.slice(0, 8)}…`,
    )
  return Buffer.from(bytes.subarray(0, 4)).toString('hex')
}

export function grpcCheckpointToJsonRpc(checkpoint: GrpcCheckpoint): JsonRpcCheckpoint {
  const seconds = checkpoint.summary?.timestamp?.seconds
  const nanos = checkpoint.summary?.timestamp?.nanos
  const timestampMs =
    seconds != null
      ? (Number(seconds) * 1000 + Math.floor(Number(nanos ?? 0) / 1e6)).toString()
      : '0'
  return {
    epoch: String(checkpoint.summary?.epoch ?? '0'),
    digest: checkpoint.digest ?? '',
    sequenceNumber: String(checkpoint.sequenceNumber ?? '0'),
    timestampMs,
    transactions: (checkpoint.transactions ?? [])
      .map((tx) => tx.digest ?? '')
      .filter((digest) => digest !== ''),
  }
}

/** The transaction's events, unwrapping the raw proto TransactionEvents envelope. */
export function grpcTransactionEvents(tx: GrpcTransaction): GrpcEvent[] {
  const events = tx.events
  if (!events) return []
  return Array.isArray(events) ? events : (events.events ?? [])
}

/**
 * Converts a google.protobuf.Value message (the raw proto path serves these)
 * into plain JSON. The normalized layer does this with `Value.toJson`; the
 * proto module is not exported, so the conversion is inlined here. Values that
 * are already plain JSON pass through.
 */
export function protoValueToJson(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  const record = value as {
    kind?: {
      oneofKind?: string
      structValue?: { fields?: Record<string, unknown> }
      listValue?: { elements?: unknown[] }
      stringValue?: string
      numberValue?: number
      boolValue?: boolean
      nullValue?: unknown
    }
  }
  const kind = record.kind
  if (kind?.oneofKind == null) return value
  switch (kind.oneofKind) {
    case 'structValue':
      return Object.fromEntries(
        Object.entries(kind.structValue?.fields ?? {}).map(([key, item]) => [
          key,
          protoValueToJson(item),
        ]),
      )
    case 'listValue':
      return (kind.listValue?.elements ?? []).map((item) => protoValueToJson(item))
    case 'stringValue':
      return kind.stringValue
    case 'numberValue':
      return kind.numberValue
    case 'boolValue':
      return kind.boolValue
    case 'nullValue':
      return null
    default:
      return value
  }
}

/** The transaction's checkpoint timestamp as JSON-RPC `timestampMs` (string ms). */
function grpcTimestampMs(tx: GrpcTransaction): string | undefined {
  if (tx.timestampMs != null) return String(tx.timestampMs)
  const timestamp = tx.timestamp
  if (timestamp?.seconds != null)
    return (
      Number(timestamp.seconds) * 1000 +
      Math.floor(Number(timestamp.nanos ?? 0) / 1e6)
    ).toString()
  return undefined
}

/**
 * Rebuilds the JSON-RPC execution-status error string. JSON-RPC renders Move
 * aborts as
 *   MoveAbort(MoveLocation { module: ModuleId { address: 0x…, name: "offramp" },
 *             function: 12, instruction: 34, function_name: Some("fn") }, 7)
 * (newer nodes; the SDK's failure decoder regex-parses this exact shape).
 *
 * Accepts both the normalized error shape ({ $kind, message, MoveAbort }) and
 * the raw proto's ({ description, command, kind, abort: { abortCode, location } })
 * — the raw ledger service returns the latter (a failed getTransactionBlock's
 * effects.status.error would otherwise degrade to "Transaction failed").
 */
export function formatGrpcExecutionError(error: GrpcExecutionError): string {
  const normalizedAbort = error.MoveAbort
  // the raw proto nests the abort under `abort` with a `description` text field
  const rawAbort = (
    error as { abort?: { abortCode?: bigint | string; location?: GrpcMoveLocation } }
  ).abort
  const abort = normalizedAbort ?? rawAbort
  if (!abort)
    return error.message ?? (error as { description?: string }).description ?? 'Transaction failed'
  const abortCode = normalizedAbort
    ? normalizedAbort.abortCode
    : rawAbort?.abortCode != null
      ? String(rawAbort.abortCode)
      : undefined
  const location = abort.location
  const parts = [
    `module: ModuleId { address: ${location?.package ?? '0x0'}, name: "${location?.module ?? ''}" }`,
    `function: ${location?.function ?? 0}`,
    ...(location?.instruction != null ? [`instruction: ${location.instruction}`] : []),
    ...(location?.functionName ? [`function_name: Some("${location.functionName}")`] : []),
  ]
  return `MoveAbort(MoveLocation { ${parts.join(', ')} }, ${abortCode ?? '0'})`
}

export function grpcEventToJsonRpc(event: GrpcEvent): JsonRpcEvent {
  // JSON-RPC renders type strings with normalized (short) addresses
  const eventType = event.eventType ? normalizeType(event.eventType) : ''
  const splitIdx = eventType.lastIndexOf('::')
  return {
    id: {
      txDigest: event.transactionDigest ?? '',
      eventSeq: String(event.eventIndex ?? '0'),
    },
    packageId: normalizeType(event.packageId ?? eventType.slice(0, splitIdx)),
    parsedJson: event.json,
    sender: event.sender ?? '',
    transactionModule: `${normalizeType(event.packageId ?? '')}::${event.module ?? ''}`,
    type: eventType,
    bcs: Buffer.from(eventBcsBytes(event) ?? new Uint8Array()).toString('base64'),
    bcsEncoding: 'base64',
  }
}

/** Normalized gRPC argument → JSON-RPC SuiArgument. Raw-proto Argument: {kind: 1=GAS|2=INPUT|3=RESULT|4=NESTED_RESULT, input, result, subresult}. */
export function grpcArgumentToJsonRpc(
  argument: GrpcArgument | { kind?: number; input?: number; result?: number; subresult?: number },
): JsonRpcArgument {
  const raw = argument as { kind?: number; input?: number; result?: number; subresult?: number }
  if (raw.kind != null) {
    if (raw.kind === 1) return 'GasCoin'
    if (raw.kind === 2) return { Input: raw.input ?? 0 }
    if (raw.kind === 3) return { Result: raw.result ?? 0 }
    if (raw.kind === 4) return { NestedResult: [raw.result ?? 0, raw.subresult ?? 0] }
  }
  switch ((argument as GrpcArgument).$kind) {
    case 'Input':
      return { Input: (argument as { Input: number }).Input }
    case 'Result':
      return { Result: (argument as { Result: number }).Result }
    case 'NestedResult':
      return { NestedResult: (argument as { NestedResult: [number, number] }).NestedResult }
    default:
      return 'GasCoin'
  }
}

/** Normalized or raw-proto gRPC input → JSON-RPC SuiCallArg. Raw-proto Input: {kind: 1=PURE|2=IMM_OR_OWNED|3=SHARED|4=RECEIVING, pure, objectId, version, digest, mutable}. */
export function grpcInputToJsonRpc(input: GrpcInput): JsonRpcCallArg {
  const kind = input.$kind ?? (input as { kind?: number }).kind
  if (typeof kind === 'number') {
    const raw = input as {
      pure?: Uint8Array
      objectId?: string
      version?: string | bigint
      digest?: string
      mutable?: boolean
    }
    if (kind === 1)
      return {
        type: 'pure',
        value: `0x${Buffer.from(raw.pure ?? new Uint8Array()).toString('hex')}`,
      }
    if (kind === 2)
      return {
        type: 'object',
        objectType: 'immOrOwnedObject',
        objectId: raw.objectId ?? '',
        version: String(raw.version ?? '0'),
        digest: raw.digest ?? '',
      }
    if (kind === 3)
      return {
        type: 'object',
        objectType: 'sharedObject',
        objectId: raw.objectId ?? '',
        initialSharedVersion: String(raw.version ?? '0'),
        mutable: raw.mutable ?? false,
      }
    if (kind === 4)
      return {
        type: 'object',
        objectType: 'receiving',
        objectId: raw.objectId ?? '',
        version: String(raw.version ?? '0'),
        digest: raw.digest ?? '',
      }
  }
  if (kind === 'Pure') {
    const pure = (input as { Pure: { bytes?: string | Uint8Array } }).Pure
    const bytes =
      typeof pure.bytes === 'string'
        ? new Uint8Array(Buffer.from(pure.bytes, 'base64'))
        : (pure.bytes ?? new Uint8Array())
    return { type: 'pure', value: `0x${Buffer.from(bytes).toString('hex')}` }
  }
  if (kind === 'Object') {
    const object = (input as { Object: Record<string, unknown> }).Object as {
      $kind?: string
      immutableOrOwned?: { objectId?: string; version?: string; digest?: string }
      ImmOrOwnedObject?: { objectId?: string; version?: string; digest?: string }
      shared?: { objectId?: string; initialSharedVersion?: string; mutable?: boolean }
      SharedObject?: { objectId?: string; initialSharedVersion?: string; mutable?: boolean }
      receiving?: { objectId?: string; version?: string; digest?: string }
      Receiving?: { objectId?: string; version?: string; digest?: string }
    }
    // the normalized layer discriminates the object variant with a $kind
    // (ImmOrOwnedObject/SharedObject/Receiving); accept both spellings
    const shared = object.shared ?? object.SharedObject
    const receiving = object.receiving ?? object.Receiving
    const owned = object.immutableOrOwned ?? object.ImmOrOwnedObject
    if (shared)
      return {
        type: 'object',
        objectType: 'sharedObject',
        objectId: shared.objectId ?? '',
        initialSharedVersion: shared.initialSharedVersion ?? '0',
        mutable: shared.mutable ?? false,
      }
    const target = receiving ?? owned ?? {}
    return {
      type: 'object',
      objectType: receiving ? 'receiving' : 'immOrOwnedObject',
      objectId: target.objectId ?? '',
      version: target.version ?? '0',
      digest: target.digest ?? '',
    }
  }
  throw new CCIPError(
    CCIPErrorCode.DATA_FORMAT_UNSUPPORTED,
    `Unsupported gRPC input kind: ${String(input.$kind)}`,
  )
}

/** Normalized or raw-proto gRPC command → JSON-RPC SuiTransaction (the PTB `transactions` entries). */
export function grpcCommandToJsonRpc(command: GrpcCommand): Record<string, unknown> {
  // the raw proto wraps: {command: {oneofKind: 'moveCall', moveCall: {...}}}
  const wrapper = (command as { command?: { oneofKind?: string } & Record<string, unknown> })
    .command
  if (wrapper?.oneofKind != null) {
    const kind = String(wrapper.oneofKind)
    const payload = wrapper[kind]
    // proto field names: camelCase per protobuf-ts (moveCall/transferObjects/…)
    return grpcCommandToJsonRpc({ $kind: kind, [kind]: payload } as unknown as GrpcCommand)
  }
  const rawKind = command.$kind ?? Object.keys(command).find((key) => key !== '$kind') ?? ''
  // accept both the normalized PascalCase (SplitCoins) and the raw proto's
  // lowerCamelCase (splitCoins)
  const kind = rawKind.charAt(0).toUpperCase() + rawKind.slice(1)
  const record = command as Record<string, unknown>
  const payload = record[rawKind] ?? record[kind]
  const argumentsOf = (value: unknown): unknown[] =>
    Array.isArray(value) ? value.map((arg) => grpcArgumentToJsonRpc(arg as GrpcArgument)) : []
  switch (kind) {
    case 'MoveCall': {
      const call = payload as {
        package?: string
        module?: string
        function?: string
        typeArguments?: string[]
        arguments?: GrpcArgument[]
      }
      return {
        MoveCall: {
          package: call.package ?? '',
          module: call.module ?? '',
          function: call.function ?? '',
          type_arguments: call.typeArguments ?? [],
          arguments: argumentsOf(call.arguments),
        },
      }
    }
    case 'TransferObjects': {
      const call = payload as { objects?: GrpcArgument[]; address?: GrpcArgument }
      return {
        TransferObjects: [argumentsOf(call.objects), grpcArgumentToJsonRpc(call.address!)],
      }
    }
    case 'SplitCoins': {
      const call = payload as { coin?: GrpcArgument; amounts?: GrpcArgument[] }
      return {
        SplitCoins: [grpcArgumentToJsonRpc(call.coin!), argumentsOf(call.amounts)],
      }
    }
    case 'MergeCoins': {
      // normalized TS shape: {coin, sources}; JSON-RPC/proto: coinsToMerge
      const call = payload as {
        coin?: GrpcArgument
        coinsToMerge?: GrpcArgument[]
        sources?: GrpcArgument[]
      }
      return {
        MergeCoins: [
          grpcArgumentToJsonRpc(call.coin!),
          argumentsOf(call.coinsToMerge ?? call.sources),
        ],
      }
    }
    case 'Publish': {
      const call = payload as { modules?: Uint8Array[] | string[]; dependencies?: string[] }
      const modules = (call.modules ?? []).map((bytes) =>
        typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('base64'),
      )
      return { Publish: modules }
    }
    case 'MakeMoveVec': {
      // normalized TS shape: {type, elements}; JSON-RPC/proto: elementType
      const call = payload as {
        elementType?: string | null
        type?: string | null
        elements?: GrpcArgument[]
      }
      return {
        MakeMoveVec: [call.elementType ?? call.type ?? null, argumentsOf(call.elements)],
      }
    }
    case 'Upgrade': {
      const call = payload as {
        modules?: Uint8Array[] | string[]
        dependencies?: string[]
        package?: string
        ticket?: GrpcArgument
      }
      const modules = (call.modules ?? []).map((bytes) =>
        typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('base64'),
      )
      return {
        Upgrade: [modules, call.package ?? '', grpcArgumentToJsonRpc(call.ticket!)],
      }
    }
    default:
      throw new CCIPError(
        CCIPErrorCode.DATA_FORMAT_UNSUPPORTED,
        `Unsupported gRPC command kind: ${kind}`,
      )
  }
}

/**
 * Normalized transaction → JSON-RPC SuiTransactionBlockResponse (only the
 * fields the JSON-RPC shapes carry and the SDK consumes).
 */
export function grpcTransactionToJsonRpc(
  tx: GrpcTransaction,
  options?: GetTransactionBlockOptions,
): Record<string, unknown> {
  const effects = tx.effects
  const status = effects?.status ?? tx.status
  const data = tx.transaction
  const wants = (flag: keyof NonNullable<GetTransactionBlockOptions> | 'showBalanceChanges') =>
    options?.[flag] === true

  const response: Record<string, unknown> = {
    digest: tx.digest ?? '',
    // the raw proto carries a bigint; JSON-RPC renders a string (and
    // JSON.stringify throws on bigints)
    checkpoint: tx.checkpoint != null ? String(tx.checkpoint) : undefined,
    timestampMs: grpcTimestampMs(tx) ?? undefined,
    ...(tx.signatures ? { signatures: tx.signatures } : {}),
  }

  if (wants('showInput')) {
    // the normalized layer flattens the PTB (commands/inputs); the raw proto
    // nests it under kind.programmableTransaction with proto-shaped entries
    const rawPtb = (
      data as
        | {
            kind?: {
              data?: {
                programmableTransaction?: { inputs?: GrpcInput[]; commands?: GrpcCommand[] }
              }
            }
          }
        | undefined
    )?.kind?.data?.programmableTransaction
    const commands = data?.commands ?? rawPtb?.commands ?? []
    const inputs = data?.inputs ?? rawPtb?.inputs ?? []
    // the raw proto carries gas under gasPayment (GasPayment), the normalized
    // layer under gasData
    const rawGas = (
      data as {
        gasPayment?: {
          budget?: bigint | string | null
          owner?: string | null
          price?: bigint | string | null
          objects?: { objectId?: string; version?: bigint | string; digest?: string }[] | null
        } | null
      }
    ).gasPayment
    const gasData =
      data?.gasData ??
      (rawGas
        ? {
            budget: rawGas.budget != null ? String(rawGas.budget) : null,
            owner: rawGas.owner,
            price: rawGas.price != null ? String(rawGas.price) : null,
            payment: (rawGas.objects ?? []).map((coin) => ({
              digest: coin.digest ?? '',
              objectId: coin.objectId ?? '',
              version: coin.version != null ? String(coin.version) : '0',
            })),
          }
        : undefined)
    response.transaction = {
      data: {
        messageVersion: 'v1',
        sender: data?.sender ?? '',
        transaction: {
          kind: 'ProgrammableTransaction',
          transactions: commands.map((command) => grpcCommandToJsonRpc(command)),
          inputs: inputs.map((input) => grpcInputToJsonRpc(input)),
        },
        gasData: {
          budget: gasData?.budget ?? '0',
          owner: gasData?.owner ?? '',
          payment: (gasData?.payment ?? []).map((coin) => ({
            digest: coin.digest ?? '',
            objectId: coin.objectId ?? '',
            version: coin.version ?? '0',
          })),
          price: gasData?.price ?? '0',
        },
      },
    }
  }

  if (wants('showEffects')) {
    const failed = status?.success === false
    const changed = effects?.changedObjects ?? []
    response.effects = {
      status: {
        status: failed ? 'failure' : 'success',
        // `failed` proves status (and its error) present
        ...(failed ? { error: formatGrpcExecutionError(status.error ?? {}) } : {}),
      },
      gasUsed: {
        computationCost: effects?.gasUsed?.computationCost ?? '0',
        storageCost: effects?.gasUsed?.storageCost ?? '0',
        storageRebate: effects?.gasUsed?.storageRebate ?? '0',
        nonRefundableStorageFee: effects?.gasUsed?.nonRefundableStorageFee ?? '0',
      },
      // consumers read `effects.created` (OwnerCap walks): rebuild it from the
      // changed objects the proto reports as Created
      created: changed
        .filter((change) => change.idOperation === 'Created')
        .map((change) => ({
          owner: change.outputOwner ?? { Immutable: true },
          reference: { objectId: change.objectId ?? '', version: '0', digest: '' },
        })),
      gasObject: effects?.gasObject?.objectId
        ? { reference: { objectId: effects.gasObject.objectId, version: '0', digest: '' } }
        : undefined,
      ...(effects?.eventsDigest ? { eventsDigest: effects.eventsDigest } : {}),
      dependencies: effects?.dependencies ?? [],
      ...(effects?.lamportVersion ? { lamportVersion: effects.lamportVersion } : {}),
    }
  }

  if (wants('showEvents')) {
    response.events = grpcTransactionEvents(tx).map((event) => grpcEventToJsonRpc(event))
  }
  if (wants('showBalanceChanges')) response.balanceChanges = tx.balanceChanges ?? []

  return response
}

type GetTransactionBlockOptions =
  | {
      showInput?: boolean | null
      showEvents?: boolean | null
      showEffects?: boolean | null
      showBalanceChanges?: boolean | null
      showRawInput?: boolean | null
      showRawEffects?: boolean | null
      showBcs?: boolean | null
    }
  | null
  | undefined

/**
 * Normalized object → JSON-RPC SuiObjectResponse. The parsed fields come from
 * the object's `json` rendering (the same decimal-string rendering JSON-RPC's
 * `content.fields` uses); package objects have no parsed content on gRPC —
 * the SDK's disassembly reads go through `SuiClientLike.getPackageDisassembly`.
 */
export function grpcObjectToJsonRpc(
  object: GrpcObject,
  options?: {
    showType?: boolean | null
    showOwner?: boolean | null
    showContent?: boolean | null
    showDisplay?: boolean | null
    showPreviousTransaction?: boolean | null
  } | null,
): Record<string, unknown> {
  if (!object.objectId) return { error: { code: 'notExists', object_id: 'unknown' } }
  const wants = (flag: string) => options?.[flag as keyof typeof options] === true
  const data: Record<string, unknown> = {
    objectId: object.objectId,
    version: object.version ?? '1',
    digest: object.digest ?? '',
  }
  // JSON-RPC renders type strings with normalized (short) addresses
  if (object.type) data.type = normalizeType(object.type)
  if (object.owner) data.owner = grpcOwnerToJsonRpc(object.owner)
  if (object.previousTransaction) data.previousTransaction = object.previousTransaction
  if (wants('showContent')) {
    if (object.type === 'package') {
      // JSON-RPC renders a package object's content as disassembled sources;
      // the gRPC object read does not carry them. Callers that need the
      // disassembly use SuiClientLike.getPackageDisassembly.
      data.content = { dataType: 'package', disassembled: {} }
    } else {
      data.content = {
        dataType: 'moveObject',
        fields: protoValueToJson(object.json) ?? {},
        hasPublicTransfer: true,
      }
    }
  }
  return { data }
}

type GrpcOwner = Record<string, unknown> & { $kind?: string }

/** Normalized owner → JSON-RPC ObjectOwner. */
export function grpcOwnerToJsonRpc(owner: GrpcOwner): Record<string, unknown> {
  switch (owner.$kind) {
    case 'Immutable':
      return { Immutable: true }
    case 'AddressOwner':
      return { AddressOwner: owner.AddressOwner }
    case 'ObjectOwner':
      return { ObjectOwner: owner.ObjectOwner }
    case 'Shared':
      return {
        Shared: {
          initialSharedVersion:
            (owner.Shared as { initialSharedVersion?: string } | undefined)?.initialSharedVersion ??
            '0',
        },
      }
    default:
      return { Immutable: true }
  }
}

// ── BCS decoding (descriptor-driven) ──
// The ledger's event json can be incomplete (large fields render empty); the
// event/object BCS content is always complete. This decodes BCS bytes into
// the JSON-RPC Move-value rendering, guided by the datatype descriptors.

class BcsCursor {
  bytes: Uint8Array
  offset = 0
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length)
      throw new CCIPError(CCIPErrorCode.DATA_PARSE_FAILED, 'BCS decode: out of bounds')
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }
  u8(): number {
    return this.take(1)[0]!
  }
  uleb(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = this.u8()
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result
      shift += 7
    }
  }
  address(): string {
    return '0x' + Buffer.from(this.take(32)).toString('hex')
  }
}

/**
 * Decodes a BCS-encoded Move value into the JSON-RPC rendering.
 * @param isNested - object-mode nesting: structs wrap as {fields}; events stay flat.
 */
export function decodeBcsMoveValue(
  cursor: BcsCursor,
  type: GrpcTypeRef | undefined,
  resolveDatatype: (typeName: string) => GrpcDatatype | undefined,
  mode: 'object' | 'event',
  bindings: (GrpcTypeRef | undefined)[] = [],
): unknown {
  if (type == null)
    throw new CCIPError(CCIPErrorCode.DATA_PARSE_FAILED, 'BCS decode: unresolvable type')
  if (type.type === TYPE_PARAMETER)
    return decodeBcsMoveValue(
      cursor,
      type.typeParameter != null ? bindings[type.typeParameter] : undefined,
      resolveDatatype,
      mode,
      bindings,
    )
  if (type.type === TYPE_ADDRESS) return cursor.address()
  if (type.type === TYPE_BOOL) return cursor.u8() !== 0
  if (type.type! in BCS_INT_BITS) {
    const bits = BCS_INT_BITS[type.type!]!
    const length = bits / 8
    const bytes = cursor.take(length)
    // JSON-RPC renders u64+ as decimal strings; u8/u16/u32 as numbers
    let value = 0n
    for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]!)
    return bits <= 32 ? Number(value) : value.toString()
  }
  if (type.type === TYPE_VECTOR) {
    const [inner] = type.typeParameterInstantiation ?? []
    const length = cursor.uleb()
    const items: unknown[] = []
    for (let i = 0; i < length; i++)
      items.push(decodeBcsMoveValue(cursor, inner, resolveDatatype, mode, bindings))
    // vector<u8>: JSON-RPC renders number arrays; a vector<u8> inside a
    // string type is handled by the String datatype special-case below
    if (inner?.type === TYPE_U8) return items.map((item) => Number(item))
    return items
  }
  if (type.type === TYPE_DATATYPE) {
    const typeName = type.typeName ?? ''
    // UID/ID: 32 raw bytes; JSON-RPC flattens ID to the address and renders
    // UID as its {id: address} wrapper
    if (typeName.endsWith('::object::ID')) return cursor.address()
    if (typeName.endsWith('::object::UID')) return { id: cursor.address() }
    // std::string: a UTF-8 vector<u8>
    if (typeName.endsWith('::string::String')) {
      const length = cursor.uleb()
      return Buffer.from(cursor.take(length)).toString('utf8')
    }
    const datatype = resolveDatatype(typeName)
    if (!datatype)
      throw new CCIPError(
        CCIPErrorCode.DATA_PARSE_FAILED,
        `BCS decode: unresolvable datatype ${typeName}`,
      )
    const ownInstantiation = type.typeParameterInstantiation ?? []
    const childBindings =
      ownInstantiation.length > 0
        ? ownInstantiation.map((ref) =>
            ref.type === TYPE_PARAMETER && ref.typeParameter != null
              ? bindings[ref.typeParameter]
              : ref,
          )
        : splitGenericArgs(typeName)
            .map((arg) => stringToTypeRef(arg))
            .filter((ref): ref is GrpcTypeRef => ref != null)
    // enums: a u8 variant tag selects the variant's fields (declaration order
    // — sort by position, like struct fields, in case the descriptor lists
    // variants out of order)
    if (datatype.variants?.length) {
      const variants = [...datatype.variants].sort(
        (left, right) => (left.position ?? 0) - (right.position ?? 0),
      )
      const variant = variants[cursor.u8()]
      if (!variant)
        throw new CCIPError(
          CCIPErrorCode.DATA_PARSE_FAILED,
          `BCS decode: variant out of range for ${typeName}`,
        )
      const rendered: Record<string, unknown> = {}
      for (const field of variant.fields ?? []) {
        rendered[field.name ?? ''] = decodeBcsMoveValue(
          cursor,
          field.type,
          resolveDatatype,
          mode,
          childBindings,
        )
      }
      return { [variant.name ?? '']: rendered }
    }
    // structs: fields decode in the descriptor's declared (position) order
    const rendered: Record<string, unknown> = {}
    for (const field of [...(datatype.fields ?? [])].sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    )) {
      rendered[field.name ?? ''] = decodeBcsMoveValue(
        cursor,
        field.type,
        resolveDatatype,
        mode,
        childBindings,
      )
    }
    return mode === 'object' ? { fields: rendered } : rendered
  }
  throw new CCIPError(
    CCIPErrorCode.DATA_PARSE_FAILED,
    `BCS decode: unsupported type ${String(type.type)}`,
  )
}

export { BcsCursor }

export type GrpcTypeRef = {
  type?: number
  typeName?: string
  typeParameterInstantiation?: GrpcTypeRef[]
  /** TYPE_PARAMETER refs: the datatype's generic parameter index. */
  typeParameter?: number
}

export type GrpcDatatype = {
  typeName?: string
  module?: string
  name?: string
  fields?: { name?: string; position?: number; type?: GrpcTypeRef }[]
  variants?: {
    name?: string
    position?: number
    fields?: { name?: string; position?: number; type?: GrpcTypeRef }[]
  }[]
}
// OpenSignatureBody.Type enum values (sui.rpc.v2)
const TYPE_ADDRESS = 1
const TYPE_BOOL = 2
const TYPE_U8 = 3
const TYPE_U16 = 4
const TYPE_U32 = 5
const TYPE_U64 = 6
const TYPE_U128 = 7
const TYPE_U256 = 8
const TYPE_VECTOR = 9
const TYPE_DATATYPE = 10
const TYPE_PARAMETER = 11

const BCS_INT_BITS: Record<number, number> = {
  [TYPE_U8]: 8,
  [TYPE_U16]: 16,
  [TYPE_U32]: 32,
  [TYPE_U64]: 64,
  [TYPE_U128]: 128,
  [TYPE_U256]: 256,
}

const PRIMITIVE_TYPES: Record<string, number> = {
  address: TYPE_ADDRESS,
  bool: TYPE_BOOL,
  u8: TYPE_U8,
  u16: TYPE_U16,
  u32: TYPE_U32,
  u64: TYPE_U64,
  u128: TYPE_U128,
  u256: TYPE_U256,
}

/** Splits a type string's top-level `<…>` argument list at depth-0 commas. */
export function splitGenericArgs(typeName: string): string[] {
  const open = typeName.indexOf('<')
  if (open < 0 || !typeName.endsWith('>')) return []
  const args: string[] = []
  let depth = 1 // already inside the opening '<'
  let start = open + 1
  for (let i = start; i < typeName.length; i++) {
    const char = typeName[i]
    if (char === '<') depth++
    else if (char === '>') {
      depth--
      if (depth === 0) {
        args.push(typeName.slice(start, i))
        break
      }
    } else if (char === ',' && depth === 1) {
      args.push(typeName.slice(start, i).trim())
      start = i + 1
    }
  }
  return args.map((arg) => arg.trim())
}

/** Converts a Move type string (name, vector<…>, or generic) into a type ref. */
function stringToTypeRef(typeString: string): GrpcTypeRef | undefined {
  const primitive = PRIMITIVE_TYPES[typeString]
  if (primitive != null) return { type: primitive }
  if (typeString.startsWith('vector<') && typeString.endsWith('>'))
    return {
      type: TYPE_VECTOR,
      typeParameterInstantiation: [stringToTypeRef(typeString.slice(7, -1).trim())].filter(
        (ref): ref is GrpcTypeRef => ref != null,
      ),
    }
  if (typeString.includes('::') || typeString.startsWith('0x'))
    return { type: TYPE_DATATYPE, typeName: typeString }
  return undefined
}

/**
 * Normalized simulate-transaction result → JSON-RPC DevInspectResults. Return
 * values are BCS bytes per command output; JSON-RPC's `results[].returnValues`
 * entries are `[data, type]` tuples.
 */
export function grpcSimulateToDevInspect(result: {
  Transaction?: GrpcTransaction & { commandResults?: GrpcCommandResult[] }
  FailedTransaction?: GrpcTransaction & { commandResults?: GrpcCommandResult[] }
  commandResults?: GrpcCommandResult[]
}): Record<string, unknown> {
  const tx = result.Transaction ?? result.FailedTransaction
  const status = tx?.effects?.status ?? tx?.status
  const commandResults = result.commandResults ?? []
  const results = commandResults.map((command) => ({
    returnValues: (command.returnValues ?? []).map((returnValue) => {
      const bytes = returnValue.bcs ?? new Uint8Array()
      const type = returnValue.type ?? 'vector<u8>'
      return [bytes, type]
    }),
  }))
  return {
    results: results.length ? results : undefined,
    effects: {
      status: {
        status: status?.success === false ? 'failure' : 'success',
        ...(status?.success === false
          ? { error: formatGrpcExecutionError(status.error ?? {}) }
          : {}),
      },
    },
    ...(status?.success === false ? { error: formatGrpcExecutionError(status.error ?? {}) } : {}),
  }
}

type GrpcCommandResult = {
  returnValues?: { bcs?: Uint8Array; type?: string; json?: unknown }[]
  mutatedReferences?: unknown[]
}

/**
 * Rebuilds a disassembly-like source per module from the package service's
 * metadata. Consumers parse: module names (keys), `use <addr>::<module>`
 * import lines, `<field>_object_id:` field names, and `struct X` names — so
 * the synthesized source renders one `use` per dependency/datatype reference
 * and one `struct` per datatype with its field names.
 */
export function grpcPackageToDisassembled(pkg: {
  storageId?: string
  originalId?: string
  modules?: {
    name?: string
    contents?: Uint8Array
    datatypes?: {
      name?: string
      fields?: { name?: string; type?: GrpcTypeRef }[]
    }[]
    dependencies?: { address?: string; name?: string }[]
    functions?: {
      parameters?: { body?: GrpcTypeRef }[]
      returns?: { body?: GrpcTypeRef }[]
    }[]
  }[]
}): Promise<Record<string, string>> {
  const disassembled: Record<string, string> = {}
  for (const module of pkg.modules ?? []) {
    const name = module.name ?? ''
    const lines: string[] = []
    const imports = new Set<string>()
    const addTypeImports = (type?: GrpcTypeRef): void => {
      if (type?.typeName?.includes('::')) {
        const [address, depModule] = type.typeName.split('::')
        imports.add(`use ${address}::${depModule};`)
      }
      for (const parameter of type?.typeParameterInstantiation ?? []) addTypeImports(parameter)
    }
    for (const dependency of module.dependencies ?? []) {
      if (dependency.address && dependency.name)
        lines.push(`use ${dependency.address}::${dependency.name};`)
    }
    for (const datatype of module.datatypes ?? []) {
      lines.push(`struct ${datatype.name ?? ''}`)
      for (const field of datatype.fields ?? []) {
        lines.push(`  ${field.name ?? ''}: ${renderGrpcType(field.type)}`)
        addTypeImports(field.type)
      }
      lines.push('')
    }
    for (const fn of module.functions ?? []) {
      for (const signature of [...(fn.parameters ?? []), ...(fn.returns ?? [])])
        addTypeImports(signature.body)
    }
    disassembled[name] = [...lines, ...imports].join('\n')
  }
  return Promise.resolve(disassembled)
}

function renderGrpcType(type: { typeName?: string; type?: number | string } | undefined): string {
  if (!type) return 'unknown'
  if (type.typeName) return type.typeName
  return String(type.type ?? 'unknown')
}

/** Normalized package → JSON-RPC SuiMoveNormalizedModules (module name → stub). */
export function grpcPackageToNormalizedModules(pkg: {
  storageId?: string
  originalId?: string
  modules?: {
    name?: string
    datatypes?: unknown[]
    dependencies?: unknown[]
  }[]
}): Record<string, { address: string; name: string }> {
  // JSON-RPC's module.address is the DEFINING (original) package id, which
  // callers map called/latest package ids back through
  const address = pkg.originalId ?? pkg.storageId ?? ''
  const modules: Record<string, { address: string; name: string }> = {}
  for (const module of pkg.modules ?? []) {
    const name = module.name ?? ''
    modules[name] = { address, name }
  }
  return modules
}

/** JSON-RPC `{type, value}` dynamic-field name → the normalized client's `{type, bcs}`. */
export function dynamicFieldNameToBcs(name: { type: string; value: unknown }): {
  type: string
  bcs: Uint8Array
} {
  const schema = pureBcsSchemaFromTypeName(name.type as never)
  return { type: name.type, bcs: schema.serialize(name.value as never).toBytes() }
}

/** JSON-RPC SuiEventFilter → the normalized client's event filter. */
export function eventFilterToNormalized(
  filter: SuiEventFilter | null | undefined,
): { eventType: string } | { emitModule: string } | { sender: string } | undefined {
  if (!filter) return undefined
  if ('MoveEventType' in filter && filter.MoveEventType) return { eventType: filter.MoveEventType }
  if ('MoveModule' in filter)
    return {
      emitModule: `${filter.MoveModule.package}::${filter.MoveModule.module}`,
    }
  if ('Sender' in filter && filter.Sender) return { sender: filter.Sender }
  throw new CCIPError(
    CCIPErrorCode.METHOD_UNSUPPORTED,
    `Unsupported Sui event filter: ${Object.keys(filter).join(', ')}`,
  )
}

/** JSON-RPC TransactionFilter → the normalized client's transaction filter. */
export function transactionFilterToNormalized(
  filter: TransactionFilter | null | undefined,
): { function: string } | { sender: string } | undefined {
  if (!filter) return undefined
  if ('MoveFunction' in filter) {
    const { package: pkg, module, function: fn } = filter.MoveFunction
    return { function: [pkg, module, fn].filter(Boolean).join('::') }
  }
  if ('FromAddress' in filter && filter.FromAddress) return { sender: filter.FromAddress }
  // no ToAddress translation: the gRPC predicates have no recipient filter, and
  // mapping it to `sender` would silently return the recipient's SENT txs
  throw new CCIPError(
    CCIPErrorCode.METHOD_UNSUPPORTED,
    `Unsupported Sui transaction filter: ${Object.keys(filter).join(', ')}`,
  )
}
