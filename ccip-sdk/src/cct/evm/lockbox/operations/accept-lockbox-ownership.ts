/**
 * acceptLockboxOwnership: completes a pending `ERC20LockBox` (v2.0.0) ownership transfer (step 2
 * of Ownable2Step; {@link TransferLockboxOwnership} is step 1).
 * Mirrors `token-pool/operations/accept-pool-ownership.ts`.
 *
 * @remarks Called by the **proposed** owner, so it is not owner-gated and pre-flights nothing
 * about the caller: `Ownable2Step` keeps `s_pendingOwner` `private` with no getter, so a caller
 * who is not the proposed owner simply reverts `MustBeProposedOwner`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { LOCKBOX_INTERFACE, assertLockbox } from '../contracts.ts'

/** Parameters for {@link AcceptLockboxOwnership}. */
export type AcceptLockboxOwnershipParams = {
  /** Address of the `ERC20LockBox` whose pending ownership transfer is being completed. */
  lockbox: string
  /** The proposed owner. Sets `tx.from` for offline / multisig signing, and is not checked
   * against the chain, per the module remark. {@link AcceptLockboxOwnership.execute} defaults it
   * to the signing wallet. */
  sender?: string
}

/** Completes a pending `ERC20LockBox` ownership transfer via Ownable2Step `acceptOwnership`. */
export class AcceptLockboxOwnership extends EVMOperation<AcceptLockboxOwnershipParams> {
  readonly name = 'acceptLockboxOwnership'

  /** Validates the lockbox address before any RPC; there is no other parameter to check. */
  protected override prepare(params: AcceptLockboxOwnershipParams): AcceptLockboxOwnershipParams {
    validateNonZeroAddress(this.name, 'lockbox', params.lockbox)
    return params
  }

  /**
   * Confirms `lockbox` is a deployed, supported `ERC20LockBox`, then builds `acceptOwnership`
   * calldata targeting it.
   * @remarks The calldata is one fixed selector, so {@link assertLockbox} is only there to name a
   * wrong address: a pool or token would accept the same selector and complete *its* pending
   * transfer instead.
   * @throws {@link CCTParamsInvalidError} if nothing at `lockbox` answers `typeAndVersion()`
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is some other contract, e.g. the pool
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @throws {@link CCIPTypeVersionInvalidError} if `lockbox` answers `typeAndVersion()` with a
   * string that is not a `type version` pair
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { lockbox }: AcceptLockboxOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    await assertLockbox(this.name, chain, lockbox)
    return callTx(lockbox, LOCKBOX_INTERFACE.encodeFunctionData('acceptOwnership', []))
  }
}
