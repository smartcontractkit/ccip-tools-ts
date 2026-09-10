/**
 * EVM CCT reads: {@link Query} bound to an {@link EVMChain}, plus {@link getTypedContract}, the
 * call-typed handle read ops decode through. Mirrors `cct/solana/query.ts`.
 *
 * @packageDocumentation
 */

import type { Abi } from 'abitype'
import { type InterfaceAbi, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../evm/index.ts'
import { Query } from '../query.ts'

/** Shared base for read-only EVM CCT queries; see {@link Query}. */
export abstract class EVMQuery<P extends object, R, Parsed = P> extends Query<
  EVMChain,
  P,
  R,
  Parsed
> {}

/**
 * Binds `address` to `abi` as a call-typed contract for read ops: one value both types the calls
 * and builds the runtime `Interface`.
 * @remarks The CCT layer's single ethers → `ethers-abitype` cast; the library's own
 * `typedContract` would avoid it, but its ESM entry is unusable (`main` resolves to CJS).
 */
export function getTypedContract<const ABI extends Abi>(
  chain: EVMChain,
  address: string,
  abi: ABI & InterfaceAbi,
): TypedContract<ABI> {
  return new Contract(address, abi, chain.provider) as unknown as TypedContract<ABI>
}
