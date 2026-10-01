/**
 * getPolicyEngine — reads the policy engine of the `AdvancedPoolHooks` bound to a v2.0.0 pool.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readPolicyEngine, resolveAdvancedPoolHooks } from '../contracts.ts'

/** Parameters for {@link GetPolicyEngine}. */
export type GetPolicyEngineParams = {
  /** v2.0.0 token pool whose bound hooks are read. */
  poolAddress: string
}
/** Current policy engine; the zero address means policy checks are disabled. */
export type GetPolicyEngineResult = string

/**
 * Reads the current policy engine.
 * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, or the pool has no hooks bound
 * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
 * address is not `AdvancedPoolHooks`
 * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
 * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
 */
export class GetPolicyEngine extends EVMQuery<GetPolicyEngineParams, GetPolicyEngineResult> {
  readonly name = 'getPolicyEngine'

  protected prepare(params: GetPolicyEngineParams): GetPolicyEngineParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  protected async read(
    chain: EVMChain,
    { poolAddress }: GetPolicyEngineParams,
  ): Promise<GetPolicyEngineResult> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, poolAddress)
    return readPolicyEngine(chain, hooks)
  }
}
