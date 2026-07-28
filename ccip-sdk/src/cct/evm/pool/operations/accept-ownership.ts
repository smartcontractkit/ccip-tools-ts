/**
 * acceptOwnership — accepts a pending ownership transfer on a token pool (step 2 of
 * the OpenZeppelin `Ownable2Step` handshake; called by the address a prior
 * `transferOwnership` proposed).
 *
 * Version-independent: `acceptOwnership()` is inherited unchanged across
 * v1.5 / v1.6 / v2.0, so the calldata (just the selector) is identical for every
 * pool version — no `typeAndVersion` lookup is needed. Encoded via the cached
 * `TokenPool_v1_6` interface.
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `acceptOwnership`. */
export type AcceptOwnershipParams = {
  /** Pool address whose pending ownership is being accepted. */
  poolAddress: string
  sender?: string
}

/** Accepts a pending pool ownership transfer via `Ownable2Step.acceptOwnership`. */
export class AcceptOwnership extends EVMOperation<AcceptOwnershipParams> {
  readonly name = 'acceptOwnership'

  /** Validates the pool address before any RPC. */
  protected validate(p: AcceptOwnershipParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
  }

  /** Builds `acceptOwnership()` calldata (version-stable across v1.5–v2.0). */
  protected buildUnsigned(_chain: EVMChain, p: AcceptOwnershipParams): UnsignedEVMTx {
    const data = interfaces.TokenPool_v1_6.encodeFunctionData('acceptOwnership', [])
    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
