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
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
  assertAdvancedPoolHooksOwner,
} from '../contracts.ts'

/** Parameters for {@link UpdateAdvancedPoolHooksAuthorizedCallers}. */
export type UpdateAdvancedPoolHooksAuthorizedCallersParams = {
  /** Hooks contract to reconfigure. Must be non-zero and report type `AdvancedPoolHooks`. */
  advancedPoolHooks: string
  /** Callers to authorize; defaults to `[]`. */
  addedCallers?: string[]
  /** Callers to deauthorize; defaults to `[]`. */
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
  protected override validate({
    advancedPoolHooks,
    addedCallers = [],
    removedCallers = [],
  }: UpdateAdvancedPoolHooksAuthorizedCallersParams): void {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', advancedPoolHooks)
    validateCallers(this.name, 'addedCallers', addedCallers)
    validateCallers(this.name, 'removedCallers', removedCallers)
    if (addedCallers.length + removedCallers.length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'addedCallers',
        'at least one caller must be added or removed',
      )
  }

  /** Confirms the hooks target and supplied owner before encoding the update. */
  protected async buildUnsigned(
    chain: EVMChain,
    {
      advancedPoolHooks,
      addedCallers = [],
      removedCallers = [],
      sender,
    }: UpdateAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<UnsignedEVMTx> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    if (sender !== undefined)
      await assertAdvancedPoolHooksOwner(this.name, chain, advancedPoolHooks, sender)
    return callTx(
      advancedPoolHooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
        { addedCallers, removedCallers },
      ]),
    )
  }
}
