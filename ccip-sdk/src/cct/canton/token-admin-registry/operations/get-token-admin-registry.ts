/**
 * getTokenAdminRegistry — read the TAR state for an instrument: admin,
 * pendingAdmin, registered pool, `isCCIPManaged`, and the `TokenConfig` CID.
 *
 * Reads the instrument's active `TokenConfig` contract from the ACS (the
 * `TokenConfig` template carries `admin`, `pendingAdmin`, `tokenPool`,
 * `isCCIPManaged`, `instrumentId`, `instanceId`). The TAR singleton itself is
 * not per-instrument — the per-instrument view lives on `TokenConfig`.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import { decodeDamlRecord, extractFieldValue } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { TOKEN_CONFIG_TEMPLATE_ID } from '../shared.ts'

/** Parameters for `getTokenAdminRegistry`. */
export interface GetTokenAdminRegistryParams {
  /** TokenConfig `InstanceAddress` (`0x<64-hex>` or `"instanceId@admin"`). Resolved via ACS. */
  tokenConfigInstanceAddress: string
  /** Admin party (for ACS visibility — must be a stakeholder/signatory of the TokenConfig). */
  adminParty: string
}

/** Result of `getTokenAdminRegistry`: the TAR view of an instrument. */
export interface GetTokenAdminRegistryResult {
  /** Current admin party for the instrument. */
  admin?: string
  /** Pending admin party (set by `registerAdmin`/`transferAdmin`, before `acceptAdmin`). */
  pendingAdmin?: string
  /** Registered pool (`{ poolOwner, poolInstanceId }`), if `setPool` has been called. */
  tokenPool?: { poolOwner: string; poolInstanceId: string }
  /** Whether the instrument is CCIP-managed (admin is the CCIP owner). */
  isCCIPManaged: boolean
  /** `TokenConfig` contract ID for the instrument. */
  tokenConfigCid: string
}

/** Parsed params for {@link GetTokenAdminRegistry.read}. */
interface ParsedGetTokenAdminRegistry {
  tokenConfigInstanceAddress: string
  adminParty: string
}

/** Read the TAR state for an instrument. */
export class GetTokenAdminRegistry extends CantonQuery<
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  ParsedGetTokenAdminRegistry
> {
  readonly name = 'getTokenAdminRegistry'

  /** Validates the TokenConfig instance address + admin party. */
  protected prepare(p: GetTokenAdminRegistryParams): ParsedGetTokenAdminRegistry {
    if (!p.tokenConfigInstanceAddress) {
      throw new CCTParamsInvalidError(this.name, 'tokenConfigInstanceAddress', 'TokenConfig InstanceAddress is required')
    }
    return {
      tokenConfigInstanceAddress: p.tokenConfigInstanceAddress,
      adminParty: p.adminParty,
    }
  }

  /**
   * Reads the active `TokenConfig` by InstanceAddress from the ACS and decodes
   * its fields into the TAR view. Returns an empty result (`tokenConfigCid: ''`)
   * when the TokenConfig is not active/visible.
   */
  protected async read(
    chain: CantonChain,
    p: ParsedGetTokenAdminRegistry,
  ): Promise<GetTokenAdminRegistryResult> {
    const contract = await chain.findActiveContractByInstanceAddress(
      TOKEN_CONFIG_TEMPLATE_ID,
      p.tokenConfigInstanceAddress,
      [p.adminParty],
    )

    if (!contract) {
      return { isCCIPManaged: false, tokenConfigCid: '' }
    }

    const fields = decodeDamlRecord(contract.createArgument)
    return {
      admin: decodeOptionalParty(fields['admin']),
      pendingAdmin: decodeOptionalParty(fields['pendingAdmin']),
      tokenPool: decodeTokenPool(fields['tokenPool']),
      isCCIPManaged: decodeBool(fields['isCCIPManaged']),
      tokenConfigCid: contract.contractId,
    }
  }
}

/** Decode a Daml `Optional Party` into a string (or `undefined` when `None`).
 *  Handles three encodings:
 *   - JSON Ledger API (natural): `Some` → bare string `"partyId"`; `None` → `null`.
 *   - gRPC JSON: `Some` → `{ Some: { Sum: { Party: "partyId" } } }`; `None` → `{ None: {} }`. */
function decodeOptionalParty(value: unknown): string | undefined {
  if (value == null) return undefined // JSON `null` (None) or absent
  // Natural JSON: a bare string is `Some party`.
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  // gRPC JSON: `Some p` → { Some: { ... } }; `None` → { None: {} }
  if ('Some' in v && v.Some != null) {
    const inner = extractFieldValue(v.Some)
    return typeof inner === 'string' ? inner : undefined
  }
  return undefined
}

/** Decode a Daml `Bool` (gRPC `{ Sum: { Bool: true } }` or bare `true`). */
function decodeBool(value: unknown): boolean {
  const v = extractFieldValue(value)
  return v === true
}

/** Decode a Daml `Optional PoolRegistration` into `{ poolOwner, poolInstanceId }`.
 *  Handles two encodings:
 *   - JSON Ledger API (natural): `Some` → bare object `{ poolOwner, poolInstanceId }`;
 *     `None` → `null`.
 *   - gRPC JSON: `Some` → `{ Some: { fields: [...] } }`; `None` → `{ None: {} }`. */
function decodeTokenPool(
  value: unknown,
): { poolOwner: string; poolInstanceId: string } | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  // Natural JSON: a bare object with poolOwner/poolInstanceId fields is `Some`.
  if ('poolOwner' in v || 'poolInstanceId' in v) {
    const fields = decodeDamlRecord(v)
    const poolOwner = extractFieldValue(fields['poolOwner'])
    const poolInstanceId = extractFieldValue(fields['poolInstanceId'])
    if (typeof poolOwner === 'string' && typeof poolInstanceId === 'string') {
      return { poolOwner, poolInstanceId }
    }
  }
  // gRPC JSON: `Some` → { Some: { fields: [...] } }
  if ('Some' in v && v.Some != null) {
    const fields = decodeDamlRecord(v.Some)
    const poolOwner = extractFieldValue(fields['poolOwner'])
    const poolInstanceId = extractFieldValue(fields['poolInstanceId'])
    if (typeof poolOwner === 'string' && typeof poolInstanceId === 'string') {
      return { poolOwner, poolInstanceId }
    }
  }
  return undefined
}
