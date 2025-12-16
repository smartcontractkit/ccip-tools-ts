import type { TransactionRequest } from 'ethers'

import type { ChainFamily } from '../types.ts'

/**
 * Type representing a set of unsigned EVM transactions
 */
export type UnsignedEVMTx = {
  family: typeof ChainFamily.EVM
  transactions: Pick<TransactionRequest, 'from' | 'to' | 'data'>[]
}
