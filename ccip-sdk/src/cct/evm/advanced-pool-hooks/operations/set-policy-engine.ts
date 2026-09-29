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
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
  assertPolicyEngineContract,
  checkAdvancedPoolHooksOwner,
} from '../contracts.ts'

/** Parameters for {@link SetPolicyEngine}. */
export type SetPolicyEngineParams = {
  /** Hooks contract to reconfigure. Must be non-zero and report type `AdvancedPoolHooks`. */
  advancedPoolHooks: string
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
  protected override validate({ advancedPoolHooks, newPolicyEngine }: SetPolicyEngineParams): void {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', advancedPoolHooks)
    validateAddress(this.name, 'newPolicyEngine', newPolicyEngine)
  }

  /**
   * Confirms the target and the policy engine's code before encoding `setPolicyEngine(address)`.
   * @remarks Both stay fatal: neither an address that is not an `AdvancedPoolHooks` nor one with
   * no deployed code can be made into one by an earlier step of a plan.
   * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
   * @throws {@link CCTParamsInvalidError} if non-zero `newPolicyEngine` has no deployed code
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { advancedPoolHooks, newPolicyEngine }: SetPolicyEngineParams,
  ): Promise<UnsignedEVMTx> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    if (getAddress(newPolicyEngine) !== ZeroAddress)
      await assertPolicyEngineContract(this.name, 'newPolicyEngine', chain, newPolicyEngine)
    return callTx(
      advancedPoolHooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('setPolicyEngine', [newPolicyEngine]),
    )
  }

  /**
   * Confirms `sender` (when given) owns the hooks contract.
   * @remarks Reported rather than thrown outright, so a plan that deploys these hooks — or hands
   * them to this owner — in an earlier step can still build this transaction.
   */
  protected override async preconditions(
    chain: EVMChain,
    { advancedPoolHooks, sender }: SetPolicyEngineParams,
  ): Promise<PreconditionError[]> {
    if (sender === undefined) return []
    return unmet(await checkAdvancedPoolHooksOwner(chain, advancedPoolHooks, sender))
  }
}
