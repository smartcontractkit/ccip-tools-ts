import { id as keccak256Utf8 } from 'ethers'

import { normalizeCantonCcvList, receiverRequiresConfiguredCcvs } from '../ccv-addresses.ts'
import type { DisclosedContract } from './types.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import {
  type CantonClient,
  type EventFormat,
  type GetActiveContractsRequest,
  createCantonClient,
} from '../client/index.ts'

/**
 * Extract a named string field from a contract's `createArgument` object.
 * Handles both verbose mode (direct field) and structured fields arrays.
 */
function extractStringField(createArgument: unknown, fieldName: string): string | null {
  if (!createArgument || typeof createArgument !== 'object') return null
  const arg = createArgument as Record<string, unknown>

  if (fieldName in arg && typeof arg[fieldName] === 'string') {
    return arg[fieldName]
  }

  if ('fields' in arg && Array.isArray(arg['fields'])) {
    for (const field of arg['fields'] as Array<Record<string, unknown>>) {
      if (field['label'] === fieldName) {
        const val = field['value']
        if (typeof val === 'string') return val
        if (val && typeof val === 'object' && 'text' in val) {
          return (val as Record<string, unknown>)['text'] as string
        }
      }
    }
  }
  return null
}

function extractInstanceId(createArgument: unknown): string | null {
  return extractStringField(createArgument, 'instanceId')
}

/** Length of a list field on createArgument (empty list → 0). */
function extractListLength(createArgument: unknown, fieldName: string): number {
  return extractStringListField(createArgument, fieldName).length
}

/** Extract RawInstanceAddress.unpack strings from a list field on createArgument. */
function extractStringListField(createArgument: unknown, fieldName: string): string[] {
  if (!createArgument || typeof createArgument !== 'object') return []
  const arg = createArgument as Record<string, unknown>

  const listValue = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>
            if (typeof record['unpack'] === 'string') return record['unpack']
            if (record['value'] && typeof record['value'] === 'object') {
              const nested = record['value'] as Record<string, unknown>
              if (typeof nested['unpack'] === 'string') return nested['unpack']
            }
          }
          return null
        })
        .filter((item): item is string => item != null)
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (Array.isArray(record['list'])) return listValue(record['list'])
      if (Array.isArray(record['elements'])) return listValue(record['elements'])
    }
    return []
  }

  if (fieldName in arg) return listValue(arg[fieldName])

  if ('fields' in arg && Array.isArray(arg['fields'])) {
    for (const field of arg['fields'] as Array<Record<string, unknown>>) {
      if (field['label'] === fieldName) return listValue(field['value'])
    }
  }
  return []
}

function extractRequiredCCVs(createArgument: unknown): string[] {
  return extractStringListField(createArgument, 'requiredCCVs')
}

/**
 * Extract the `receiverFinalityConfig` Daml variant from a contract's `createArgument`.
 * The Canton JSON Ledger API v2 represents variants as `{ tag: string, value: unknown }`.
 */
function extractFinalityConfig(createArgument: unknown): { tag: string; value: unknown } | null {
  if (!createArgument || typeof createArgument !== 'object') return null
  const arg = createArgument as Record<string, unknown>

  const direct = arg['receiverFinalityConfig']
  if (direct && typeof direct === 'object' && 'tag' in (direct as Record<string, unknown>)) {
    return direct as { tag: string; value: unknown }
  }

  if ('fields' in arg && Array.isArray(arg['fields'])) {
    for (const field of arg['fields'] as Array<Record<string, unknown>>) {
      if (field['label'] === 'receiverFinalityConfig') {
        const val = field['value']
        if (val && typeof val === 'object' && 'tag' in (val as Record<string, unknown>)) {
          return val as { tag: string; value: unknown }
        }
      }
    }
  }
  return null
}

/**
 * Extract a named numeric field from a contract's `createArgument` object.
 * Handles both direct numeric values and Canton JSON API tagged variants (`{ int64: n }`).
 */
