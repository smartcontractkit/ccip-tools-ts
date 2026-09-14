/**
 * isBurner — whether one account holds a BurnMintERC677 token's burn role. The check a caller
 * wants before a burn; enumerating the whole set is `getBurners`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readTokenRole } from '../contracts.ts'

/** Parameters for {@link IsBurner}. */
export type IsBurnerParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) to read. */
  tokenAddress: string
  /** Account to test for the burn role. */
  account: string
}

/** Result of {@link IsBurner}: whether `account` currently holds the token's burn role. */
export type IsBurnerResult = boolean

/** Reads whether an account holds a BurnMintERC677 token's burn role, via `isBurner(address)`. */
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
   * Reads the role predicate in a single `eth_call`.
   * @remarks No version resolution: `isBurner(address)` is identical at v1.5.1 and v1.6.2, and a
   * contract that does not declare it is reported by {@link readTokenRole}.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   */
  protected read(chain: EVMChain, { tokenAddress, account }: IsBurnerParams): Promise<boolean> {
    return readTokenRole(chain, tokenAddress, 'isBurner', account)
  }
}
