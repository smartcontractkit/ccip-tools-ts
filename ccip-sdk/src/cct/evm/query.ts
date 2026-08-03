/**
 * EVM CCT reads: {@link Query} bound to an {@link EVMChain}, plus {@link getTypedContract}, the
 * call-typed handle read ops decode through. Subclasses supply `validate` and `read`; the shared
 * base wires `query` (validate → read). The read-only counterpart of `EVMOperation` — no wallet,
 * no calldata, no submit.
 *
 * @packageDocumentation
 */

import type { Abi } from 'abitype'
import { type InterfaceAbi, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../evm/index.ts'
import { Query } from '../query.ts'

/** Shared base for read-only EVM CCT queries; see {@link Query}. */
export abstract class EVMQuery<P extends object, R> extends Query<EVMChain, P, R> {}

/**
 * Binds `address` to `abi` as a call-typed contract for read ops. Intersecting `abi` with ethers'
 * {@link InterfaceAbi} lets one value both type the calls and build the runtime `Interface`.
 * @remarks The CCT layer's single ethers → `ethers-abitype` bridge. The library ships
 * `typedContract` for this, but its ESM entry is unusable — `main` resolves to CJS — so the cast
 * lives here instead of at every call site.
 */
export function getTypedContract<const ABI extends Abi>(
  chain: EVMChain,
  address: string,
  abi: ABI & InterfaceAbi,
): TypedContract<ABI> {
  return new Contract(address, abi, chain.provider) as unknown as TypedContract<ABI>
}
