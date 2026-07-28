/**
 * transferOwnership — proposes a new owner for a token pool (step 1 of the
 * OpenZeppelin `Ownable2Step` handshake; the proposee later calls `acceptOwnership`).
 *
 * Version-independent: `transferOwnership(address)` is inherited unchanged across
 * v1.5 / v1.6 / v2.0, so the calldata (and selector) is identical for every pool
 * version — no `typeAndVersion` lookup is needed. Encoded via the cached
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

/** Parameters for `transferOwnership`. */
export type TransferOwnershipParams = {
  /** Pool address whose ownership is being transferred. */
  poolAddress: string
  /** New owner address to propose. */
  newOwner: string
  sender?: string
}

/** Proposes a new pool owner via `Ownable2Step.transferOwnership`. */
export class TransferOwnership extends EVMOperation<TransferOwnershipParams> {
  readonly name = 'transferOwnership'

  /** Validates the pool and new-owner addresses before any RPC. */
  protected validate(p: TransferOwnershipParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    validateAddress(this.name, 'newOwner', p.newOwner)
  }

  /** Builds `transferOwnership(newOwner)` calldata (version-stable across v1.5–v2.0). */
  protected buildUnsigned(_chain: EVMChain, p: TransferOwnershipParams): UnsignedEVMTx {
    const data = interfaces.TokenPool_v1_6.encodeFunctionData('transferOwnership', [p.newOwner])
    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
