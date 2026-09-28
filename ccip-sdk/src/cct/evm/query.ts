/**
 * EVM CCT reads: {@link Query} bound to an {@link EVMChain}, plus {@link getTypedContract}, the
 * call-typed handle read ops decode through, and {@link isMissingFunction}, the shared test for
 * "this address does not answer that call". Mirrors `cct/solana/query.ts`.
 *
 * @packageDocumentation
 */

import type { Abi } from 'abitype'
import { type InterfaceAbi, Contract, isError } from 'ethers'
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

/**
 * True for the two failure shapes a call to a function a contract does not declare produces:
 * `CALL_EXCEPTION` (revert) and `BAD_DATA` (node answers `0x`, which is also what an EOA and an
 * undeployed address answer). Deliberately narrow — a transport error or rate limit must not be
 * read as "this contract lacks the function", so callers rethrow anything else untouched.
 */
export function isMissingFunction(err: unknown): boolean {
  return isError(err, 'CALL_EXCEPTION') || isError(err, 'BAD_DATA')
}