function _extractNumberField(createArgument: unknown, fieldName: string): number | null {
  if (!createArgument || typeof createArgument !== 'object') return null
  const arg = createArgument as Record<string, unknown>

  if (fieldName in arg && typeof arg[fieldName] === 'number') {
    return arg[fieldName]
  }

  if ('fields' in arg && Array.isArray(arg['fields'])) {
    for (const field of arg['fields'] as Array<Record<string, unknown>>) {
      if (field['label'] === fieldName) {
        const val = field['value']
        if (typeof val === 'number') return val
        if (val && typeof val === 'object') {
          const v = val as Record<string, unknown>
          if ('int64' in v) return Number(v['int64'])
          if ('numeric' in v && typeof v['numeric'] === 'string') return Number(v['numeric'])
        }
      }
    }
  }
  return null
}
/**
 * Metadata for each CCIP contract type needed for ACS filtering:
 * - `templateId`: package-name reference used directly in the `TemplateFilter` so the
 *   server only returns contracts of that exact template (no client-side scan).
 * - `moduleEntity`: the `ModuleName:EntityName` suffix extracted from the full template ID
 *   string returned by the ledger, used to key the result map.
 */
const DEFAULT_CCIP_PACKAGE_NAMES = {
  perPartyRouter: 'ccip-perpartyrouter',
  ccipReceiver: 'ccip-receiver',
  ccipSender: 'ccip-sender',
} as const

/** DAR package names used to resolve CCIP template IDs from the ACS snapshot. */
export type CcipPackageNames = {
  [K in keyof typeof DEFAULT_CCIP_PACKAGE_NAMES]: string
}

const CCIP_MODULE_ENTITIES = {
  perPartyRouter: 'CCIP.PerPartyRouter:PerPartyRouter',
  ccipReceiver: 'CCIP.CCIPReceiver:CCIPReceiver',
  ccipSender: 'CCIP.CCIPSender:CCIPSender',
} as const

function resolveCcipPackageNames(overrides?: Partial<CcipPackageNames>): CcipPackageNames {
  return { ...DEFAULT_CCIP_PACKAGE_NAMES, ...overrides }
}

function buildCcipTemplates(packages: CcipPackageNames) {
  return {
    perPartyRouter: {
      templateId: `#${packages.perPartyRouter}:${CCIP_MODULE_ENTITIES.perPartyRouter}`,
      moduleEntity: CCIP_MODULE_ENTITIES.perPartyRouter,
    },
    ccipReceiver: {
      templateId: `#${packages.ccipReceiver}:${CCIP_MODULE_ENTITIES.ccipReceiver}`,
      moduleEntity: CCIP_MODULE_ENTITIES.ccipReceiver,
    },
    ccipSender: {
      templateId: `#${packages.ccipSender}:${CCIP_MODULE_ENTITIES.ccipSender}`,
      moduleEntity: CCIP_MODULE_ENTITIES.ccipSender,
    },
  } as const
}

type CcipContractType = keyof typeof CCIP_MODULE_ENTITIES

/**
 * Build a targeted `EventFormat` that requests only the specific CCIP contract
 * templates needed, including the `createdEventBlob` required for disclosure.
 * Using explicit `TemplateFilter`s instead of a wildcard avoids pulling every
 * active contract for the party over the wire.
 */
function buildTargetedEventFormat(party: string, packages: CcipPackageNames): EventFormat {
  const templates = buildCcipTemplates(packages)
  return {
    filtersByParty: {
      [party]: {
        cumulative: Object.values(templates).map(({ templateId }) => ({
          identifierFilter: {
            TemplateFilter: {
              value: { templateId, includeCreatedEventBlob: true },
            },
          },
        })),
      },
    },
    verbose: true,
  }
}

/**
 * Internal per-contract entry in the ACS snapshot, enriched with instance
 * address components for later matching.
 */
interface RichContractMatch {
  contractId: string
  templateId: string
  createdEventBlob: string
  synchronizerId: string
  instanceId: string | null
  signatory: string | null
  /** owner field from createArgument (present on CCIPReceiver) */
  owner: string | null
  /** partyOwner field from createArgument (present on PerPartyRouter) */
  partyOwner: string | null
  /** receiverFinalityConfig variant from createArgument (present on CCIPReceiver) */
  receiverFinalityConfig: { tag: string; value: unknown } | null
  /** requiredCCVs list length from createArgument (present on CCIPReceiver) */
  requiredCCVsLength: number
  /** RawInstanceAddress.unpack values from requiredCCVs (present on CCIPReceiver) */
  requiredCCVs: string[]
}

/** Daml party ID: `hint::1220<64-hex-fingerprint>` (not a 3-part instrument id). */
function isCantonPartyId(value: string): boolean {
  return /^[\w.-]+::1220[0-9a-fA-F]{64}$/.test(value)
}

