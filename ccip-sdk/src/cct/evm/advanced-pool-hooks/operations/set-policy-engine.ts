/**
 * setPolicyEngine — attaches a policy engine to an `AdvancedPoolHooks`, or disables policy checks.
 *
 * @remarks The hooks contract detaches the previous engine before attaching the new one. If that
 * detach reverts, this transaction reverts too; use the contract's explicit
 * `setPolicyEngineAllowFailedDetach` escape hatch directly only when recovering from a bad old
 * engine.
 *
 * Owner-only. The target is verified as `AdvancedPoolHooks`, a non-zero engine must have deployed
 * code, and a supplied sender is checked against the hooks' on-chain `owner()` before calldata is
 * built. Code presence does not prove the engine implements the required `attach()` / `detach()`
 * hooks; an incompatible deployed contract reverts on-chain.
 *
 * @packageDocumentation
 */

import { ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'
import {
  type AdvancedPoolHooksTarget,
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksOwner,
  assertPolicyEngineContract,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link SetPolicyEngine}. */
export type SetPolicyEngineParams = AdvancedPoolHooksTarget & {
  /** Policy engine to attach; must have deployed code unless zero, which disables policy checks.
   * It must also implement the required `attach()` / `detach()` hooks. */
  newPolicyEngine: string
  /**
   * Hooks owner. Sets `tx.from` for offline / multisig signing and, when supplied, is checked
   * against the hooks' on-chain `owner()` before calldata is built. Optional for
   * {@link SetPolicyEngine.generate}; {@link SetPolicyEngine.execute} defaults it to the signing
   * wallet.
   */
  sender?: string
}

/** Attaches a policy engine, or clears it with the zero address. Owner-only. */
export class SetPolicyEngine extends EVMOperation<SetPolicyEngineParams> {
  readonly name = 'setPolicyEngine'

  /** Validates addresses before any RPC; zero `newPolicyEngine` deliberately disables checks. */
  protected override prepare(params: SetPolicyEngineParams): SetPolicyEngineParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    validateAddress(this.name, 'newPolicyEngine', params.newPolicyEngine)
    return params
  }

  /**
   * Confirms the target, policy engine code, and supplied owner before encoding
   * `setPolicyEngine(address)`.
   * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
   * @throws {@link CCTParamsInvalidError} if non-zero `newPolicyEngine` has no deployed code
   * @throws {@link CCTParamsInvalidError} if `sender` is supplied and is not the hooks owner
   * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetPolicyEngineParams,
  ): Promise<UnsignedEVMTx> {
    const { newPolicyEngine, sender } = params
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    if (getAddress(newPolicyEngine) !== ZeroAddress)
      await assertPolicyEngineContract(this.name, 'newPolicyEngine', chain, newPolicyEngine)
    if (sender !== undefined) await assertAdvancedPoolHooksOwner(this.name, chain, hooks, sender)
    return callTx(
      hooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setPolicyEngine', [newPolicyEngine]),
    )
  }
}
