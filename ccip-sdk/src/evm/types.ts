import { type TransactionRequest, Result } from 'ethers'

import type { ChainFamily } from '../types.ts'

/**
 * Type representing a set of unsigned EVM transactions
 */
export type UnsignedEVMTx = {
  family: typeof ChainFamily.EVM
  transactions: Pick<TransactionRequest, 'from' | 'to' | 'data'>[]
}

/**
 * Convert a Result or Promise to an object
 * @internal
 */
export function resultToObject<T>(o: T): T {
  if (o instanceof Promise) return o.then(resultToObject) as T
  if (!(o instanceof Result)) return o
  if (o.length === 0) return o.toArray() as T
  try {
    const obj = o.toObject()
    if (!Object.keys(obj).every((k) => /^_+\d*$/.test(k)))
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resultToObject(v)])) as T
  } catch (_) {
    // fallthrough
  }
  return o.toArray().map(resultToObject) as T
}