function normalizeHex(value: string): string {
  return (value.startsWith('0x') ? value.slice(2) : value).toLowerCase()
}

function normalizeContractId(value: string): string {
  return normalizeHex(value)
}

function hashedPartyHex(owner: string): string {
  return normalizeHex(keccak256Utf8(owner))
}

function matchesReceiverFinality(
  cfg: RichContractMatch['receiverFinalityConfig'],
  finality: number,
): boolean {
  if (!cfg) return false
  return finality === 0
    ? cfg.tag === 'WaitForFinality'
    : finality === 0x00010000
      ? cfg.tag === 'WaitForSafe'
      : cfg.tag === 'BlockDepth' && Number(cfg.value) === finality
}

/** Prefer receivers whose requiredCCVs include a CCV from canton-config `ccvs`. */
function rankReceiverCandidates(
  candidates: RichContractMatch[],
  configuredCcvs: readonly string[],
): RichContractMatch[] {
  const score = (candidate: RichContractMatch): number => {
    if (receiverRequiresConfiguredCcvs(candidate.requiredCCVs, configuredCcvs)) return 2
    if (candidate.requiredCCVsLength > 0) return 1
    return 0
  }
  return [...candidates].sort((a, b) => score(b) - score(a))
}

function toDisclosedContract(match: RichContractMatch): DisclosedContract {
  return {
    templateId: match.templateId,
    contractId: match.contractId,
    createdEventBlob: match.createdEventBlob,
    synchronizerId: match.synchronizerId,
  }
}

type ReceiverHintKind = 'contractId' | 'hashedParty' | 'partyId'

function classifyReceiverHint(hint: string): ReceiverHintKind {
  const trimmed = hint.trim()
  if (isCantonPartyId(trimmed)) return 'partyId'
  const hex = normalizeHex(trimmed)
  if (!/^[0-9a-f]+$/.test(hex)) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `Invalid Canton receiver hint "${hint}". Expected a contract ID, party ID (hint::1220…), or keccak256(party) hex.`,
    )
  }
  if (hex.length === 64) return 'hashedParty'
  if (hex.length > 64) return 'contractId'
  throw new CCIPError(
    CCIPErrorCode.CANTON_API_ERROR,
    `Invalid Canton receiver hint "${hint}". Hex value is too short to be a contract ID or keccak256(party).`,
  )
}

/**
 * Query the ACS once with targeted template filters and build a lookup map keyed by
 * `"ModuleName:EntityName"`, preserving all fields needed for instance-address
 * matching.
 */
async function fetchRichSnapshot(
  client: CantonClient,
  party: string,
  packages: CcipPackageNames,
): Promise<Map<string, RichContractMatch[]>> {
  const { offset } = await client.getLedgerEnd()

  const request: GetActiveContractsRequest = {
    eventFormat: buildTargetedEventFormat(party, packages),
    verbose: false,
    activeAtOffset: offset,
  }

  const responses = await client.getActiveContracts(request)
  const byModuleEntity = new Map<string, RichContractMatch[]>()

  for (const response of responses) {
    const entry = response.contractEntry
    if (!entry || !('JsActiveContract' in entry)) continue

    const active = entry.JsActiveContract
    const created = active.createdEvent
    const parts = created.templateId.split(':')
    if (parts.length < 3) continue
    const moduleEntity = `${parts[1]}:${parts[2]}`

    const signatories = created.signatories
    const rich: RichContractMatch = {
      contractId: created.contractId,
      templateId: created.templateId,
      createdEventBlob: created.createdEventBlob ?? '',
      synchronizerId: active.synchronizerId,
      instanceId: extractInstanceId(created.createArgument),
      signatory: signatories.length === 1 ? (signatories[0] ?? null) : null,
      owner: extractStringField(created.createArgument, 'owner'),
      partyOwner: extractStringField(created.createArgument, 'partyOwner'),
      receiverFinalityConfig: extractFinalityConfig(created.createArgument),
      requiredCCVs: extractRequiredCCVs(created.createArgument),
      requiredCCVsLength: extractListLength(created.createArgument, 'requiredCCVs'),
    }

    const list = byModuleEntity.get(moduleEntity) ?? []
    list.push(rich)
    byModuleEntity.set(moduleEntity, list)
  }

  return byModuleEntity
}

