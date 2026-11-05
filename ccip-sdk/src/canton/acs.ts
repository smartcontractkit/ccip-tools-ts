import type * as damlTypes from '@daml/types'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import type { Logger } from '../types.ts'
import type { PartyId } from './addressCodec.ts'
import type { JsActiveContract, LedgerApiClient } from './clients/ledger-api/client.ts'
import type { CantonIdentifier } from './types.ts'

// helper function to list all currently active contracts for the given templateId(s), that the partyId can see.
export async function listActiveContractsByTemplateId(
  logger: Logger,
  ledgerApiClient: LedgerApiClient,
  partyId: PartyId,
  templateId: CantonIdentifier | readonly CantonIdentifier[],
): Promise<JsActiveContract[]> {
  const templateIds = Array.isArray(templateId) ? templateId : [templateId]
  const { offset } = await ledgerApiClient.getLedgerEnd()
  if (!offset) {
    throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, `failed to get ledger end`)
  }

  const activeContractsResponse = await ledgerApiClient.getActiveContracts({
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [partyId.toString()]: {
          cumulative: templateIds.map((id) => ({
            identifierFilter: {
              TemplateFilter: {
                value: {
                  templateId: id.toString(),
                  includeCreatedEventBlob: true,
                },
              },
            },
          })),
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

// Decodes a raw JSON payload (e.g. a contract's `createArgument`) into its typed
// representation, using the decoder of any serializable Daml type companion
// (e.g. a generated template like `CCIPReceiver`).
export function decodeContract<T>(
  serializable: damlTypes.Serializable<T>,
  createArgument: unknown,
): Promise<T> {
  return serializable.decoder.runPromise(createArgument)
}
