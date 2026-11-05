/**
 * getPolicyEngine — reads an `AdvancedPoolHooks` policy engine address.
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

/** Parameters for {@link GetPolicyEngine}. */
export type GetPolicyEngineParams = AdvancedPoolHooksTarget
/** Current policy engine; the zero address means policy checks are disabled. */
export type GetPolicyEngineResult = string

/**
 * Reads the current policy engine.
 * @throws {@link CCTParamsInvalidError} if the target is invalid
 * @throws {@link CCTContractTypeInvalidError} if the target is not `AdvancedPoolHooks`
 * @throws as {@link resolveAdvancedPoolHooks} for a `poolAddress` target
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
