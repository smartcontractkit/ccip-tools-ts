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
import { type PreconditionError, CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateArray, validateNonZeroAddress } from '../../validate.ts'
import {
  type AdvancedPoolHooksTarget,
  ADVANCED_POOL_HOOKS_INTERFACE,
  checkAdvancedPoolHooksOwner,
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
  protected override validate(params: UpdateAdvancedPoolHooksAuthorizedCallersParams): void {
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
  }

  /**
   * Confirms the target hooks are a deployed `AdvancedPoolHooks`, then builds
   * `applyAuthorizedCallerUpdates` calldata targeting them.
   *
   * @remarks The contract-type pre-flight comes first because this call sent to an EOA succeeds
   * without changing hooks state. It also gates the owner read in {@link preconditions}, since
   * `owner()` is not a type check.
   * @remarks Removes run before adds, so an address in both arrays remains authorized. Repeated
   * callers within either array are rejected, including addresses that differ only by casing.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: UpdateAdvancedPoolHooksAuthorizedCallersParams,
  ): Promise<UnsignedEVMTx> {
    const { addedCallers = [], removedCallers = [] } = params
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
        { addedCallers, removedCallers },
      ]),
    )
  }

  /**
   * Confirms `sender` (when given) owns the hooks contract.
   * @remarks Reported rather than thrown outright, so a plan that deploys these hooks — or hands
   * them to this owner — in an earlier step can still build this transaction.
   */
  protected override async preconditions(
    chain: EVMChain,
    { sender }: UpdateAdvancedPoolHooksAuthorizedCallersParams,
    tx: UnsignedEVMTx,
  ): Promise<PreconditionError[]> {
    if (sender === undefined) return []
    // The hooks buildUnsigned resolved, directly or through the pool, are the tx target.
    const hooks = tx.transactions[0]!.to as string
    return unmet(await checkAdvancedPoolHooksOwner(chain, hooks, sender))
  }
}
