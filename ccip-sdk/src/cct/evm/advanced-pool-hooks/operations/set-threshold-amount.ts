/**
 * setThresholdAmount — sets the amount at which the `AdvancedPoolHooks` bound to a v2.0.0 pool
 * require additional CCVs.
 *
 * @remarks Zero disables threshold CCVs. Base CCVs remain required regardless of this setting.
 *
 * @remarks The target is resolved from the pool: the tx goes to the hooks bound to `poolAddress`,
 * not to the pool. Hooks may be shared, so the threshold applies to every pool bound to the same
 * hooks.
 *
 * Owner-only — gated on the *hooks* owner. The bound address's `typeAndVersion()` is checked
 * before building calldata, and a supplied sender is checked against the hooks' on-chain `owner()`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validateUint256 } from '../../validate.ts'
import {
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksOwner,
  resolveAdvancedPoolHooks,
} from '../contracts.ts'

/** Parameters for {@link SetThresholdAmount}. */
export type SetThresholdAmountParams = {
  /**
   * v2.0.0 token pool whose bound `AdvancedPoolHooks` are reconfigured. The tx goes to those hooks,
   * so it changes every pool bound to them, not just this one.
   */
  poolAddress: string
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

  /** Validates the pool address and Solidity `uint256` threshold before any RPC. */
  protected override validate({ poolAddress, thresholdAmount }: SetThresholdAmountParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateUint256(this.name, 'thresholdAmount', thresholdAmount)
  }

  /**
   * Resolves the hooks bound to the pool and confirms the supplied owner before encoding
   * `setThresholdAmount(uint256)` to the hooks.
   * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
   * address is not `AdvancedPoolHooks`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound, or `sender` is supplied
   * and is not the hooks owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { poolAddress, thresholdAmount, sender }: SetThresholdAmountParams,
  ): Promise<UnsignedEVMTx> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    if (sender !== undefined) await assertAdvancedPoolHooksOwner(this.name, chain, hooks, sender)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setThresholdAmount', [thresholdAmount]),
    )
  }
}