/**
 * From a pre-fetched ACS snapshot, return the contract whose `contractId` matches
 * `cid`, regardless of template type.
 *
 * Used when the caller already knows the exact contract ID (e.g. a `CCIPReceiver`
 * whose CID was persisted at deployment time) and template identity is irrelevant.
 *
 * @throws `CCIPError(CANTON_API_ERROR)` if no matching contract is found.
 */
function pickByContractId(
  snapshot: Map<string, RichContractMatch[]>,
  cid: string,
): DisclosedContract {
  const want = normalizeContractId(cid)
  for (const contracts of snapshot.values()) {
    for (const c of contracts) {
      if (normalizeContractId(c.contractId) === want) {
        return toDisclosedContract(c)
      }
    }
  }

  throw new CCIPError(
    CCIPErrorCode.CANTON_API_ERROR,
    `Canton ACS: no active contract found with contractId "${cid}". ` +
      `Verify the contract ID is correct and the contract is active.`,
  )
}

/**
 * From a pre-fetched ACS snapshot, return the single active contract of the given type
 * whose signatory matches `party`.
 *
 * Used for contracts (like `CCIPReceiver`) whose instance IDs are generated with a random
 * suffix at deployment time and therefore cannot be derived from the party ID.
 *
 * @throws `CCIPError(CANTON_API_ERROR)` if no matching contract is found.
 */
function pickBySignatory(
  snapshot: Map<string, RichContractMatch[]>,
  contractType: CcipContractType,
  party: string,
): DisclosedContract {
  const moduleEntity = CCIP_MODULE_ENTITIES[contractType]
  const candidates = snapshot.get(moduleEntity) ?? []

  for (const c of candidates) {
    if (c.signatory === party) {
      return {
        templateId: c.templateId,
        contractId: c.contractId,
        createdEventBlob: c.createdEventBlob,
        synchronizerId: c.synchronizerId,
      }
    }
  }

  throw new CCIPError(
    CCIPErrorCode.CANTON_API_ERROR,
    `Canton ACS: no active "${moduleEntity}" contract found with signatory "${party}". ` +
      `Verify the party is correct and the contract is active.`,
  )
}

function pickByPartyOwner(
  snapshot: Map<string, RichContractMatch[]>,
  contractType: CcipContractType,
  party: string,
): DisclosedContract {
  const moduleEntity = CCIP_MODULE_ENTITIES[contractType]
  const candidates = snapshot.get(moduleEntity) ?? []

  for (const c of candidates) {
    if (c.partyOwner === party) {
      return {
        templateId: c.templateId,
        contractId: c.contractId,
        createdEventBlob: c.createdEventBlob,
        synchronizerId: c.synchronizerId,
      }
    }
  }

  throw new CCIPError(
    CCIPErrorCode.CANTON_API_ERROR,
    `Canton ACS: no active "${moduleEntity}" contract found with partyOwner "${party}". ` +
      `Verify the party is correct and the contract is active.`,
  )
}

/**
 * Configuration for the ACS-based disclosure provider.
 * Requires direct access to the Canton Ledger API and the full set of contract
 * instance addresses.
 */
export type AcsDisclosureConfig = {
  /** Canton party ID acting on behalf of the user */
  party: string
  /** Optional DAR package name overrides for ACS template filters */
  packages?: Partial<CcipPackageNames>
  /**
   * Optional execute CCV InstanceAddresses from canton-config (`ccvs`).
   * Hex hashes and/or raw `instanceId@party` forms are accepted.
   * Used to prefer CCIPReceivers whose `requiredCCVs` include these verifiers.
   */
  ccvs?: string[]
}

/**
 * Same party disclosed contracts required to submit a `ccipExecute` command on Canton.
 */
export type AcsExecutionDisclosures = {
  perPartyRouter: DisclosedContract
  ccipReceiver: DisclosedContract
}

/**
 * Same party disclosed contracts required to submit a `ccipSend` command on Canton.
 */
export type AcsSendDisclosures = {
  /** The sender's PerPartyRouter contract. */
  perPartyRouter: DisclosedContract
  /** The sender's CCIPSender contract. */
  ccipSender: DisclosedContract
}

/**
 * Disclosure provider that fetches `createdEventBlob`s directly from the Canton
 * Ledger API Active Contract Set.
 *
 * Use this provider to access disclosures available in the same party
 */
export class AcsDisclosureProvider {
  private readonly client: CantonClient
  private readonly config: AcsDisclosureConfig
  private readonly packages: CcipPackageNames

