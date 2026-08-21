/**
 * getTokenPoolState — read a token pool's config from the ACS: pool owner,
 * remote-chain configs, rate-limit admin, instrument ID, and decimals.
 *
 * Reads the active pool contract (burn-mint or lock-release) by CID and decodes
 * its `createArgument` into a {@link GetTokenPoolStateResult}. The
 * `remoteChainConfigs` Daml `Map` is decoded defensively (the gRPC JSON
 * `GenMap` shape varies by key type); entries that fail to decode are skipped.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import {
  decodeDamlRecord,
  extractFieldValue,
  extractRecordField,
} from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID } from '../shared.ts'

/** A remote-chain config entry on the pool. */
export interface PoolRemoteChainConfig {
  /** Remote chain selector (numeric key in the `remoteChainConfigs` map). */
  remoteChainSelector: string
  /** Remote pool addresses. */
  remotePools: string[]
  /** Remote token address (encoded instrument ID). */
  remoteTokenAddress: string
}

/** Result of `getTokenPoolState`: the pool's config. */
export interface GetTokenPoolStateResult {
  /** Pool owner party ID. */
  poolOwner: string
  /** Pool instance ID. */
  poolInstanceId: string
  /** Rate-limit admin party (if set). */
  rateLimitAdmin?: string
  /** Per-remote-chain configs (decoded defensively; partial on decode errors). */
  remoteChainConfigs: PoolRemoteChainConfig[]
  /** Instrument ID the pool bridges. */
  instrumentId: { admin: string; id: string }
  /** Token decimals. */
  decimals: number
}

/** Parsed params for {@link GetTokenPoolState.read}. */
interface ParsedGetTokenPoolState {
  poolInstanceAddress: string
  templateId: string
  poolOwner: string
}

/** Parameters for `getTokenPoolState`. */
export interface GetTokenPoolStateParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`). */
  poolInstanceAddress: string
  /** Pool type (determines the template ID for the ACS query). */
  poolType: 'burnMint' | 'lockRelease'
  /** Pool owner party (for ACS visibility — must be a stakeholder/signatory). */
  poolOwner: string
}

/** Read a token pool's config from the ACS. */
export class GetTokenPoolState extends CantonQuery<
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
  ParsedGetTokenPoolState
> {
  readonly name = 'getTokenPoolState'

  /** Validates the pool target + owner, and normalizes the pool type into a template ID. */
  protected prepare(p: GetTokenPoolStateParams): ParsedGetTokenPoolState {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(this.name, 'poolInstanceAddress', 'pool InstanceAddress is required')
    }
    return {
      poolInstanceAddress: p.poolInstanceAddress,
      templateId:
        p.poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID,
      poolOwner: p.poolOwner,
    }
  }

  /**
   * Reads the pool contract from the ACS by InstanceAddress and decodes its
   * `createArgument`. Throws when the pool is not active or not visible.
   */
  protected async read(
    chain: CantonChain,
    p: ParsedGetTokenPoolState,
  ): Promise<GetTokenPoolStateResult> {
    const contract = await chain.findActiveContractByInstanceAddress(
      p.templateId,
      p.poolInstanceAddress,
      [p.poolOwner],
    )
    if (!contract) {
      throw new Error(
        `getTokenPoolState: pool ${p.poolInstanceAddress} is not active or not visible to ${p.poolOwner}`,
      )
    }

    const fields = decodeDamlRecord(contract.createArgument)
    const instrumentId = decodeInstrumentId(fields)
    if (!instrumentId) {
      throw new Error(`getTokenPoolState: pool ${p.poolInstanceAddress} has no decodable instrumentId`)
    }

    return {
      poolOwner: decodeString(fields['poolOwner']),
      poolInstanceId: decodeString(fields['instanceId']),
      rateLimitAdmin: decodeOptionalParty(fields['rateLimitAdmin']),
      remoteChainConfigs: decodeRemoteChainConfigs(fields['remoteChainConfigs']),
      instrumentId,
      decimals: decodeInt(fields['decimals']),
    }
  }
}

/** Decode a required string field. */
function decodeString(value: unknown): string {
  const v = extractFieldValue(value)
  return typeof v === 'string' ? v : ''
}

/** Decode a Daml `Int`. */
function decodeInt(value: unknown): number {
  const v = extractFieldValue(value)
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.length > 0) return Number(v)
  return 0
}

/** Decode a Daml `Optional Party` into a string (or `undefined`). */
function decodeOptionalParty(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if ('Some' in v && v.Some != null) {
    const inner = extractFieldValue(v.Some)
    return typeof inner === 'string' ? inner : undefined
  }
  return undefined
}

/** Decode the pool `instrumentId` (`{ admin, id }`) record from a decoded `createArgument`. */
function decodeInstrumentId(fields: Record<string, unknown>): { admin: string; id: string } | undefined {
  const rec = extractRecordField(fields, 'instrumentId')
  if (!rec) return undefined
  const admin = extractFieldValue(rec['admin'])
  const id = extractFieldValue(rec['id'])
  if (typeof admin === 'string' && typeof id === 'string') return { admin, id }
  return undefined
}

/**
 * Decode the `remoteChainConfigs` Daml `Map (Numeric 0) RemoteChainConfig`.
 * The gRPC JSON `GenMap` shape is `{ mapTextInt64: [{ key, value }, ...] }` (or
 * another `map*` variant); this decoder tolerates any `map*` key holding an
 * array of `{ key, value }` entries. Entries that fail to decode are skipped.
 */
function decodeRemoteChainConfigs(value: unknown): PoolRemoteChainConfig[] {
  if (!value || typeof value !== 'object') return []
  const v = value as Record<string, unknown>
  // `extractFieldValue` unwraps a Sum→GenMap envelope to its inner object.
  const mapValue = (extractFieldValue(v) ?? v) as Record<string, unknown>
  const entries = findMapEntries(mapValue)
  if (!entries) return []

  const out: PoolRemoteChainConfig[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const key = extractFieldValue(e['key'])
    const valueRec = e['value']
    if (typeof key !== 'string' || !valueRec) continue
    const cfg = decodeDamlRecord(valueRec)
    const remotePools = decodeStringList(cfg['remotePools'])
    const remoteTokenAddress = decodeString(cfg['remoteTokenAddress'])
    out.push({ remoteChainSelector: key, remotePools, remoteTokenAddress })
  }
  return out
}

/** Find the array of `{ key, value }` entries under any `map*` key. */
function findMapEntries(mapValue: Record<string, unknown>): unknown[] | null {
  for (const [k, val] of Object.entries(mapValue)) {
    if (k.startsWith('map') && Array.isArray(val)) return val as unknown[]
  }
  return null
}

/** Decode a Daml `[BytesHex]` (list of byte-hex strings). */
function decodeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const el of value as unknown[]) {
    const s = extractFieldValue(el)
    if (typeof s === 'string') out.push(s)
  }
  return out
}
