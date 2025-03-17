import {
  getEVMLBTCDepositHashes,
  isEVMBurnedEvent,
  isEVMLBTCEvent,
  isEVMTransferEvent,
  isEVMUSDCEvent,
} from './evm'
import { type ChainEvent } from './types'

export const isUSDCEvent = (event: ChainEvent): boolean => {
  return isEVMUSDCEvent(event) // || isAptosUSDCEvent(event) ...
}

export const isTransferEvent = (event: ChainEvent): boolean => {
  return isEVMTransferEvent(event)
}

export const isBurnedEvent = (event: ChainEvent): boolean => {
  return isEVMBurnedEvent(event)
}

export const isLBTCEvent = (event: ChainEvent): boolean => {
  return isEVMLBTCEvent(event)
}

export const getLBTCDepositHashes = (event: ChainEvent): string => {
  return getEVMLBTCDepositHashes(event)
}
