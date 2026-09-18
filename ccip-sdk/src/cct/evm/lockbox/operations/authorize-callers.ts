/**
 * authorizeLockboxCallers — adds/removes authorized callers on an `ERC20LockBox` (v2.0.0) via
 * `applyAuthorizedCallerUpdates`. A `LockReleaseTokenPool` must be an authorized caller of its
 * lockbox before it can lock/release, and so must any account depositing liquidity into it;
 * until then the lockbox reverts `UnauthorizedCaller(address)` (selector `0xd86ad9cf`) from
 * `AuthorizedCallers._validateCaller`, and this is the op that cures it.
 * Mirrors `token-pool/operations/transfer-ownership.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { LOCKBOX_INTERFACE, assertLockbox } from '../contracts.ts'

/**
 * Parameters for {@link AuthorizeLockboxCallers}. At least one caller across both arrays is required.
 * @remarks `AuthorizedCallers._applyAuthorizedCallerUpdates` applies `removedCallers` first, so an
 * address in both arrays ends up authorized. The list is a set: re-adding an existing caller is a
 * no-op (though `AuthorizedCallerAdded` still fires), and removing an absent one emits nothing.
 */
export interface AuthorizeLockboxCallersParams {
  /** Address of the `ERC20LockBox` to update. */
  lockbox: string
  /** Callers to authorize (e.g. the `LockReleaseTokenPool`); defaults to `[]`. */
  addedCallers?: string[]
  /** Callers to deauthorize; defaults to `[]`. */
  removedCallers?: string[]
  /** Lockbox owner; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Applies authorized-caller updates on an `ERC20LockBox` via `applyAuthorizedCallerUpdates`. */
export class AuthorizeLockboxCallers extends EVMOperation<AuthorizeLockboxCallersParams> {
  readonly name = 'authorizeLockboxCallers'

  /** Validates the lockbox and every caller address; requires at least one caller. */
  protected override validate({
    lockbox,
    addedCallers = [],
    removedCallers = [],
  }: AuthorizeLockboxCallersParams): void {
    validateNonZeroAddress(this.name, 'lockbox', lockbox)
    if (addedCallers.length + removedCallers.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'addedCallers',
        'at least one caller must be added or removed',
      )
    }
    const validateCaller = (field: string, c: string, i: number): void =>
      validateNonZeroAddress(this.name, `${field}[${i}]`, c)
    addedCallers.forEach((c, i) => validateCaller('addedCallers', c, i))
    removedCallers.forEach((c, i) => validateCaller('removedCallers', c, i))
  }

  /**
   * Confirms `lockbox` really is a deployed, supported `ERC20LockBox`, then builds
   * `applyAuthorizedCallerUpdates` calldata targeting it.
   *
   * @remarks The pre-flight ({@link assertLockbox}) comes first because the failure it catches is
   * silent: `applyAuthorizedCallerUpdates` sent to an EOA or an undeployed address executes no
   * code and mines successfully, so without the read this op returns a confirmed tx hash for an
   * authorization that never happened, and the pool's first `lockOrBurn` is what finally reverts
   * `UnauthorizedCaller`. It lives here, not in {@link execute}, so the offline / multisig path is
   * checked too rather than being handed calldata that does nothing.
   * @remarks The calldata for a valid lockbox is unchanged by the check.
   * @throws {@link CCTParamsInvalidError} if nothing at `lockbox` answers `typeAndVersion()`
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is some other contract, e.g. the pool
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { lockbox, addedCallers = [], removedCallers = [] }: AuthorizeLockboxCallersParams,
  ): Promise<UnsignedEVMTx> {
    await assertLockbox(this.name, chain, lockbox)
    const data = LOCKBOX_INTERFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
      { addedCallers, removedCallers },
    ])
    return callTx(lockbox, data)
  }
}
