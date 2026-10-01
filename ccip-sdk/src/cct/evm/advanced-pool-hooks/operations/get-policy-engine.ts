/**
 * getPolicyEngine — reads the policy engine of `AdvancedPoolHooks`, given directly or as the hooks
 * bound to a v2.0.0 pool.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import {
  type AdvancedPoolHooksTarget,
  readPolicyEngine,
  resolveAdvancedPoolHooksTarget,
  validateAdvancedPoolHooksTarget,
} from '../contracts.ts'

/** Parameters for {@link GetPolicyEngine}: the hooks to read, directly or through a pool. */
export type GetPolicyEngineParams = AdvancedPoolHooksTarget
/** Current policy engine; the zero address means policy checks are disabled. */
export type GetPolicyEngineResult = string

/**
 * Reads the current policy engine.
 * @throws {@link CCTParamsInvalidError} if the target is invalid, or the pool has no hooks bound
 * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`, or the
 * pool's type is not supported
 * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
 * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
 */
export class GetPolicyEngine extends EVMQuery<GetPolicyEngineParams, GetPolicyEngineResult> {
  readonly name = 'getPolicyEngine'

  protected prepare(params: GetPolicyEngineParams): GetPolicyEngineParams {
    validateAdvancedPoolHooksTarget(this.name, params)
    return params
  }

  protected async read(
    chain: EVMChain,
    params: GetPolicyEngineParams,
  ): Promise<GetPolicyEngineResult> {
    const hooks = await resolveAdvancedPoolHooksTarget(this.name, chain, params)
    return readPolicyEngine(chain, hooks)
  }
}
