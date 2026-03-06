import type { DisclosedContract } from './types.ts'
import { CCIPError, CCIPErrorCode, CCIPNotImplementedError } from '../../errors/index.ts'
import {
  type CantonClient,
  type EventFormat,
  type GetActiveContractsRequest,
  createCantonClient,
} from '../client/index.ts'

/**
 * Extract the `instanceId` string from a contract's `createArgument` object.
 * Handles both verbose mode (direct field) and structured fields arrays.
 */
function extractInstanceId(createArgument: unknown): string | null {
  if (!createArgument || typeof createArgument !== 'object') return null
  const arg = createArgument as Record<string, unknown>

  if ('instanceId' in arg && typeof arg['instanceId'] === 'string') {
    return arg['instanceId']
  }

  if ('fields' in arg && Array.isArray(arg['fields'])) {
    for (const field of arg['fields'] as Array<Record<string, unknown>>) {
      if (field['label'] === 'instanceId') {
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

/**
 * Build a wildcard `EventFormat` that returns all contracts belonging to `party`,
 * including the opaque `createdEventBlob` needed for disclosure.
 */
function buildWildcardEventFormat(party: string): EventFormat {
  return {
    filtersByParty: {
      [party]: {
        cumulative: [
          {
            identifierFilter: {
              WildcardFilter: {
                value: { includeCreatedEventBlob: true },
              },
            },
          },
        ],
      },
    },
    verbose: true,
  }
}

/**
 * The `ModuleName:EntityName` suffix used to identify each CCIP contract type
 * without requiring a specific package ID.
 */
const CCIP_MODULE_ENTITIES = {
  perPartyRouter: 'CCIP.PerPartyRouter:PerPartyRouter',
  ccipReceiver: 'CCIP.CCIPReceiver:CCIPReceiver',
} as const

type CcipContractType = keyof typeof CCIP_MODULE_ENTITIES

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
}

/**
 * Query the ACS once with a wildcard filter and build a lookup map keyed by
 * `"ModuleName:EntityName"`, preserving all fields needed for instance-address
 * matching.
 */
async function fetchRichSnapshot(
  client: CantonClient,
  party: string,
): Promise<Map<string, RichContractMatch[]>> {
  const { offset } = await client.getLedgerEnd()

  const request: GetActiveContractsRequest = {
    eventFormat: buildWildcardEventFormat(party),
    verbose: false,
    activeAtOffset: offset,
  }

  // Note: this may be inefficient and if the party has many active contracts.
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
    }

    const list = byModuleEntity.get(moduleEntity) ?? []
    list.push(rich)
    byModuleEntity.set(moduleEntity, list)
  }

  return byModuleEntity
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
export type AcsSendDisclosures = never // not implemented yet

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
    const client = createCantonClient({ baseUrl: ledgerApiUrl, token: jwt })
    return new AcsDisclosureProvider(client, config)
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipExecute` command.
   */
  async fetchExecutionDisclosures(): Promise<AcsExecutionDisclosures> {
    const snapshot = await fetchRichSnapshot(this.client, this.config.party)

    const existingRouter = pickBySignatory(snapshot, 'perPartyRouter', this.config.party)
    const existingReceiver = pickBySignatory(snapshot, 'ccipReceiver', this.config.party)

    return {
      perPartyRouter: existingRouter,
      ccipReceiver: existingReceiver,
    }
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipSend` command.
   */
  async fetchSendDisclosures(): Promise<AcsSendDisclosures> {
    await Promise.resolve() // placeholder for potential future implementation
    throw new CCIPNotImplementedError('AcsDisclosureProvider.fetchSendDisclosures')
  }
}
