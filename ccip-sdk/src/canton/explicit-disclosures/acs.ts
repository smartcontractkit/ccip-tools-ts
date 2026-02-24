import { keccak256, toUtf8Bytes } from 'ethers'

import type {
  AcsDisclosureConfig,
  DisclosedContract,
  DisclosureProvider,
  ExecutionDisclosures,
  SendDisclosures,
} from './types.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import {
  type CantonClient,
  type EventFormat,
  type GetActiveContractsRequest,
  createCantonClient,
} from '../client/index.ts'

/**
 * Compute the Canton `InstanceAddress` from a contract's `instanceId` and its
 * signatory party. Matches Go: `instanceID.RawInstanceAddress(party).InstanceAddress()`.
 *
 * Format: `keccak256(utf8("<instanceId>@<signatoryParty>"))`
 */
function computeInstanceAddress(instanceId: string, signatory: string): string {
  return keccak256(toUtf8Bytes(`${instanceId}@${signatory}`))
}

function instanceAddressEquals(a: string, b: string): boolean {
  return a.toLowerCase().replace(/^0x/, '') === b.toLowerCase().replace(/^0x/, '')
}

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
  offRamp: 'CCIP.OffRamp:OffRamp',
  globalConfig: 'CCIP.GlobalConfig:GlobalConfig',
  tokenAdminRegistry: 'CCIP.TokenAdminRegistry:TokenAdminRegistry',
  rmnRemote: 'CCIP.RMNRemote:RMNRemote',
  committeeVerifier: 'CCIP.CommitteeVerifier:CommitteeVerifier',
  perPartyRouter: 'CCIP.PerPartyRouter:PerPartyRouter',
  onRamp: 'CCIP.OnRamp:OnRamp',
  feeQuoter: 'CCIP.FeeQuoter:FeeQuoter',
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
 * From a pre-fetched ACS snapshot, find the single contract matching the given
 * contract type and instance address.
 *
 * @throws `CCIPError(CANTON_API_ERROR)` if no matching contract is found.
 */
function pickByInstanceAddress(
  snapshot: Map<string, RichContractMatch[]>,
  contractType: CcipContractType,
  targetInstanceAddress: string,
): DisclosedContract {
  const moduleEntity = CCIP_MODULE_ENTITIES[contractType]
  const candidates = snapshot.get(moduleEntity) ?? []

  for (const c of candidates) {
    if (!c.instanceId || !c.signatory) continue
    if (
      instanceAddressEquals(
        computeInstanceAddress(c.instanceId, c.signatory),
        targetInstanceAddress,
      )
    ) {
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
    `Canton ACS: no active "${moduleEntity}" contract found at instance address ` +
      `${targetInstanceAddress}. Verify the address is correct and the contract is ` +
      `active for the configured party.`,
  )
}

// ---------------------------------------------------------------------------
// AcsDisclosureProvider
// ---------------------------------------------------------------------------

/**
 * Disclosure provider that fetches `createdEventBlob`s directly from the Canton
 * Ledger API Active Contract Set.
 *
 * A single wildcard ACS query is issued per `fetchExecutionDisclosures()` /
 * `fetchSendDisclosures()` call (package-ID agnostic, matches the EDS strategy).
 *
 * @example
 * ```ts
 * const provider = new AcsDisclosureProvider(cantonClient, {
 *   jwt: '...',
 *   party: 'Alice::122...',
 *   instanceAddresses: {
 *     offRampAddress: '0xabc...',
 *     globalConfigAddress: '0xdef...',
 *     tokenAdminRegistryAddress: '0x123...',
 *     rmnRemoteAddress: '0x456...',
 *     perPartyRouterFactoryAddress: '0x789...',
 *     ccvAddresses: ['0xaaa...'],
 *   },
 * })
 * const disclosures = await provider.fetchExecutionDisclosures()
 * ```
 *
 * Use this provider when:
 *  - Direct Ledger API access is available.
 *  - A running EDS instance is not needed (local dev, integration tests).
 *  - Multiple CCVs or GlobalConfig / RMNRemote disclosures are required.
 */
export class AcsDisclosureProvider implements DisclosureProvider {
  private readonly client: CantonClient
  private readonly config: AcsDisclosureConfig

  /**
   * Create an `AcsDisclosureProvider` from a pre-built Canton Ledger API client.
   *
   * @param client - Authenticated Canton Ledger API client (JWT already embedded).
   * @param config - ACS provider configuration: party ID and contract instance addresses.
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
   *
   * Issues a single wildcard ACS query, then resolves OffRamp, GlobalConfig,
   * TokenAdminRegistry, RMNRemote, and all CCVs by instance address.
   */
  async fetchExecutionDisclosures(extraCcvAddresses: string[] = []): Promise<ExecutionDisclosures> {
    const { party, instanceAddresses, additionalCcvAddresses = [] } = this.config
    const snapshot = await fetchRichSnapshot(this.client, party)

    const offRamp = pickByInstanceAddress(snapshot, 'offRamp', instanceAddresses.offRampAddress)
    const globalConfig = pickByInstanceAddress(
      snapshot,
      'globalConfig',
      instanceAddresses.globalConfigAddress,
    )
    const tokenAdminRegistry = pickByInstanceAddress(
      snapshot,
      'tokenAdminRegistry',
      instanceAddresses.tokenAdminRegistryAddress,
    )
    const rmnRemote = pickByInstanceAddress(
      snapshot,
      'rmnRemote',
      instanceAddresses.rmnRemoteAddress,
    )

    const allCcvAddresses = [
      ...new Set([
        ...instanceAddresses.ccvAddresses,
        ...additionalCcvAddresses,
        ...extraCcvAddresses,
      ]),
    ]

    const verifiers: DisclosedContract[] = allCcvAddresses.map((addr) =>
      pickByInstanceAddress(snapshot, 'committeeVerifier', addr),
    )

    return { offRamp, globalConfig, tokenAdminRegistry, rmnRemote, verifiers }
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipSend` command.
   *
   * Requires `routerAddress`, `onRampAddress`, and `feeQuoterAddress` to be
   * provided in `instanceAddresses`.
   */
  async fetchSendDisclosures(): Promise<SendDisclosures> {
    const { party, instanceAddresses } = this.config
    const { routerAddress, onRampAddress, feeQuoterAddress } = instanceAddresses

    if (!routerAddress || !onRampAddress || !feeQuoterAddress) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'Canton ACS: fetchSendDisclosures requires routerAddress, onRampAddress, and ' +
          'feeQuoterAddress to be set in the instanceAddresses configuration.',
      )
    }

    const snapshot = await fetchRichSnapshot(this.client, party)

    const router = pickByInstanceAddress(snapshot, 'perPartyRouter', routerAddress)
    const onRamp = pickByInstanceAddress(snapshot, 'onRamp', onRampAddress)
    const feeQuoter = pickByInstanceAddress(snapshot, 'feeQuoter', feeQuoterAddress)

    return { router, onRamp, feeQuoter }
  }
}
