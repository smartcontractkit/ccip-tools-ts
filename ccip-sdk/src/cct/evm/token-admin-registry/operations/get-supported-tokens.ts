/**
 * getSupportedTokens — lists the ERC-20 tokens configured in a TokenAdminRegistry. Version-independent
 * (`getAllConfiguredTokens` is byte-identical from v1.5.0 through latest).
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for {@link GetSupportedTokens}. */
export type GetSupportedTokensParams = {
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a
   * direct lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and
   * need a configured lane.
   */
  address: string
  /**
   * Batch size `chain.getSupportedTokens` requests per `getAllConfiguredTokens` call while it
   * paginates. Defaults to 1000. Optional — a very large registry may need a smaller batch to
   * stay under an RPC's response-size limit.
   */
  page?: number
}

/** Result of {@link GetSupportedTokens}: array of token addresses. */
export type GetSupportedTokensResult = string[]

/**
 * Lists every token configured in the TokenAdminRegistry resolved from `address`, paginating
 * through `getAllConfiguredTokens` until exhausted.
 */
export class GetSupportedTokens extends EVMQuery<GetSupportedTokensParams, string[]> {
  readonly name = 'getSupportedTokens'

  /**
   * Validates the resolution address and, when given, `page`; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `address` is not a valid address, or `page` is given
   * and is not a positive integer
   */
  protected prepare(params: GetSupportedTokensParams): GetSupportedTokensParams {
    validateAddress(this.name, 'address', params.address)
    if (params.page !== undefined && !(Number.isInteger(params.page) && params.page > 0))
      throw new CCTParamsInvalidError(
        this.name,
        'page',
        `must be a positive integer, got ${String(params.page)}`,
      )
    return params
  }

  /**
   * Resolves the TAR and lists its configured tokens.
   * @remarks Delegates pagination to {@link EVMChain.getSupportedTokens}, which already loops
   * `getAllConfiguredTokens(startIndex, maxCount)` until a short page ends the scan — this op does
   * not reimplement that loop.
   */
  protected async read(
    chain: EVMChain,
    { address, page }: GetSupportedTokensParams,
  ): Promise<string[]> {
    const registry = await chain.getTokenAdminRegistryFor(address)
    return chain.getSupportedTokens(registry, { page })
  }
}
