/**
 * mint — mints new supply of a supported CCT token to an account. A role-gated manual mint, for
 * seeding liquidity or topping up test supply; the bridge path mints through the pool instead.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validateUint256 } from '../../validate.ts'
import { getErc20Token, resolveToken } from '../contracts.ts'
import { resolveTokenRoleHandler } from '../roles.ts'

/** Parameters for {@link Mint}. */
export type MintParams = {
  /**
   * Token to mint. A recognized CCT token (BurnMintERC677 v1.5.1 / v1.6.2, or CrossChainToken
   * v2.0.0) gets a mint-role pre-flight; any other token exposing `mint(address,uint256)` is
   * minted best-effort, letting the chain enforce the role at broadcast.
   */
  tokenAddress: string
  /** Account credited with the newly minted supply. */
  account: string
  /** Amount to mint, in the token's smallest unit (`uint256`). */
  amount: bigint
  /** Address holding the token's mint role; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Mints new supply of a token to an account. Gated on the mint role for recognized CCT tokens. */
export class Mint extends EVMOperation<MintParams> {
  readonly name = 'mint'

  /**
   * Validates the token, recipient and amount before any RPC.
   * @remarks `account` is rejected as the zero address, which the token's own `_mint` reverts on
   * (`ERC20: mint to the zero address`). A zero `amount` is *not* rejected: it mines successfully
   * as a `Transfer` of nothing, and accepting it keeps this op's contract the token's own.
   * @throws {@link CCTParamsInvalidError} if any param is invalid
   */
  protected override validate({ tokenAddress, account, amount }: MintParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'account', account)
    validateUint256(this.name, 'amount', amount)
  }

  /**
   * Confirms `sender` holds the token's mint role before encoding, for a recognized CCT token.
   *
   * Gated on the mint role, not `owner()`: `mint` is role-gated (`onlyMinter` on v1, `MINTER_ROLE`
   * on v2), and the owner is only the role admin, who need not hold the role. The role is resolved
   * version-aware — `isMinter(sender)` on a v1 BurnMintERC677, `hasRole(MINTER_ROLE, sender)` on a
   * v2.0.0 CrossChainToken — via {@link resolveTokenRoleHandler} ({@link resolveToken} picks the
   * version). It runs here rather than in {@link execute} so the offline / multisig path is gated
   * too. A mint past a capped token's `maxSupply` is not pre-flighted.
   *
   * For a token the SDK does not recognize (one that declares neither `isMinter` nor `hasRole`)
   * the pre-flight is skipped and the `mint` is built best-effort — the chain enforces the role at
   * broadcast.
   * @throws {@link CCTParamsInvalidError} if `sender` is given and does not hold the mint role of a
   * recognized CCT token
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, account, amount, sender }: MintParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveToken(chain, tokenAddress)
    let holdsMintRole: boolean | undefined // undefined = unrecognized token, pre-flight skipped
    try {
      holdsMintRole = await resolveTokenRoleHandler(version, this.name).hasRole(
        chain,
        tokenAddress,
        'mint',
        sender ?? ZeroAddress,
      )
    } catch (err) {
      // A token that declares no recognized mint-role reader: fall back to a best-effort mint
      // rather than refusing. Other errors (RPC, a real v2 read failure) still propagate.
      if (!(err instanceof CCTContractTypeInvalidError)) throw err
    }
    if (sender !== undefined && holdsMintRole === false)
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must hold the mint role on ${tokenAddress} — grant it with grantMintRole (or grantMintAndBurnRoles) as the token owner`,
      )

    return callTx(tokenAddress, getErc20Token().encodeFunctionData('mint', [account, amount]))
  }
}
