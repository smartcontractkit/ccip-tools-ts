import type { CantonRpcProvider } from '../../types.ts'
import type { components } from './ledger-api.generated.d.ts'

export type DisclosedContract = components['schemas']['DisclosedContract']
export type GetLedgerEndResponse = components['schemas']['GetLedgerEndResponse']
export type JsCommands = components['schemas']['JsCommands']
export type JsTransaction = components['schemas']['JsTransaction']
export type JsGetUpdateResponse = components['schemas']['JsGetUpdateResponse']
export type JsSubmitAndWaitForTransactionResponse =
  components['schemas']['JsSubmitAndWaitForTransactionResponse']
export type JsActiveContract = components['schemas']['JsActiveContract']
export type CreatedEvent = components['schemas']['CreatedEvent']
export type Update = components['schemas']['Update']
export type UpdateFormat = components['schemas']['UpdateFormat']
export type GetUpdateByIdRequest = components['schemas']['GetUpdateByIdRequest']
export type GetActiveContractsRequest = components['schemas']['GetActiveContractsRequest']
export type JsGetActiveContractsResponse = components['schemas']['JsGetActiveContractsResponse']

export type LedgerApiClient = ReturnType<typeof createLedgerApiClientFromProvider>

export function createLedgerApiClientFromProvider(provider: CantonRpcProvider) {
  return {
    async getLedgerEnd(): Promise<GetLedgerEndResponse> {
      const response = await provider.request({
        method: 'ledgerApi',
        params: {
          requestMethod: 'get',
          resource: '/v2/state/ledger-end',
        },
      })

      return response as GetLedgerEndResponse
    },

    async getUpdateById(
      updateId: string,
      updateFormat?: UpdateFormat,
    ): Promise<JsGetUpdateResponse> {
      const response = await provider.request({
        method: 'ledgerApi',
        params: {
          requestMethod: 'post',
          resource: '/v2/updates/update-by-id',
          body: {
            updateId,
            updateFormat,
          } as GetUpdateByIdRequest,
        },
      })

      return response as JsGetUpdateResponse
    },

    async getActiveContracts(
      request: GetActiveContractsRequest,
    ): Promise<JsGetActiveContractsResponse[]> {
      const response = await provider.request({
        method: 'ledgerApi',
        params: {
          requestMethod: 'post',
          resource: '/v2/state/active-contracts',
          body: request,
        },
      })

      return response as JsGetActiveContractsResponse[]
    },
  }
}
