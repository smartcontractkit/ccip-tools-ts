/**
 * getMinters — lists every account holding a BurnMintERC677 token's mint role. Informational
 * (audit / UX): a *check* of one address is `isMinter`, not a scan of this set.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readTokenRoleHolders } from '../contracts.ts'

/** Parameters for {@link GetMinters}. */
export type GetMintersParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) to read. */
  tokenAddress: string
}

/** Result of {@link GetMinters}: the mint-role holders, checksummed, in the token's own order. */
export type GetMintersResult = string[]

/** Lists the accounts holding a BurnMintERC677 token's mint role, via `getMinters()`. */
export class GetMinters extends EVMQuery<GetMintersParams, GetMintersResult> {
  readonly name = 'getMinters'

  /**
   * Validates the token address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   */
  protected prepare(params: GetMintersParams): GetMintersParams {
    validateNonZeroAddress(this.name, 'tokenAddress', params.tokenAddress)
    return params
  }

  /**
   * Enumerates the role set in a single `eth_call`.
   * @remarks No version resolution: `getMinters()` is identical at v1.5.1 and v1.6.2, and a
   * contract that does not declare it is reported by {@link readTokenRoleHolders}.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   */
  protected read(chain: EVMChain, { tokenAddress }: GetMintersParams): Promise<string[]> {
    return readTokenRoleHolders(chain, tokenAddress, 'getMinters')
  }
}
