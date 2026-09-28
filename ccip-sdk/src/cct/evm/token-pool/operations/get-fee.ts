/**
 * getFee — reads the fee parameters a v2.0.0+ pool applies to a destination chain and finality.
 *
 * @packageDocumentation
 */

import { toBeHex } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { type FinalityRequested, encodeFinality } from '../../../../extra-args.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateUint64 } from '../../validate.ts'
import {
  type TokenPoolFee,
  TokenPoolVersion,
  readTokenPoolFee,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetFee}. */
export type GetFeeParams = {
  /** Token pool to read. */
  poolAddress: string
  /** Destination CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
  /** Requested finality mode; defaults to `'finalized'`. */
  finality?: FinalityRequested
}

/**
 * Fee parameters resolved for the requested finality tier by a v2.0.0+ pool.
 *
 * Use `getTokenTransferFeeConfig` for the raw configuration containing both finality tiers.
 */
export type GetFeeResult = TokenPoolFee

/** Reads the fee parameters a v2.0.0+ pool applies to one destination chain and finality. */
export class GetFee extends EVMQuery<GetFeeParams, GetFeeResult> {
  readonly name = 'getFee'

  /** The v2.0.0 getter is inherited until a later pool ABI changes its result shape. */
  private readonly readers: Partial<Record<TokenPoolVersion, typeof readTokenPoolFee>> = {
    [TokenPoolVersion.V2_0_0]: readTokenPoolFee,
  }

  /** @throws {@link CCTParamsInvalidError} if a getter argument cannot be ABI-encoded */
  protected prepare(params: GetFeeParams): GetFeeParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
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
    { poolAddress, remoteChainSelector, finality }: GetFeeParams,
  ): Promise<GetFeeResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    return resolveEncoder(this.readers, version, this.name)(
      chain,
      poolAddress,
      remoteChainSelector,
      toBeHex(encodeFinality(finality ?? 'finalized'), 4),
    )
  }
}
