/**
 * transferTokenOwnership — deprecated alias of {@link BeginDefaultAdminTransfer}, or of
 * {@link CancelDefaultAdminTransfer} for a zero `newOwner` (keeping v1's retract meaning, also on
 * v2). Errors keep this op's name and report `newOwner`.
 *
 * @packageDocumentation
 */

import { ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import { buildBeginDefaultAdminTransfer } from './begin-default-admin-transfer.ts'
import { buildCancelDefaultAdminTransfer } from './cancel-default-admin-transfer.ts'

/**
 * Parameters for {@link TransferTokenOwnership}.
 * @deprecated Use `BeginDefaultAdminTransferParams` or `CancelDefaultAdminTransferParams` instead.
 */
export type TransferTokenOwnershipParams = {
  /** Token whose admin is being proposed away. */
  tokenAddress: string
  /** Proposed admin; zero retracts a pending proposal. */
  newOwner: string
  /** Current admin; optional for offline signing and checked when supplied. */
  sender?: string
}

/**
 * Proposes a new token admin, or retracts a pending proposal for a zero `newOwner`.
 * @deprecated Use {@link BeginDefaultAdminTransfer} or {@link CancelDefaultAdminTransfer} instead.
 */
export class TransferTokenOwnership extends EVMOperation<TransferTokenOwnershipParams> {
  readonly name = 'transferTokenOwnership'

  /** Validates both addresses before any RPC. */
  protected override validate({ tokenAddress, newOwner }: TransferTokenOwnershipParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateAddress(this.name, 'newOwner', newOwner)
  }

  /**
   * Routes a zero `newOwner` to {@link CancelDefaultAdminTransfer}'s builder and any other to
   * {@link BeginDefaultAdminTransfer}'s, with that op's pre-flights.
   */
  protected buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newOwner, sender }: TransferTokenOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    if (getAddress(newOwner) === ZeroAddress)
      return buildCancelDefaultAdminTransfer(this.name, chain, {
        tokenAddress,
        sender,
      })
    return buildBeginDefaultAdminTransfer(
      this.name,
      chain,
      { tokenAddress, newAdmin: newOwner, sender },
      'newOwner',
    )
  }
}
