/**
 * setThresholdAmount — sets the amount at which `AdvancedPoolHooks` require additional CCVs.
 *
 * @remarks Zero disables threshold CCVs. Base CCVs remain required regardless of this setting.
 *
 * @remarks The tx goes to the hooks — `advancedPoolHooks`, or those bound to `poolAddress` — not
 * to the pool. Hooks may be shared, so the threshold applies to every pool bound to the same hooks.
 *
 * Owner-only — gated on the *hooks* owner. The target's `typeAndVersion()` is checked before
 * building calldata, and a supplied sender is checked against the hooks' on-chain `owner()`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateUint256 } from '../../validate.ts'
import {
  type AdvancedPoolHooksTarget,
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksOwner,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link SetThresholdAmount}; the hooks are given directly or through a pool. */
export type SetThresholdAmountParams = AdvancedPoolHooksTarget & {
  /** Amount at or above which threshold CCVs apply; zero disables threshold CCVs. */
  thresholdAmount: bigint
  /**
   * Hooks owner, which need not be the pool owner. Sets `tx.from` for offline / multisig signing
   * and, when supplied, is checked against the hooks' on-chain `owner()` before calldata is built.
   * Optional for {@link SetThresholdAmount.generate}; {@link SetThresholdAmount.execute} defaults
   * it to the signing wallet.
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
   * Resolves the target hooks and confirms the supplied owner before encoding
   * `setThresholdAmount(uint256)` to the hooks.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`, or the
   * pool's type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound, or `sender` is supplied
   * and is not the hooks owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetThresholdAmountParams,
  ): Promise<UnsignedEVMTx> {
    const { thresholdAmount, sender } = params
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    if (sender !== undefined) await assertAdvancedPoolHooksOwner(this.name, chain, hooks, sender)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setThresholdAmount', [thresholdAmount]),
    )
  }
}
