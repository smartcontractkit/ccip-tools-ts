/**
 * updateAdvancedPoolHooksAuthorizedCallers — adds and removes callers permitted to invoke an
 * `AdvancedPoolHooks` contract's preflight and postflight checks.
 *
 * @remarks Removes are applied before adds, so an address in both arrays remains authorized.
 * Owner-only; the hooks target and a supplied sender are pre-flighted before calldata is built.
 *
 * @packageDocumentation
 */

import { getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateArray, validateNonZeroAddress } from '../../validate.ts'
import {
  type AdvancedPoolHooksTarget,
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksOwner,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link UpdateAdvancedPoolHooksAuthorizedCallers}. */
export type UpdateAdvancedPoolHooksAuthorizedCallersParams = AdvancedPoolHooksTarget & {
  /** Callers to authorize; defaults to `[]`. Must be non-zero and contain no duplicates. */
  addedCallers?: string[]
  /** Callers to deauthorize; defaults to `[]`. Must be non-zero and contain no duplicates. */
  removedCallers?: string[]
  /** Hooks owner; sets `tx.from` and is checked when supplied. */
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

/** Applies authorized-caller additions and removals. Owner-only. */
export class UpdateAdvancedPoolHooksAuthorizedCallers extends EVMOperation<UpdateAdvancedPoolHooksAuthorizedCallersParams> {
  readonly name = 'updateAdvancedPoolHooksAuthorizedCallers'

  /** Validates addresses and requires at least one addition or removal before any RPC. */
  protected override prepare(
    params: UpdateAdvancedPoolHooksAuthorizedCallersParams,
  ): UpdateAdvancedPoolHooksAuthorizedCallersParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    const { addedCallers = [], removedCallers = [] } = params
    validateCallers(this.name, 'addedCallers', addedCallers)
    validateCallers(this.name, 'removedCallers', removedCallers)
    if (addedCallers.length + removedCallers.length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'addedCallers',
        'at least one caller must be added or removed',
      )
    return params
  }

  /**
   * Confirms the target hooks are a deployed `AdvancedPoolHooks` and, when `sender` is known, that
   * it owns them; then builds `applyAuthorizedCallerUpdates` calldata targeting them.
   *
   * @remarks The contract-type pre-flight comes first because this call sent to an EOA succeeds
   * without changing hooks state. It also gates the owner read, since `owner()` is not a type check.
   * @remarks `applyAuthorizedCallerUpdates` is `onlyOwner`, so a non-owner `sender` is rejected
   * before an offline or multisig signer submits the transaction.
   * @remarks Removes run before adds, so an address in both arrays remains authorized. Repeated
   * callers within either array are rejected, including addresses that differ only by casing.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTParamsInvalidError} if `sender` is not the hooks owner
   * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: UpdateAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<UnsignedEVMTx> {
    const { addedCallers = [], removedCallers = [], sender } = params
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    if (sender !== undefined) await assertAdvancedPoolHooksOwner(this.name, chain, hooks, sender)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
        { addedCallers, removedCallers },
      ]),
    )
  }
}
