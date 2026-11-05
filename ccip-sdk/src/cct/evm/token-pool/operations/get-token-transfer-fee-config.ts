/**
 * getTokenTransferFeeConfig — reads a v2.0.0+ pool's token-transfer fee configuration for a
 * destination chain.
 *
 * @packageDocumentation
 */

import { isHexString, toBeHex } from 'ethers'

import type { TokenTransferFeeConfig } from '../../../../chain.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { type FinalityRequested, encodeFinality } from '../../../../extra-args.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  readTokenPoolTokenTransferFeeConfig,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/**
 * Parameters for {@link GetTokenTransferFeeConfig}.
 *
 * @remarks The pool's token is read automatically, so callers only need the pool and transfer
 * settings.
 */
export type GetTokenTransferFeeConfigParams = {
  /** Token pool to read. */
  poolAddress: string
  /** Destination CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
  /** Requested finality mode; defaults to `'finalized'`. */
  finality?: FinalityRequested
  /** Hex-encoded token-pool-specific arguments; defaults to empty bytes (`'0x'`). */
  tokenArgs?: string
}

/** Token-transfer fee configuration returned by a v2.0.0+ pool. */
export type GetTokenTransferFeeConfigResult = TokenTransferFeeConfig

/** Reads a v2.0.0+ pool's token-transfer fee configuration for one destination chain. */
export class GetTokenTransferFeeConfig extends EVMQuery<
  GetTokenTransferFeeConfigParams,
  GetTokenTransferFeeConfigResult
> {
  readonly name = 'getTokenTransferFeeConfig'

  /** The v2.0.0 getter is inherited until a later pool ABI changes its result shape. */
  private readonly readers: Partial<
    Record<TokenPoolVersion, typeof readTokenPoolTokenTransferFeeConfig>
  > = { [TokenPoolVersion.V2_0_0]: readTokenPoolTokenTransferFeeConfig }

  /** @throws {@link CCTParamsInvalidError} if a getter argument cannot be ABI-encoded */
  protected prepare(params: GetTokenTransferFeeConfigParams): GetTokenTransferFeeConfigParams {
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
    if (params.tokenArgs !== undefined && !isHexString(params.tokenArgs, true))
      throw new CCTParamsInvalidError(this.name, 'tokenArgs', 'must be a hex string')
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
    { poolAddress, remoteChainSelector, finality, tokenArgs }: GetTokenTransferFeeConfigParams,
  ): Promise<GetTokenTransferFeeConfigResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    return resolveEncoder(this.readers, version, this.name)(
      chain,
      poolAddress,
      remoteChainSelector,
      toBeHex(encodeFinality(finality ?? 'finalized'), 4),
      tokenArgs ?? '0x',
    )
  }
}
