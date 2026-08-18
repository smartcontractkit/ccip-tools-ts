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
import type { CantonInstrumentId } from '../../../../canton/types.ts'
import { decodeDamlRecord, extractFieldValue, extractRecordField } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { parseInstrumentId } from '../../validate.ts'
import { TOKEN_CONFIG_TEMPLATE_ID } from '../shared.ts'

/** Parameters for `getTokenAdminRegistry`. */
export interface GetTokenAdminRegistryParams {
  /** Instrument to look up (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** TokenConfig contract ID. When omitted, resolved via ACS by instrumentId. */
  tokenConfigCid?: string
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
  instrumentId: CantonInstrumentId
  tokenConfigCid?: string
}

/** Read the TAR state for an instrument. */
export class GetTokenAdminRegistry extends CantonQuery<
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  ParsedGetTokenAdminRegistry
> {
  readonly name = 'getTokenAdminRegistry'

  /** Parses the instrument ID into `{ admin, id }`. */
  protected prepare(p: GetTokenAdminRegistryParams): ParsedGetTokenAdminRegistry {
    return {
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      tokenConfigCid: p.tokenConfigCid,
    }
  }

  /**
   * Reads the active `TokenConfig` for the instrument from the ACS and decodes
   * its fields into the TAR view. When `tokenConfigCid` is provided, fetches it
   * by CID; otherwise resolves by template + `instrumentId` match. Returns an
   * empty result (`tokenConfigCid: ''`) when the instrument is not registered.
   */
  protected async read(
    chain: CantonChain,
    p: ParsedGetTokenAdminRegistry,
  ): Promise<GetTokenAdminRegistryResult> {
    const contract = p.tokenConfigCid
      ? await chain.findActiveContractByCid(TOKEN_CONFIG_TEMPLATE_ID, p.tokenConfigCid, [
          p.instrumentId.admin,
        ])
      : await chain.findActiveContractByTemplate(
          TOKEN_CONFIG_TEMPLATE_ID,
          [p.instrumentId.admin],
          (createArgument) => {
            const fields = decodeDamlRecord(createArgument)
            const inst = extractRecordField(fields, 'instrumentId')
            if (!inst) return false
            return inst['admin'] === p.instrumentId.admin && inst['id'] === p.instrumentId.id
          },
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

/** Decode a Daml `Optional Party` into a string (or `undefined` when `None`). */
function decodeOptionalParty(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  // Daml `Some p` → { Some: { ... } }; `None` → { None: {} }
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

/** Decode a Daml `Optional PoolRegistration` into `{ poolOwner, poolInstanceId }`. */
function decodeTokenPool(
  value: unknown,
): { poolOwner: string; poolInstanceId: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
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
