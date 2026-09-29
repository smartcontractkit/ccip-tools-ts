/**
 * mint — mints new supply of a supported CCT token to an account. A role-gated manual mint, for
 * seeding liquidity or topping up test supply; the bridge path mints through the pool instead.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type PreconditionError, CCTContractTypeInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
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

  /** Encodes `mint(account, amount)`. No reads: the one this op makes is a precondition check. */
  protected buildUnsigned(
    _chain: EVMChain,
    { tokenAddress, account, amount }: MintParams,
  ): UnsignedEVMTx {
    return callTx(tokenAddress, getErc20Token().encodeFunctionData('mint', [account, amount]))
  }

  /**
   * Confirms `sender` holds the token's mint role, for a recognized CCT token.
   *
   * Gated on the mint role, not `owner()`: `mint` is role-gated (`onlyMinter` on v1, `MINTER_ROLE`
   * on v2), and the owner is only the role admin, who need not hold the role. The role is resolved
   * version-aware — `isMinter(sender)` on a v1 BurnMintERC677, `hasRole(MINTER_ROLE, sender)` on a
   * v2.0.0 CrossChainToken — via {@link resolveTokenRoleHandler} ({@link resolveToken} picks the
   * version). Reported rather than thrown, so `grantMintRole → mint` can be planned as one batch.
   * A mint past a capped token's `maxSupply` is not pre-flighted.
   *
   * For a token the SDK does not recognize (one that declares neither `isMinter` nor `hasRole`)
   * the check is skipped and the `mint` is built best-effort — the chain enforces the role at
   * broadcast.
   */
  protected override async preconditions(
    chain: EVMChain,
    { tokenAddress, sender }: MintParams,
  ): Promise<PreconditionError[]> {
    const version = await resolveToken(chain, tokenAddress)
    let holdsMintRole: boolean | undefined // undefined = unrecognized token, check skipped
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
    if (sender === undefined || holdsMintRole !== false) return []
    return [
      {
        param: 'sender',
        reason: `must hold the mint role on ${tokenAddress} — grant it with grantMintRole (or grantMintAndBurnRoles) as the token owner`,
      },
    ]
  }

  /**
   * Signs and submits as a minter, defaulting `sender` to the signing wallet — the only address
   * that can satisfy {@link preconditions}' role check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, if
   * the wallet does not hold the mint role, or if any other param is invalid (see
   * {@link buildUnsigned})
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain — e.g. the mint would
   * exceed the token's `maxSupply`, which is not pre-flighted
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<MintParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
