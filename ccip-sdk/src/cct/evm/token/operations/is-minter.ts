/**
 * isMinter — whether one account holds a BurnMintERC677 token's mint role. The check a caller
 * wants before a `mint`; enumerating the whole set is `getMinters`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readTokenRole } from '../contracts.ts'

/** Parameters for {@link IsMinter}. */
export type IsMinterParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) to read. */
  tokenAddress: string
  /** Account to test for the mint role. */
  account: string
}

/** Result of {@link IsMinter}: whether `account` currently holds the token's mint role. */
export type IsMinterResult = boolean

/** Reads whether an account holds a BurnMintERC677 token's mint role, via `isMinter(address)`. */
export class IsMinter extends EVMQuery<IsMinterParams, IsMinterResult> {
  readonly name = 'isMinter'

  /**
   * Validates both addresses; nothing to convert for {@link read}.
   * @remarks `account` is rejected as the zero address: the token can never grant a role to it,
   * so the call could only ever answer `false` — a caller passing it has a bug worth surfacing
   * rather than an answer worth an RPC.
   * @throws {@link CCTParamsInvalidError} if either address is not a valid, non-zero address
   */
  protected prepare(params: IsMinterParams): IsMinterParams {
    validateNonZeroAddress(this.name, 'tokenAddress', params.tokenAddress)
    validateNonZeroAddress(this.name, 'account', params.account)
    return params
  }

  /**
   * Reads the role predicate in a single `eth_call`.
   * @remarks No version resolution: `isMinter(address)` is identical at v1.5.1 and v1.6.2, and a
   * contract that does not declare it is reported by {@link readTokenRole}.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   */
  protected read(chain: EVMChain, { tokenAddress, account }: IsMinterParams): Promise<boolean> {
    return readTokenRole(chain, tokenAddress, 'isMinter', account)
  }
}
