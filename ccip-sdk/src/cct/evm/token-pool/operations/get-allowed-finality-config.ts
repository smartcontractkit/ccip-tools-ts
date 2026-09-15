/**
 * getAllowedFinalityConfig — reads the Faster-Than-Finality (FTF) and Fast Confirmation Rule
 * (FCR/safe) modes a v2.0.0 TokenPool accepts.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { type FinalityAllowed, decodeFinalityAllowed } from '../../../../extra-args.ts'
import { CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { TokenPoolVersion, readTokenPoolAllowedFinality, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link GetAllowedFinalityConfig}. */
export type GetAllowedFinalityConfigParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Finality modes a v2.0.0 pool accepts. */
export type GetAllowedFinalityConfigResult = FinalityAllowed

/** Reads the finality modes a v2.0.0 pool accepts. */
export class GetAllowedFinalityConfig extends EVMQuery<
  GetAllowedFinalityConfigParams,
  GetAllowedFinalityConfigResult
> {
  readonly name = 'getAllowedFinalityConfig'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetAllowedFinalityConfigParams): GetAllowedFinalityConfigParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool version before the read, so a pool without the getter reports an unsupported
   * operation rather than a bare call failure.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAllowedFinalityConfigParams,
  ): Promise<GetAllowedFinalityConfigResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    if (version !== TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return decodeFinalityAllowed(await readTokenPoolAllowedFinality(chain, poolAddress))
  }
}
