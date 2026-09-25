/**
 * getDynamicConfig — reads a v2.0.0+ pool's router and delegated admin roles.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  type TokenPoolDynamicConfig,
  TokenPoolVersion,
  readTokenPoolDynamicConfig,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetDynamicConfig}. */
export type GetDynamicConfigParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Router and delegated admin roles returned by a v2.0.0+ pool, checksummed. */
export type GetDynamicConfigResult = TokenPoolDynamicConfig

/** Reads a v2.0.0+ pool's router and delegated admin roles. */
export class GetDynamicConfig extends EVMQuery<GetDynamicConfigParams, GetDynamicConfigResult> {
  readonly name = 'getDynamicConfig'

  /** The v2.0.0 getter is inherited until a later pool ABI changes its result shape. */
  private readonly readers: Partial<Record<TokenPoolVersion, typeof readTokenPoolDynamicConfig>> = {
    [TokenPoolVersion.V2_0_0]: readTokenPoolDynamicConfig,
  }

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetDynamicConfigParams): GetDynamicConfigParams {
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
    { poolAddress }: GetDynamicConfigParams,
  ): Promise<GetDynamicConfigResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    return resolveEncoder(this.readers, version, this.name)(chain, poolAddress)
  }
}
