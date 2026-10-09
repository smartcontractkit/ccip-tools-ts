/**
 * updateLockboxAuthorizedCallers — adds/removes authorized callers on an `ERC20LockBox` (v2.0.0) via
 * `applyAuthorizedCallerUpdates`. A `LockReleaseTokenPool` must be an authorized caller of its
 * lockbox before it can lock/release, and so must any account depositing liquidity into it;
 * until then the lockbox reverts `UnauthorizedCaller(address)` (selector `0xd86ad9cf`) from
 * `AuthorizedCallers._validateCaller`, and this is the op that cures it.
 * Mirrors `token-pool/operations/transfer-ownership.ts`.
 *
 * @packageDocumentation
 */

import { getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type PreconditionError, CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateArray, validateNonZeroAddress } from '../../validate.ts'
import { LOCKBOX_INTERFACE, assertLockbox, checkLockboxOwner } from '../contracts.ts'

/**
 * Parameters for {@link UpdateLockboxAuthorizedCallers}. At least one caller across both arrays is required.
 * @remarks `AuthorizedCallers._applyAuthorizedCallerUpdates` applies `removedCallers` first, so an
 * address in both arrays ends up authorized. Duplicates within either array are rejected; removing
 * an absent caller remains a no-op.
 */
export interface UpdateLockboxAuthorizedCallersParams {
  /** Address of the `ERC20LockBox` to update. */
  lockbox: string
  /** Callers to authorize (e.g. the `LockReleaseTokenPool`); defaults to `[]`. No duplicates. */
  addedCallers?: string[]
  /** Callers to deauthorize; defaults to `[]`. No duplicates. */
  removedCallers?: string[]
  /** Lockbox owner; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

function validateCallers(operation: string, param: string, callers: unknown): void {
  validateArray(operation, param, callers)
  const normalized = callers.map((caller, i) => {
    validateNonZeroAddress(operation, `${param}[${i}]`, caller)
    return getAddress(caller as string)
  })
  if (new Set(normalized).size !== normalized.length)
    throw new CCTParamsInvalidError(operation, param, 'must not contain duplicate addresses')
}

/** Applies authorized-caller updates on an `ERC20LockBox` via `applyAuthorizedCallerUpdates`. */
export class UpdateLockboxAuthorizedCallers extends EVMOperation<UpdateLockboxAuthorizedCallersParams> {
  readonly name = 'updateLockboxAuthorizedCallers'

  /** Validates the lockbox and every caller address; requires at least one caller. */
  protected override validate({
    lockbox,
    addedCallers = [],
    removedCallers = [],
  }: UpdateLockboxAuthorizedCallersParams): void {
    validateNonZeroAddress(this.name, 'lockbox', lockbox)
    validateCallers(this.name, 'addedCallers', addedCallers)
    validateCallers(this.name, 'removedCallers', removedCallers)
    if (addedCallers.length + removedCallers.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'addedCallers',
        'at least one caller must be added or removed',
      )
    }
  }

  /**
   * Confirms `lockbox` really is a deployed, supported `ERC20LockBox` and, when `sender` is known,
   * that it owns the lockbox; then builds `applyAuthorizedCallerUpdates` calldata targeting it.
   *
   * @remarks The pre-flight ({@link assertLockbox}) comes first because the failure it catches is
   * silent: `applyAuthorizedCallerUpdates` sent to an EOA or an undeployed address executes no
   * code and mines successfully, so without the read this op returns a confirmed tx hash for an
   * authorization that never happened, and the pool's first `lockOrBurn` is what finally reverts
   * `UnauthorizedCaller`. It also gates the owner read, since `owner()` is not a type check.
   * @remarks `applyAuthorizedCallerUpdates` is `onlyOwner`; that requirement is reported by
   * {@link AuthorizeLockboxCallers.preconditions} rather than reverting `OnlyCallableByOwner`
   * after a multisig has signed.
   * @remarks The calldata for a valid lockbox is unchanged by either check.
   * @throws {@link CCTParamsInvalidError} if nothing at `lockbox` answers `typeAndVersion()`
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is some other contract, e.g. the pool
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @throws {@link CCIPTypeVersionInvalidError} if `lockbox` answers `typeAndVersion()` with a
   * string that is not a `type version` pair
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { lockbox, addedCallers = [], removedCallers = [] }: UpdateLockboxAuthorizedCallersParams,
  ): Promise<UnsignedEVMTx> {
    await assertLockbox(this.name, chain, lockbox)
    const data = LOCKBOX_INTERFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
      { addedCallers, removedCallers },
    ])
    return callTx(lockbox, data)
  }

  /**
   * Confirms `sender` (when given) is the lockbox owner.
   * @remarks Reported rather than thrown outright, so a plan that hands the lockbox to this owner
   * in an earlier step can still build this transaction — and reported here rather than in
   * {@link execute} so the offline / multisig path is checked too.
   */
  protected override async preconditions(
    chain: EVMChain,
    { lockbox, sender }: UpdateLockboxAuthorizedCallersParams,
  ): Promise<PreconditionError[]> {
    if (sender === undefined) return []
    return unmet(await checkLockboxOwner(chain, lockbox, sender))
  }
}
