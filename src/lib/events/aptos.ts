import type { ChainEvent } from './types.ts'

// Reference https://github.com/aptos-labs/aptos-ts-sdk/blob/main/src/types/generated/operations.ts#L432
// We should get this from the aptos-ts-sdk
export type AptosEvent = {
  account_address: string
  creation_number: unknown
  data: unknown
  event_index: unknown
  sequence_number: unknown
  transaction_block_height: unknown
  transaction_version: unknown
  type: string // something like "0x1::coin::WithdrawEvent",
  indexed_type: string
}

export const toChainEventFromAptos = (event: AptosEvent): ChainEvent => {
  return {
    id: event.type,
    index: event.event_index as number,
    address: event.account_address,
    data: event.data as string,
    indexedArgs: [],
  }
}
