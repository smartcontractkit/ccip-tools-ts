import { type TransactionRequest, Result } from 'ethers'

import type { ChainFamily } from '../networks.ts'
import type { CleanAddressable } from './messages.ts'

/**
 * An on-chain requirement the CURRENT chain state does not satisfy, reported alongside the
 * calldata rather than thrown.
 *
 * @remarks Only meaningful on the `generateUnsigned*` path, where the transaction is built to be
 * reviewed and signed later: by then the state may well have moved, typically because an earlier
 * transaction in the same plan put it there. `execute` rejects these instead — see
 * `EVMOperation.execute`.
 */
export type UnmetPrecondition = {
  /** Parameter the requirement is attributed to, e.g. `'sender'`. Matches the `param` an
   *  equivalent `CCTParamsInvalidError` would carry. */
  param: string
  /** Why the current state does not satisfy it, phrased for a human reviewer. */
  reason: string
}

/**
 * Type representing a set of unsigned EVM transactions
 */
export type UnsignedEVMTx = {
  family: typeof ChainFamily.EVM
  transactions: Pick<TransactionRequest, 'from' | 'to' | 'data' | 'gasLimit' | 'value'>[]
  /** Present only when the op found requirements the current chain state does not meet. Absent
   *  on the happy path, so existing consumers are unaffected. */
  preconditions?: UnmetPrecondition[]
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
