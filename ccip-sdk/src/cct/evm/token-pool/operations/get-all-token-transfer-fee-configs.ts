/**
 * getAllTokenTransferFeeConfigs: reads a v2.0.0+ pool's token-transfer fee configuration for every
 * lane it supports. The all-lanes variant of `get-token-transfer-fee-config.ts`.
 *
 * @packageDocumentation
 */

import { isHexString, toBeHex } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { type FinalityRequested, encodeFinality } from '../../../../extra-args.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  type LaneTokenTransferFeeConfig,
  TokenPoolVersion,
  readTokenPoolTokenTransferFeeConfigs,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetAllTokenTransferFeeConfigs}. */
export type GetAllTokenTransferFeeConfigsParams = {
  /** Token pool to read. */
  poolAddress: string
  /** Requested finality mode, applied to every lane; defaults to `'finalized'`. */
  finality?: FinalityRequested
  /**
   * Hex-encoded token-pool-specific arguments, applied to every lane; defaults to empty bytes
   * (`'0x'`).
   */
  tokenArgs?: string
}

/**
 * Result of {@link GetAllTokenTransferFeeConfigs}: each supported lane's token-transfer fee
 * configuration with its selector, in `getSupportedChains()` order; `[]` when the pool supports no
 * lane.
 */
export type GetAllTokenTransferFeeConfigsResult = LaneTokenTransferFeeConfig[]

/**
 * Reads a v2.0.0+ pool's token-transfer fee configuration for every lane in
 * `getSupportedChains()`. One lane's config is `getTokenTransferFeeConfig`.
 */
export class GetAllTokenTransferFeeConfigs extends EVMQuery<
  GetAllTokenTransferFeeConfigsParams,
  GetAllTokenTransferFeeConfigsResult
> {
  readonly name = 'getAllTokenTransferFeeConfigs'

  /** The v2.0.0 getter is inherited until a later pool ABI changes its result shape. */
  private readonly readers: Partial<
    Record<TokenPoolVersion, typeof readTokenPoolTokenTransferFeeConfigs>
  > = { [TokenPoolVersion.V2_0_0]: readTokenPoolTokenTransferFeeConfigs }

  /**
   * Validates the pool address and, when given, `finality` and `tokenArgs`; nothing to convert
   * for {@link read}.
   * @throws {@link CCTParamsInvalidError} if a getter argument cannot be ABI-encoded
   */
  protected prepare(
    params: GetAllTokenTransferFeeConfigsParams,
  ): GetAllTokenTransferFeeConfigsParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    if (
      params.finality !== undefined &&
      params.finality !== 'finalized' &&
      params.finality !== 'safe' &&
      (!Number.isInteger(params.finality) || params.finality < 1 || params.finality > 65535)
    )
      throw new CCTParamsInvalidError(
        this.name,
        'finality',
        'must be finalized, safe, or an integer in [1, 65535]',
      )
    if (params.tokenArgs !== undefined && !isHexString(params.tokenArgs, true))
      throw new CCTParamsInvalidError(this.name, 'tokenArgs', 'must be a hex string')
    return params
  }

  /**
   * Resolves the pool once, before any lane is read, through the same floor-match as
   * `getTokenTransferFeeConfig`, so a pre-v2.0.0 pool fails typed instead of on its first lane.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, finality, tokenArgs }: GetAllTokenTransferFeeConfigsParams,
  ): Promise<GetAllTokenTransferFeeConfigsResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    return resolveEncoder(this.readers, version, this.name)(
      chain,
      poolAddress,
      toBeHex(encodeFinality(finality ?? 'finalized'), 4),
      tokenArgs ?? '0x',
    )
  }
}
