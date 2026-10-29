import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import type { Logger } from '../types.ts'
import type { PartyId } from './addressCodec.ts'
import type { JsActiveContract, LedgerApiClient } from './clients/ledger-api/client.ts'
import type { CantonIdentifier } from './types.ts'

// helper function to list all currently active contracts for the given templateId, that the partyId can see.
export async function listActiveContractsByTemplateId(
  logger: Logger,
  ledgerApiClient: LedgerApiClient,
  partyId: PartyId,
  templateId: CantonIdentifier,
): Promise<JsActiveContract[]> {
  const { offset } = await ledgerApiClient.getLedgerEnd()
  if (!offset) {
    throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, `failed to get ledger end`)
  }

  const activeContractsResponse = await ledgerApiClient.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [partyId.toString()]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: templateId.toString(),
                    includeCreatedEventBlob: true,
                  },
                },
              },
            },
          ],
        },
      },
      verbose: true,
    },
  })

  return activeContractsResponse.flatMap((response) => {
    const entry = response.contractEntry
    if (!entry || !('JsActiveContract' in entry)) return []
    return [entry.JsActiveContract]
  })
}

export async function listActiveContractsByInterfaceId(
  logger: Logger,
  ledgerApiClient: LedgerApiClient,
  partyId: PartyId,
  interfaceId: CantonIdentifier,
): Promise<JsActiveContract[]> {
  const { offset } = await ledgerApiClient.getLedgerEnd()
  if (!offset) {
    throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, `failed to get ledger end`)
  }

  const activeContractsResponse = await ledgerApiClient.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [partyId.toString()]: {
          cumulative: [
            {
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: interfaceId.toString(),
                    includeInterfaceView: true,
                    includeCreatedEventBlob: true,
                  },
                },
              },
            },
          ],
        },
      },
      verbose: true,
    },
  })

  return activeContractsResponse.flatMap((response) => {
    const entry = response.contractEntry
    if (!entry || !('JsActiveContract' in entry)) return []
    return [entry.JsActiveContract]
  })
}
