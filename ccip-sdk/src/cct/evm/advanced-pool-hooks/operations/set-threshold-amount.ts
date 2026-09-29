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
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validateUint256 } from '../../validate.ts'
import {
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
  assertAdvancedPoolHooksOwner,
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
   * Confirms the target and supplied owner before encoding `setThresholdAmount(uint256)`.
   * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
   * @throws {@link CCTParamsInvalidError} if `sender` is supplied and is not the hooks owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { advancedPoolHooks, thresholdAmount, sender }: SetThresholdAmountParams,
  ): Promise<UnsignedEVMTx> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    if (sender !== undefined)
      await assertAdvancedPoolHooksOwner(this.name, chain, advancedPoolHooks, sender)
    return callTx(
      advancedPoolHooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setThresholdAmount', [thresholdAmount]),
    )
  }
}
