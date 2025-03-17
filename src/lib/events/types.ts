// Common type able to represent an event from different chains
export type ChainEvent = {
  id: string // eventSignature or topics[0] in EVM chains
  index: number // position of the event in the transaction
  address: string // account emitting the event
  data: string // data of the event
  indexedArgs: Array<string> // indexed arguments of the event. topics[1:] in EVM chains
}
