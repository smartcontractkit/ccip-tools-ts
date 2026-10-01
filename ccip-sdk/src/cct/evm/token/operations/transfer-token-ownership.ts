/**
 * transferTokenOwnership — deprecated alias of {@link BeginDefaultAdminTransfer} (non-zero
 * `newOwner`) and {@link CancelDefaultAdminTransfer} (zero `newOwner`), on either token version.
 *
 * @remarks The zero split keeps this op's documented v1 meaning, where `transferOwnership(0x0)`
 * retracts a pending proposal: on v1 both routes encode the same calldata as before, and on v2 a
 * zero `newOwner` cancels the pending transfer rather than scheduling renunciation. Errors keep
 * this op's name and report `newOwner`.
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
 * @deprecated Use `BeginDefaultAdminTransferParams` (or `CancelDefaultAdminTransferParams` to
 * retract) instead.
 */
export type TransferTokenOwnershipParams = {
  /** Token whose admin is being proposed away; must be non-zero. */
  tokenAddress: string
  /** Proposed admin; zero retracts a pending proposal (see the module remarks). */
  newOwner: string
  /** Current admin (v1 `owner()`, v2 default admin); optional for offline signing and checked when supplied. */
  sender?: string
}

/**
 * Proposes (or, with zero `newOwner`, retracts) a token-admin handoff.
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
   * @throws {@link CCTContractVersionUnsupportedError} if a CrossChainToken reports an unknown
   * version
   * @throws {@link CCTParamsInvalidError} per the routed op's pre-flights
   */
  protected buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newOwner, sender }: TransferTokenOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    if (getAddress(newOwner) === ZeroAddress)
      return buildCancelDefaultAdminTransfer(this.name, chain, { tokenAddress, sender })
    return buildBeginDefaultAdminTransfer(
      this.name,
      chain,
      { tokenAddress, newAdmin: newOwner, sender },
      'newOwner',
    )
  }
}
