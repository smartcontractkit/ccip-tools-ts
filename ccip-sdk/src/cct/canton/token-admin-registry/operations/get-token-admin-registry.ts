/**
 * getTokenAdminRegistry — read the TAR state for an instrument: admin,
 * pendingAdmin, registered pool, `isCCIPManaged`, and the `TokenConfig` CID.
 *
 * Reads the instrument's active `TokenConfig` contract from the ACS (the
 * `TokenConfig` template carries `admin`, `pendingAdmin`, `tokenPool`,
 * `isCCIPManaged`, `instrumentId`, `instanceId`). The TAR singleton itself is
 * not per-instrument — the per-instrument view lives on `TokenConfig`, whose
 * instance address is derived offline from the instrument ID and the CCIP owner
 * (see {@link deriveTokenConfigInstanceAddress}).
 *
 * @packageDocumentation
 */

import { type CantonChain, decodeDamlRecord, extractFieldValue } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { parseInstrumentId, parsePartyId } from '../../validate.ts'
import {
  TOKEN_CONFIG_TEMPLATE_ID,
  decodeOptionalParty,
  defaultCcipOwner,
  deriveTokenConfigInstanceAddress,
} from '../shared.ts'

/** Parameters for `getTokenAdminRegistry`. */
export interface GetTokenAdminRegistryParams {
  /**
   * Instrument to read the TAR view of (`{ admin, id }` or
   * `"admin::1220…::id"`). Its TokenConfig is located at the raw instance
   * address `"<keccak256(id@admin)>@<ccipOwner>"`.
   */
  instrumentId: { admin: string; id: string } | string
  /** Admin party (for ACS visibility — must be a stakeholder/signatory of the TokenConfig). */
  adminParty: string
  /**
   * CCIP owner party — the TAR's (and so the TokenConfig's) signatory. Defaults
   * to the connected network's well-known `ccipOwner`, else the chain's
   * `ccipParty`; override only for a non-default TAR deployment.
   */
  ccipOwner?: string
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
  /** `TokenConfig` contract ID for the instrument (`''` when no TokenConfig is active/visible). */
  tokenConfigCid: string
  /** Raw instance address (`"instanceId@ccipOwner"`) the TokenConfig was looked up at. */
  tokenConfigInstanceAddress: string
  /** Whether a burn-mint factory is wired (SetBurnMintFactory) — required for pool send/execute. */
  burnMintFactorySet: boolean
  /** Whether a transfer factory is wired (SetTransferFactory). */
  transferFactorySet: boolean
  /** Whether the deployed TAR package version carries the factory fields at all.
   *  False on older deployments (fields added in a later ccip-core) — the set
   *  flags are meaningless then. */
  factoryFieldsSupported: boolean
}

/** Parsed params for {@link GetTokenAdminRegistry.read}. */
interface ParsedGetTokenAdminRegistry {
  instrumentId: { admin: string; id: string }
  adminParty: string
  /** `undefined` → {@link defaultCcipOwner}. */
  ccipOwner?: string
}

