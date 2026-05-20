import { type TransactionRequest, Result } from 'ethers'

import type { ChainFamily } from '../networks.ts'
import type { CleanAddressable } from './messages.ts'

/**
 * Type representing a set of unsigned EVM transactions
 */
export type UnsignedEVMTx = {
  family: typeof ChainFamily.EVM
  transactions: Pick<TransactionRequest, 'from' | 'to' | 'data' | 'gasLimit' | 'value'>[]
}

/**
 * Convert a Result or Promise to an object
 * @internal
 */
export function resultToObject<T>(o: T): CleanAddressable<T> {
  if (o instanceof Promise) return o.then(resultToObject) as CleanAddressable<T>
  if (!(o instanceof Result)) return o as CleanAddressable<T>
  if (o.length === 0) return o.toArray() as CleanAddressable<T>
  try {
    const obj = o.toObject()
    if (!Object.keys(obj).every((k) => /^_+\d*$/.test(k)))
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, resultToObject(v)]),
      ) as CleanAddressable<T>
  } catch (_) {
    // fallthrough
  }
  return o.toArray().map(resultToObject) as CleanAddressable<T>
}
