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

/**
 * Extract a named numeric field from a contract's `createArgument` object.
 * Handles both direct numeric values and Canton JSON API tagged variants (`{ int64: n }`).
 */
function extractNumberField(createArgument: unknown, fieldName: string): number | null {
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
const CCIP_TEMPLATES = {
  perPartyRouter: {
    templateId: '#ccip-perpartyrouter:CCIP.PerPartyRouter:PerPartyRouter',
    moduleEntity: 'CCIP.PerPartyRouter:PerPartyRouter',
  },
  ccipReceiver: {
    templateId: '#ccip-receiver:CCIP.CCIPReceiver:CCIPReceiver',
    moduleEntity: 'CCIP.CCIPReceiver:CCIPReceiver',
  },
  ccipSender: {
    templateId: '#ccip-sender:CCIP.CCIPSender:CCIPSender',
    moduleEntity: 'CCIP.CCIPSender:CCIPSender',
  },
} as const

type CcipContractType = keyof typeof CCIP_TEMPLATES

/**
 * Build a targeted `EventFormat` that requests only the specific CCIP contract
 * templates needed, including the `createdEventBlob` required for disclosure.
 * Using explicit `TemplateFilter`s instead of a wildcard avoids pulling every
 * active contract for the party over the wire.
 */
function buildTargetedEventFormat(party: string): EventFormat {
  return {
    filtersByParty: {
      [party]: {
        cumulative: Object.values(CCIP_TEMPLATES).map(({ templateId }) => ({
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
  /** partyOwner field from createArgument (present on PerPartyRouter) */
  partyOwner: string | null
  /** minBlockConfirmations field from createArgument (present on CCIPReceiver) */
  minBlockConfirmations: number | null
}

/**
 * Query the ACS once with targeted template filters and build a lookup map keyed by
 * `"ModuleName:EntityName"`, preserving all fields needed for instance-address
 * matching.
 */
async function fetchRichSnapshot(
  client: CantonClient,
  party: string,
): Promise<Map<string, RichContractMatch[]>> {
  const { offset } = await client.getLedgerEnd()

  const request: GetActiveContractsRequest = {
    eventFormat: buildTargetedEventFormat(party),
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
      partyOwner: extractStringField(created.createArgument, 'partyOwner'),
      minBlockConfirmations: extractNumberField(created.createArgument, 'minBlockConfirmations'),
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
  for (const contracts of snapshot.values()) {
    for (const c of contracts) {
      if (c.contractId === cid) {
        return {
          templateId: c.templateId,
          contractId: c.contractId,
          createdEventBlob: c.createdEventBlob,
          synchronizerId: c.synchronizerId,
        }
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
  const { moduleEntity } = CCIP_TEMPLATES[contractType]
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
  const { moduleEntity } = CCIP_TEMPLATES[contractType]
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

  /**
   * Create an `AcsDisclosureProvider` from a pre-built Canton Ledger API client.
   *
   * @param client - Authenticated Canton Ledger API client (JWT already embedded).
   * @param config - ACS provider configuration: party ID
   */
  constructor(client: CantonClient, config: AcsDisclosureConfig) {
    this.client = client
    this.config = config
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
    const snapshot = await fetchRichSnapshot(this.client, this.config.party)

    const existingRouter = pickByPartyOwner(snapshot, 'perPartyRouter', this.config.party)
    const ccipReceiver = receiverCid
      ? pickByContractId(snapshot, receiverCid)
      : pickBySignatory(snapshot, 'ccipReceiver', this.config.party)

    return { perPartyRouter: existingRouter, ccipReceiver }
  }

  /**
   * Find the first `CCIPReceiver` in the party's ACS with a `minBlockConfirmations`
   * value matching `finality`, or `null` if none exists.
   *
   * Used by the execute flow to select the receiver that is compatible with the
   * message finality so the `PrepareExecute` choice does not reject the message.
   */
  async findReceiverForFinality(finality: number): Promise<DisclosedContract | null> {
    const snapshot = await fetchRichSnapshot(this.client, this.config.party)
    const { moduleEntity } = CCIP_TEMPLATES.ccipReceiver
    const candidates = snapshot.get(moduleEntity) ?? []
    for (const c of candidates) {
      if (c.minBlockConfirmations === finality) {
        return {
          templateId: c.templateId,
          contractId: c.contractId,
          createdEventBlob: c.createdEventBlob,
          synchronizerId: c.synchronizerId,
        }
      }
    }
    return null
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipSend` command.
   *
   * Returns the sender's `PerPartyRouter` and `CCIPSender` contracts from the
   * Active Contract Set, matched by signatory (the sender party).
   */
  async fetchSendDisclosures(): Promise<AcsSendDisclosures> {
    const snapshot = await fetchRichSnapshot(this.client, this.config.party)

    const existingRouter = pickByPartyOwner(snapshot, 'perPartyRouter', this.config.party)
    const existingSender = pickBySignatory(snapshot, 'ccipSender', this.config.party)

    return {
      perPartyRouter: existingRouter,
      ccipSender: existingSender,
    }
  }
}
