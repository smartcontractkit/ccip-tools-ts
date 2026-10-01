/**
 * ACS-backed {@link CantonChain} mock for the CCT Canton unit tests —
 * test-support code, NOT part of the SDK's public surface.
 *
 * Unlike mocking `findActiveContractByInstanceAddress` outright, this serves a
 * fixed ACS through a stub `provider`, so the real resolution path runs:
 * template filters (several per query), party visibility, instance-address
 * hashing, and multiple-match detection.
 *
 * @packageDocumentation
 */

import { type CantonActiveContract, CantonChain } from '../../canton/index.ts'
import { ChainFamily } from '../../networks.ts'

/** An ACS contract, plus the non-signatory parties it is visible to. */
export type AcsContract = CantonActiveContract & { observers?: string[] }

/** A recorded `getActiveContracts` request (the subset the mock reads). */
export interface AcsRequest {
  eventFormat: {
    filtersByParty: Record<
      string,
      {
        cumulative: Array<{
          identifierFilter: { TemplateFilter: { value: { templateId: string } } }
        }>
      }
    >
  }
}

/** `Module:Entity` of a template ID, so symbolic `#pkg-name:…` and concrete `pkg-id:…` forms compare. */
const qualifiedName = (templateId: string) => templateId.split(':').slice(-2).join(':')

/**
 * A real `CantonChain` instance (private fields make object-literal casts
 * impossible) whose `provider` answers ACS queries from `contracts`, honouring
 * the requested template filters and parties. `overrides` are assigned last.
 * @returns The chain, and every `getActiveContracts` request it received.
 */
export function acsChain(
  contracts: AcsContract[],
  overrides: Record<string, unknown> = {},
): { chain: CantonChain; requests: AcsRequest[] } {
  const requests: AcsRequest[] = []
  const provider = {
    getLedgerEnd: async () => ({ offset: 1 }),
    getActiveContracts: async (request: AcsRequest) => {
      requests.push(request)
      const { filtersByParty } = request.eventFormat
      const parties = Object.keys(filtersByParty)
      const templates = new Set(
        Object.values(filtersByParty).flatMap((f) =>
          f.cumulative.map((c) =>
            qualifiedName(c.identifierFilter.TemplateFilter.value.templateId),
          ),
        ),
      )
      return contracts
        .filter((c) => templates.has(qualifiedName(c.templateId)))
        .filter((c) => [...c.signatories, ...(c.observers ?? [])].some((p) => parties.includes(p)))
        .map((c) => ({
          contractEntry: {
            JsActiveContract: {
              synchronizerId: c.synchronizerId,
              createdEvent: {
                templateId: c.templateId,
                contractId: c.contractId,
                createdEventBlob: c.createdEventBlob,
                signatories: c.signatories,
                createArgument: c.createArgument,
              },
            },
          },
        }))
    },
  }
  const chain = Object.assign(Object.create(CantonChain.prototype), {
    network: { family: ChainFamily.Canton, chainId: 'canton:TestNet' },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider,
    ...overrides,
  }) as CantonChain
  return { chain, requests }
}

/** Template IDs a recorded request filtered on (deduplicated across parties). */
export function requestedTemplateIds(request: AcsRequest): string[] {
  return [
    ...new Set(
      Object.values(request.eventFormat.filtersByParty).flatMap((f) =>
        f.cumulative.map((c) => c.identifierFilter.TemplateFilter.value.templateId),
      ),
    ),
  ]
}
