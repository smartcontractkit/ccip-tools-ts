/**
 * getPolicyEngine — reads an `AdvancedPoolHooks` policy engine address.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { assertAdvancedPoolHooksContract, readPolicyEngine } from '../contracts.ts'

/** Parameters for {@link GetPolicyEngine}. */
export type GetPolicyEngineParams = { advancedPoolHooks: string }
/** Current policy engine; the zero address means policy checks are disabled. */
export type GetPolicyEngineResult = string

/**
 * Reads the current policy engine.
 * @throws {@link CCTParamsInvalidError} if `advancedPoolHooks` is invalid
 * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
 */
export class GetPolicyEngine extends EVMQuery<GetPolicyEngineParams, GetPolicyEngineResult> {
  readonly name = 'getPolicyEngine'

  protected prepare(params: GetPolicyEngineParams): GetPolicyEngineParams {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    return params
  }

  protected async read(
    chain: EVMChain,
    { advancedPoolHooks }: GetPolicyEngineParams,
  ): Promise<GetPolicyEngineResult> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    return readPolicyEngine(chain, advancedPoolHooks)
  }
}
