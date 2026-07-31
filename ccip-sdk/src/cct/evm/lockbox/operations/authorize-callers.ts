/**
 * authorizeLockboxCallers — adds/removes authorized callers on an `ERC20LockBox` (v2.0.0) via
 * `applyAuthorizedCallerUpdates`. A `LockReleaseTokenPool` must be an authorized caller of its
 * lockbox before it can lock/release. Mirrors `token-pool/operations/transfer-ownership.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { LOCKBOX_INTERFACE } from '../contracts.ts'

/** Parameters for {@link AuthorizeLockboxCallers}. At least one caller across both arrays is required. */
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
  protected validate({
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

  /** Builds `applyAuthorizedCallerUpdates` calldata targeting the lockbox. */
  protected buildUnsigned(
    _chain: EVMChain,
    { lockbox, addedCallers = [], removedCallers = [] }: AuthorizeLockboxCallersParams,
  ): UnsignedEVMTx {
    const data = LOCKBOX_INTERFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
      { addedCallers, removedCallers },
    ])
    return callTx(lockbox, data)
  }
}
