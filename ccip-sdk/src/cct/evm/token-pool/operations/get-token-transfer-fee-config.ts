/**
 * getTokenTransferFeeConfig — reads a v2.0.0 pool's token-transfer fee configuration for a
 * destination chain.
 *
 * @packageDocumentation
 */

import { isHexString, toBeHex } from 'ethers'

import type { TokenTransferFeeConfig } from '../../../../chain.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { type FinalityRequested, encodeFinality } from '../../../../extra-args.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateUint64 } from '../../validate.ts'
import {
  TokenPoolVersion,
  readTokenPoolTokenTransferFeeConfig,
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

/** Token-transfer fee configuration returned by a v2.0.0 pool. */
export type GetTokenTransferFeeConfigResult = TokenTransferFeeConfig

/** Reads a v2.0.0 pool's token-transfer fee configuration for one destination chain. */
export class GetTokenTransferFeeConfig extends EVMQuery<
  GetTokenTransferFeeConfigParams,
  GetTokenTransferFeeConfigResult
> {
  readonly name = 'getTokenTransferFeeConfig'

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
   * Resolves the pool version before the read, so a pool without the getter reports an unsupported
   * operation rather than a bare call failure.
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
    if (version !== TokenPoolVersion.V2_0_0)
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolTokenTransferFeeConfig(
      chain,
      poolAddress,
      remoteChainSelector,
      toBeHex(encodeFinality(finality ?? 'finalized'), 4),
      tokenArgs ?? '0x',
    )
  }
}