/** Read the TAR state for an instrument. */
export class GetTokenAdminRegistry extends CantonQuery<
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  ParsedGetTokenAdminRegistry
> {
  readonly name = 'getTokenAdminRegistry'

  /** Validates the instrument ID, admin party, and optional CCIP owner. */
  protected prepare(p: GetTokenAdminRegistryParams): ParsedGetTokenAdminRegistry {
    return {
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      adminParty: parsePartyId(this.name, 'adminParty', p.adminParty),
      ccipOwner: p.ccipOwner ? parsePartyId(this.name, 'ccipOwner', p.ccipOwner) : undefined,
    }
  }

  /**
   * Derives the instrument's TokenConfig address, reads the active
   * `TokenConfig` there from the ACS and decodes its fields into the TAR view.
   * Returns an empty result (`tokenConfigCid: ''`) when the TokenConfig is not
   * active/visible.
   */
  protected async read(
    chain: CantonChain,
    p: ParsedGetTokenAdminRegistry,
  ): Promise<GetTokenAdminRegistryResult> {
    const tokenConfigInstanceAddress = deriveTokenConfigInstanceAddress(
      p.instrumentId,
      p.ccipOwner ?? defaultCcipOwner(chain),
    )
    const contract = await chain.findActiveContractByInstanceAddress(
      TOKEN_CONFIG_TEMPLATE_ID,
      tokenConfigInstanceAddress,
      [p.adminParty],
    )

    if (!contract) {
      return {
        isCCIPManaged: false,
        tokenConfigCid: '',
        tokenConfigInstanceAddress,
        burnMintFactorySet: false,
        transferFactorySet: false,
        factoryFieldsSupported: false,
      }
    }

    const fields = decodeDamlRecord(contract.createArgument)
    return {
      admin: decodeOptionalParty(fields['admin']),
      pendingAdmin: decodeOptionalParty(fields['pendingAdmin']),
      tokenPool: decodeTokenPool(fields['tokenPool']),
      isCCIPManaged: decodeBool(fields['isCCIPManaged']),
      tokenConfigCid: contract.contractId,
      tokenConfigInstanceAddress,
      burnMintFactorySet: decodeOptionalPresent(fields['burnMintFactory']),
      transferFactorySet: decodeOptionalPresent(fields['transferFactory']),
      factoryFieldsSupported: 'burnMintFactory' in fields || 'transferFactory' in fields,
    }
  }
}

/** Whether a Daml `Optional` field is `Some` (value present). Handles natural JSON (null vs value) and gRPC (`{None:{}}` vs `{Some: ...}`). */
function decodeOptionalPresent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'object' && 'None' in (value as Record<string, unknown>)) return false
  return true
}

/** Decode a Daml `Bool` (gRPC `{ Sum: { Bool: true } }` or bare `true`). */
function decodeBool(value: unknown): boolean {
  const v = extractFieldValue(value)
  return v === true
}

/**
 * Recursively strip known envelope wrappers (`Some`/`Sum`/`Record`/`record`/
 * `value`/`optional`) until we reach a plain object — or bottom out at `None`
 * (`null`, `{}`, or an explicit `None` key). Compound `Optional Record` fields
 * (unlike scalars) aren't covered by `extractFieldValue`'s wrapper-stripping,
 * so this exists specifically for them — see `decodeTokenPool` below.
 */
function unwrapEnvelope(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (value == null || depth > 6) return undefined
  if (typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if ('None' in v) return undefined
  for (const key of ['Some', 'Sum', 'Record', 'record', 'optional', 'Optional', 'value']) {
    if (key in v && v[key] != null) return unwrapEnvelope(v[key], depth + 1)
  }
  return v
}

/** Decode a Daml `Optional PoolRegistration` into `{ poolOwner, poolInstanceId }`.
 *  `PoolRegistration` is a compound record, so unlike the scalar decoders above
 *  (which lean on `extractFieldValue`'s generic wrapper-stripping), this needs
 *  its own recursive unwrap ({@link unwrapEnvelope}) to reach the actual
 *  `poolOwner`/`poolInstanceId` fields regardless of how many envelope layers
 *  (`Some`, `Sum.Record`, `fields[]`, etc.) the ledger/gateway JSON nests them
 *  under. */
function decodeTokenPool(
  value: unknown,
): { poolOwner: string; poolInstanceId: string } | undefined {
  const unwrapped = unwrapEnvelope(value)
  if (!unwrapped) return undefined
  const fields = decodeDamlRecord(unwrapped)
  const poolOwner = extractFieldValue(fields['poolOwner'])
  const poolInstanceId = extractFieldValue(fields['poolInstanceId'])
  if (typeof poolOwner === 'string' && typeof poolInstanceId === 'string') {
    return { poolOwner, poolInstanceId }
  }
  return undefined
}
