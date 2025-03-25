import { type Log, EventFragment, Interface } from 'ethers'
import TokenPoolABI from '../../abi/BurnMintTokenPool_1_5_1.ts'
import { lazyCached } from '../utils.ts'
import type { ChainEvent } from './types.ts'

export const toChainEventFromEVM = (
  event: Pick<Log, 'topics' | 'index' | 'address' | 'data'>,
): ChainEvent => {
  return {
    id: event.topics[0],
    index: event.index,
    address: event.address,
    data: event.data,
    indexedArgs: event.topics.slice(1),
  }
}

const TokenPoolInterface = lazyCached(
  `Interface BurnMintTokenPool 1.5.1`,
  () => new Interface(TokenPoolABI),
)
const BURNED_EVENT = TokenPoolInterface.getEvent('Burned')!
const USDC_EVENT = EventFragment.from('MessageSent(bytes message)')
const TRANSFER_EVENT = EventFragment.from('Transfer(address from, address to, uint256 value)')
const LBTC_EVENT = EventFragment.from(
  'DepositToBridge(address fromAddress, bytes32 toAddress, bytes32 payloadHash, bytes payload)',
)

export const isEVMUSDCEvent = (event: ChainEvent): boolean => {
  return event.id === USDC_EVENT.topicHash
}

export const isEVMTransferEvent = (event: ChainEvent): boolean => {
  return event.id === TRANSFER_EVENT.topicHash
}

export const isEVMBurnedEvent = (event: ChainEvent): boolean => {
  return event.id === BURNED_EVENT.topicHash
}

export const isEVMLBTCEvent = (event: ChainEvent): boolean => {
  return event.id === LBTC_EVENT.topicHash
}

export const getEVMLBTCDepositHashes = (event: ChainEvent): string => {
  if (!isEVMLBTCEvent(event)) {
    throw new Error('Event is not a LiquidBTC deposit event')
  }
  if (event.indexedArgs.length < 3) {
    throw new Error('Event does not have a deposit hash')
  }
  return event.indexedArgs[2]
}
