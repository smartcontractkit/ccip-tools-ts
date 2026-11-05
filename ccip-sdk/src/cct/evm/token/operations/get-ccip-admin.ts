/**
 * getCCIPAdmin — reads a token's current `getCCIPAdmin()`, checksummed. The CCIP admin is a
 * single-step authority (no pending slot), and `getCCIPAdmin()` is declared identically across
 * every supported token version, so this needs no version resolution.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readCCIPAdmin } from '../contracts.ts'

/** Parameters for {@link GetCCIPAdmin}. */
export type GetCCIPAdminParams = {
  /** Token contract to read `getCCIPAdmin()` from. */
  tokenAddress: string
}

/** Result of {@link GetCCIPAdmin}: the token's current CCIP admin, checksummed. */
export type GetCCIPAdminResult = string

/**
 * Reads a token's current CCIP admin in one `eth_call`.
 * @remarks Single-step authority: unlike the default admin ({@link GetTokenDefaultAdmin}) there is
 * no pending CCIP admin, so this current value is complete. `getCCIPAdmin()` is the on-chain read
 * the `ccip-admin` registration method authorizes against.
 */
export class GetCCIPAdmin extends EVMQuery<GetCCIPAdminParams, GetCCIPAdminResult> {
  readonly name = 'getCCIPAdmin'

  /**
   * Validates the token address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   */
  protected prepare(params: GetCCIPAdminParams): GetCCIPAdminParams {
    validateNonZeroAddress(this.name, 'tokenAddress', params.tokenAddress)
    return params
  }

  /** Reads and checksums the token's `getCCIPAdmin()`. */
  protected read(
    chain: EVMChain,
    { tokenAddress }: GetCCIPAdminParams,
  ): Promise<GetCCIPAdminResult> {
    return readCCIPAdmin(chain, tokenAddress)
  }
}
