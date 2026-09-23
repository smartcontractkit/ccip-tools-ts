/**
 * isBurner — whether one account holds a BurnMintERC677 token's burn role. The check a caller
 * wants before a burn; enumerating the whole set is `getBurners`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { resolveToken } from '../contracts.ts'
import { resolveTokenRoleHandler } from '../roles.ts'

/** Parameters for {@link IsBurner}. */
export type IsBurnerParams = {
  /** Supported CCT token whose burn role is read. */
  tokenAddress: string
  /** Account to test for the burn role. */
  account: string
}

/** Result of {@link IsBurner}: whether `account` currently holds the token's burn role. */
export type IsBurnerResult = boolean

/** Reads whether an account holds a supported CCT token's burn role. */
export class IsBurner extends EVMQuery<IsBurnerParams, IsBurnerResult> {
  readonly name = 'isBurner'

  /**
   * Validates both addresses; nothing to convert for {@link read}.
   * @remarks `account` is rejected as the zero address for the same reason as in
   * {@link IsMinter.prepare}: the call could only ever answer `false`.
   * @throws {@link CCTParamsInvalidError} if either address is not a valid, non-zero address
   */
  protected prepare(params: IsBurnerParams): IsBurnerParams {
    validateNonZeroAddress(this.name, 'tokenAddress', params.tokenAddress)
    validateNonZeroAddress(this.name, 'account', params.account)
    return params
  }

  /**
   * Reads the role predicate using v1 `isBurner(address)` or v2 AccessControl `hasRole`.
   */
  protected async read(
    chain: EVMChain,
    { tokenAddress, account }: IsBurnerParams,
  ): Promise<boolean> {
    const version = await resolveToken(chain, tokenAddress)
    return resolveTokenRoleHandler(version, this.name).hasRole(chain, tokenAddress, 'burn', account)
  }
}