  /**
   * Create an `AcsDisclosureProvider` from a pre-built Canton Ledger API client.
   *
   * @param client - Authenticated Canton Ledger API client (JWT already embedded).
   * @param config - ACS provider configuration: party ID
   */
  constructor(client: CantonClient, config: AcsDisclosureConfig) {
    this.client = client
    this.config = {
      ...config,
      ccvs: normalizeCantonCcvList(config.ccvs),
    }
    this.packages = resolveCcipPackageNames(config.packages)
  }

  /**
   * Convenience factory: create a provider directly from a Ledger API URL.
   */
  static fromUrl(
    ledgerApiUrl: string,
    jwt: string,
    config: AcsDisclosureConfig,
  ): AcsDisclosureProvider {
    const client = createCantonClient({ baseUrl: ledgerApiUrl, jwt })
    return new AcsDisclosureProvider(client, config)
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipExecute` command.
   *
   * @param receiverCid - When provided, the `CCIPReceiver` disclosure is resolved
   *   by contract ID rather than by signatory, making the lookup independent of
   *   the contract's template type.
   */
  async fetchExecutionDisclosures(receiverCid?: string): Promise<AcsExecutionDisclosures> {
    const snapshot = await fetchRichSnapshot(this.client, this.config.party, this.packages)

    const existingRouter = pickByPartyOwner(snapshot, 'perPartyRouter', this.config.party)
    const ccipReceiver = receiverCid
      ? pickByContractId(snapshot, receiverCid)
      : pickBySignatory(snapshot, 'ccipReceiver', this.config.party)

    return { perPartyRouter: existingRouter, ccipReceiver }
  }

  /**
   * Find the best `CCIPReceiver` for execute, optionally resolving a caller hint.
   *
   * Hint formats:
   * - Ledger contract ID (long hex, optional `0x` prefix)
   * - Canton party ID (`hint::1220…`)
   * - keccak256(party) hex from the CCIP message `receiver` field (32 bytes)
   *
   * When no hint is given, returns the best receiver whose finality config matches
   * the message, preferring contracts whose `requiredCCVs` include a configured CCV.
   */
  async resolveReceiverForExecute(
    finality: number,
    hint?: string,
  ): Promise<DisclosedContract | null> {
    const snapshot = await fetchRichSnapshot(this.client, this.config.party, this.packages)
    const moduleEntity = CCIP_MODULE_ENTITIES.ccipReceiver
    const candidates = snapshot.get(moduleEntity) ?? []

    const ownedByParty = candidates.filter(
      (c) =>
        c.owner === this.config.party ||
        c.partyOwner === this.config.party ||
        c.signatory === this.config.party,
    )
    let pool = ownedByParty.length > 0 ? ownedByParty : candidates

    if (hint?.trim()) {
      const trimmed = hint.trim()
      const kind = classifyReceiverHint(trimmed)
      if (kind === 'contractId') {
        return pickByContractId(snapshot, trimmed)
      }
      if (kind === 'partyId') {
        pool = pool.filter((c) => c.owner === trimmed)
      } else {
        const want = normalizeHex(trimmed)
        pool = pool.filter((c) => c.owner != null && hashedPartyHex(c.owner) === want)
      }
    }

    const matching = rankReceiverCandidates(
      pool.filter((c) => matchesReceiverFinality(c.receiverFinalityConfig, finality)),
      this.config.ccvs ?? [],
    )
    const best = matching[0]
    return best ? toDisclosedContract(best) : null
  }

  /**
   * Find a CCIPReceiver matching the requested finality.
   * @deprecated Use {@link resolveReceiverForExecute} instead.
   */
  async findReceiverForFinality(finality: number): Promise<DisclosedContract | null> {
    return this.resolveReceiverForExecute(finality)
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipSend` command.
   *
   * Returns the sender's `PerPartyRouter` and `CCIPSender` contracts from the
   * Active Contract Set. Executor disclosures are supplied by the external EDS
   * API when the global EDS selects one for the message.
   */
  async fetchSendDisclosures(): Promise<AcsSendDisclosures> {
    const snapshot = await fetchRichSnapshot(this.client, this.config.party, this.packages)

    const existingRouter = pickByPartyOwner(snapshot, 'perPartyRouter', this.config.party)
    const existingSender = pickBySignatory(snapshot, 'ccipSender', this.config.party)

    return {
      perPartyRouter: existingRouter,
      ccipSender: existingSender,
    }
  }
}
