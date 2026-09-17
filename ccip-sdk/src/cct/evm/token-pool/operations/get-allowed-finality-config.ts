/**
 * getAllowedFinalityConfig — reads the Faster-Than-Finality (FTF) and Fast Confirmation Rule
 * (FCR/safe) modes a v2.0.0+ TokenPool accepts.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { type FinalityAllowed, decodeFinalityAllowed } from '../../../../extra-args.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  readTokenPoolAllowedFinality,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetAllowedFinalityConfig}. */
export type GetAllowedFinalityConfigParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Finality modes a v2.0.0+ pool accepts. */
export type GetAllowedFinalityConfigResult = FinalityAllowed

/** Reads the finality modes a v2.0.0 pool accepts. */
export class GetAllowedFinalityConfig extends EVMQuery<
  GetAllowedFinalityConfigParams,
  GetAllowedFinalityConfigResult
> {
  readonly name = 'getAllowedFinalityConfig'

  /** The v2.0.0 getter is inherited until a later pool ABI changes its result shape. */
  private readonly readers: Partial<Record<TokenPoolVersion, typeof readTokenPoolAllowedFinality>> =
    {
      [TokenPoolVersion.V2_0_0]: readTokenPoolAllowedFinality,
    }

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetAllowedFinalityConfigParams): GetAllowedFinalityConfigParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the compatible getter through the same floor-match as pool writes, so a newer pool
   * inherits v2.0.0's read until its ABI changes.
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
    const read = resolveEncoder(this.readers, version, this.name)
    return decodeFinalityAllowed(await read(chain, poolAddress))
  }
}
