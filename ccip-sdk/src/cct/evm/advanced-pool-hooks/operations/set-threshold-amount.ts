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
import { validateNonZeroAddress, validateUint256 } from '../../validate.ts'
import {
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
  checkAdvancedPoolHooksOwner,
} from '../contracts.ts'

/** Parameters for {@link SetThresholdAmount}. */
export type SetThresholdAmountParams = {
  /** Hooks contract to reconfigure. Must be non-zero and report type `AdvancedPoolHooks`. */
  advancedPoolHooks: string
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

  /** Validates the hooks address and Solidity `uint256` threshold before any RPC. */
  protected override validate({
    advancedPoolHooks,
    thresholdAmount,
  }: SetThresholdAmountParams): void {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', advancedPoolHooks)
    validateUint256(this.name, 'thresholdAmount', thresholdAmount)
  }

  /**
   * Confirms the target is an `AdvancedPoolHooks` before encoding `setThresholdAmount(uint256)`.
   * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { advancedPoolHooks, thresholdAmount }: SetThresholdAmountParams,
  ): Promise<UnsignedEVMTx> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    return callTx(
      advancedPoolHooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setThresholdAmount', [thresholdAmount]),
    )
  }

  /**
   * Confirms `sender` (when given) owns the hooks contract.
   * @remarks Reported rather than thrown outright, so a plan that deploys these hooks — or hands
   * them to this owner — in an earlier step can still build this transaction.
   */
  protected override async preconditions(
    chain: EVMChain,
    { advancedPoolHooks, sender }: SetThresholdAmountParams,
  ): Promise<PreconditionError[]> {
    if (sender === undefined) return []
    return unmet(await checkAdvancedPoolHooksOwner(chain, advancedPoolHooks, sender))
  }
}
