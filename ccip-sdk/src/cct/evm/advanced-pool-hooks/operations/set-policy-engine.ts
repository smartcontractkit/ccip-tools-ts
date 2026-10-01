/**
 * setPolicyEngine — attaches a policy engine to the `AdvancedPoolHooks` bound to a v2.0.0 pool, or
 * disables policy checks.
 *
 * @remarks The hooks contract detaches the previous engine before attaching the new one. If that
 * detach reverts, this transaction reverts too; use the contract's explicit
 * `setPolicyEngineAllowFailedDetach` escape hatch directly only when recovering from a bad old
 * engine.
 *
 * @remarks The target is resolved from the pool: the tx goes to the hooks bound to `poolAddress`,
 * not to the pool. Hooks may be shared, so the engine applies to every pool bound to the same
 * hooks.
 *
 * Owner-only — gated on the *hooks* owner. The bound address is verified as `AdvancedPoolHooks`,
 * a non-zero engine must have deployed code, and a supplied sender is checked against the hooks'
 * on-chain `owner()` before calldata is built. Code presence does not prove the engine implements
 * the required `attach()` / `detach()` hooks; an incompatible deployed contract reverts on-chain.
 *
 * @packageDocumentation
 */

import { ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksOwner,
  assertPolicyEngineContract,
  resolveAdvancedPoolHooks,
} from '../contracts.ts'

/** Parameters for {@link SetPolicyEngine}. */
export type SetPolicyEngineParams = {
  /**
   * v2.0.0 token pool whose bound `AdvancedPoolHooks` are reconfigured. The tx goes to those hooks,
   * so it changes every pool bound to them, not just this one.
   */
  poolAddress: string
  /** Policy engine to attach; must have deployed code unless zero, which disables policy checks.
   * It must also implement the required `attach()` / `detach()` hooks. */
  newPolicyEngine: string
  /**
   * Hooks owner, which need not be the pool owner. Sets `tx.from` for offline / multisig signing
   * and, when supplied, is checked against the hooks' on-chain `owner()` before calldata is built.
   * Optional for {@link SetPolicyEngine.generate}; {@link SetPolicyEngine.execute} defaults it to
   * the signing wallet.
   */
  sender?: string
}

/** Attaches a policy engine, or clears it with the zero address. Owner-only. */
export class SetPolicyEngine extends EVMOperation<SetPolicyEngineParams> {
  readonly name = 'setPolicyEngine'

  /** Validates addresses before any RPC; zero `newPolicyEngine` deliberately disables checks. */
  protected override validate({ poolAddress, newPolicyEngine }: SetPolicyEngineParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'newPolicyEngine', newPolicyEngine)
  }

  /**
   * Resolves the hooks bound to the pool, then confirms the policy engine code and supplied owner
   * before encoding `setPolicyEngine(address)` to the hooks.
   * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
   * address is not `AdvancedPoolHooks`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound, a non-zero
   * `newPolicyEngine` has no deployed code, or `sender` is supplied and is not the hooks owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { poolAddress, newPolicyEngine, sender }: SetPolicyEngineParams,
  ): Promise<UnsignedEVMTx> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    if (getAddress(newPolicyEngine) !== ZeroAddress)
      await assertPolicyEngineContract(this.name, 'newPolicyEngine', chain, newPolicyEngine)
    if (sender !== undefined) await assertAdvancedPoolHooksOwner(this.name, chain, hooks, sender)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setPolicyEngine', [newPolicyEngine]),
    )
  }
}
