/**
 * getTokenOwner — reads a token's current `owner()` (Ownable2Step), checksummed. Every supported
 * token version declares `owner()` identically, so this needs no version resolution.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readTokenOwner } from '../contracts.ts'

/** Parameters for {@link GetTokenOwner}. */
export type GetTokenOwnerParams = {
  /** Token contract (v1.5.1 / v1.6.2 / v2.0.0) to read `owner()` from. */
  tokenAddress: string
}

/** Result of {@link GetTokenOwner}: the token's current owner, checksummed. */
export type GetTokenOwnerResult = string

/**
 * Reads a token's current `owner()` in one `eth_call`.
 * @remarks Current owner only. A token's *proposed* owner (Ownable2Step's `s_pendingOwner`) is a
 * `private` slot with no getter, so it cannot be read on EVM — mirror of the pool limitation noted
 * on `generateUnsignedAcceptPoolOwnership`. On v2.0.0's `CrossChainToken`, `owner()` aliases the
 * `DEFAULT_ADMIN_ROLE` holder; use {@link GetTokenDefaultAdmin} for its pending transfer.
 */
export class GetTokenOwner extends EVMQuery<GetTokenOwnerParams, GetTokenOwnerResult> {
  readonly name = 'getTokenOwner'

  /**
   * Validates the token address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   */
  protected prepare(params: GetTokenOwnerParams): GetTokenOwnerParams {
    validateNonZeroAddress(this.name, 'tokenAddress', params.tokenAddress)
    return params
  }

  /** Reads and checksums the token's `owner()`. */
  protected read(
    chain: EVMChain,
    { tokenAddress }: GetTokenOwnerParams,
  ): Promise<GetTokenOwnerResult> {
    return readTokenOwner(chain, tokenAddress)
  }
}
