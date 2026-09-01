/**
 * getRateLimiterState — read a `RateLimiter` contract's config from the ACS:
 * enabled/capacity/rate/current-tokens, direction, finality mode, and observers.
 *
 * Unlike {@link GetTokenPoolState}, `RateLimiter` has no dedicated deploy
 * result to inspect after `Initialize` (it's created as a side effect, and
 * `InitializeResult.rateLimiterCids` gives CIDs but not decoded config) — this
 * is the only way to confirm a specific lane's limiter actually has the
 * capacity/rate/enabled values you asked for.
 *
 * @packageDocumentation
 */

import { type CantonChain, decodeDamlRecord, extractFieldValue } from '../../../../canton/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { CantonQuery } from '../../query.ts'
import { RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'

/** Result of `getRateLimiterState`: the rate limiter's config. */
export interface GetRateLimiterStateResult {
  /** Rate-limiter instance ID. */
  instanceId: string
  /** Instance ID of the pool this limiter serves. */
  poolInstanceId: string
  /** Pool owner party (signatory of the RateLimiter contract). */
  poolOwner: string
  /** Remote chain selector this limiter applies to. */
  remoteChainSelector: string
  /** Direction the limiter applies to. */
  direction: 'inbound' | 'outbound'
  /** Finality mode. */
  mode: 'defaultFinality' | 'customFinality'
  /** Whether the limiter is enabled. */
  isEnabled: boolean
  /** Bucket capacity (max tokens). */
  capacity: string
  /** Refill rate (tokens per second). */
  rate: string
  /** Current available tokens in the bucket. */
  tokens: string
  /** Observer parties (EDS auto-detection). */
  observers: string[]
}

/** Parsed params for {@link GetRateLimiterState.read}. */
interface ParsedGetRateLimiterState {
  rateLimiterInstanceAddress: string
  poolOwner: string
}

/** Parameters for `getRateLimiterState`. */
export interface GetRateLimiterStateParams {
  /** RateLimiter `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`). */
  rateLimiterInstanceAddress: string
  /** Pool owner party (for ACS visibility — the RateLimiter's sole signatory). */
  poolOwner: string
}

/** Read a `RateLimiter` contract's config from the ACS. */
export class GetRateLimiterState extends CantonQuery<
  GetRateLimiterStateParams,
  GetRateLimiterStateResult,
  ParsedGetRateLimiterState
> {
  readonly name = 'getRateLimiterState'

  /** Validates the rate-limiter target + owner. */
  protected prepare(p: GetRateLimiterStateParams): ParsedGetRateLimiterState {
    if (!p.rateLimiterInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'rateLimiterInstanceAddress',
        'RateLimiter InstanceAddress is required',
      )
    }
    return {
      rateLimiterInstanceAddress: p.rateLimiterInstanceAddress,
      poolOwner: p.poolOwner,
    }
  }

  /**
   * Reads the RateLimiter contract from the ACS by InstanceAddress and decodes
   * its `createArgument`. Throws when the contract is not active or not visible.
   */
  protected async read(
    chain: CantonChain,
    p: ParsedGetRateLimiterState,
  ): Promise<GetRateLimiterStateResult> {
    const contract = await chain.findActiveContractByInstanceAddress(
      RATE_LIMITER_TEMPLATE_ID,
      p.rateLimiterInstanceAddress,
      [p.poolOwner],
    )
    if (!contract) {
      throw new CCTParamsInvalidError(
        this.name,
        'rateLimiterInstanceAddress',
        `RateLimiter ${p.rateLimiterInstanceAddress} is not active or not visible to ${p.poolOwner}`,
      )
    }

    const fields = decodeDamlRecord(contract.createArgument)
    return {
      instanceId: decodeString(fields['instanceId']),
      poolInstanceId: decodeString(fields['poolInstanceId']),
      poolOwner: decodeString(fields['poolOwner']),
      remoteChainSelector: decodeNumeric(fields['remoteChainSelector']),
      direction: decodeDirection(fields['direction']),
      mode: decodeMode(fields['mode']),
      isEnabled: decodeBool(fields['isEnabled']),
      capacity: decodeNumeric(fields['capacity']),
      rate: decodeNumeric(fields['rate']),
      tokens: decodeNumeric(fields['tokens']),
      observers: decodePartyList(fields['observers']),
    }
  }
}

/** Decode a required string field. */
function decodeString(value: unknown): string {
  const v = extractFieldValue(value)
  return typeof v === 'string' ? v : ''
}

/** Decode a Daml `Numeric 0`, stripping the trailing `.` some encodings add. */
function decodeNumeric(value: unknown): string {
  const v = extractFieldValue(value)
  return typeof v === 'string' ? v.replace(/\.$/, '') : ''
}

/** Decode a Daml `Bool`. */
function decodeBool(value: unknown): boolean {
  return extractFieldValue(value) === true
}

/**
 * Decode the `RateLimitDirection` enum. Canton's JSON Ledger API encodes enums
 * as a bare constructor-name string; a gRPC `{ Sum: { Enum: { constructor } } }`
 * envelope is tolerated defensively.
 */
function decodeDirection(value: unknown): 'inbound' | 'outbound' {
  const v = extractFieldValue(value)
  const constructor =
    typeof v === 'string'
      ? v
      : ((v as { Enum?: { constructor?: string } } | undefined)?.Enum?.constructor ?? '')
  return constructor === 'RateLimitDirection_Outbound' ? 'outbound' : 'inbound'
}

/** Decode the `RateLimitMode` enum (see {@link decodeDirection} for the encoding). */
function decodeMode(value: unknown): 'defaultFinality' | 'customFinality' {
  const v = extractFieldValue(value)
  const constructor =
    typeof v === 'string'
      ? v
      : ((v as { Enum?: { constructor?: string } } | undefined)?.Enum?.constructor ?? '')
  return constructor === 'RateLimitMode_CustomFinality' ? 'customFinality' : 'defaultFinality'
}

/** Decode a `[Party]` list. */
function decodePartyList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const el of value as unknown[]) {
    const s = extractFieldValue(el)
    if (typeof s === 'string') out.push(s)
  }
  return out
}
