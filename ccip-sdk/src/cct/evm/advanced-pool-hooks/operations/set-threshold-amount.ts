/**
 * setThresholdAmount — sets the amount at which `AdvancedPoolHooks` requires additional CCVs.
 *
 * @remarks Zero disables threshold CCVs. Base CCVs remain required regardless of this setting.
 *
 * Owner-only. The target's `typeAndVersion()` is checked before building calldata, and a supplied
 * sender is checked against the hooks' on-chain `owner()`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateUint256 } from '../../validate.ts'
import {
  type AdvancedPoolHooksTarget,
  ADVANCED_POOL_HOOKS_INTERFACE,
  checkAdvancedPoolHooksOwner,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link SetThresholdAmount}. */
export type SetThresholdAmountParams = AdvancedPoolHooksTarget & {
  /** Amount at or above which threshold CCVs apply; zero disables threshold CCVs. */
  thresholdAmount: bigint
  /**
   * Hooks owner. Sets `tx.from` for offline / multisig signing and, when supplied, is checked
   * against the hooks' on-chain `owner()` before calldata is built. Optional for
   * {@link SetThresholdAmount.generate}; {@link SetThresholdAmount.execute} defaults it to the
   * signing wallet.
   */
  sender?: string
}

/** Sets the threshold for additional CCVs; zero disables threshold CCVs. Owner-only. */
export class SetThresholdAmount extends EVMOperation<SetThresholdAmountParams> {
  readonly name = 'setThresholdAmount'

  /** Validates the target and Solidity `uint256` threshold before any RPC. */
  protected override validate(params: SetThresholdAmountParams): void {
    validateAdvancedPoolHooksTarget(this.name, params)
    validateUint256(this.name, 'thresholdAmount', params.thresholdAmount)
  }

  /**
   * Confirms the target is an `AdvancedPoolHooks` before encoding `setThresholdAmount(uint256)`.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetThresholdAmountParams,
  ): Promise<UnsignedEVMTx> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setThresholdAmount', [
        params.thresholdAmount,
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
    { sender }: SetThresholdAmountParams,
    tx: UnsignedEVMTx,
  ): Promise<PreconditionError[]> {
    if (sender === undefined) return []
    // The hooks buildUnsigned resolved, directly or through the pool, are the tx target.
    const hooks = tx.transactions[0]!.to as string
    return unmet(await checkAdvancedPoolHooksOwner(chain, hooks, sender))
  }
}
