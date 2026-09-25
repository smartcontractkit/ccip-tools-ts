/**
 * mint — mints new supply of a BurnMintERC677 token to an account. A role-gated manual mint, for
 * seeding liquidity or topping up test supply; the bridge path mints through the pool instead.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validateUint256 } from '../../validate.ts'
import { getErc20Token, readTokenRole } from '../contracts.ts'

/** Parameters for {@link Mint}. */
export type MintParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) to mint. */
  tokenAddress: string
  /** Account credited with the newly minted supply. */
  account: string
  /** Amount to mint, in the token's smallest unit (`uint256`). */
  amount: bigint
  /** Address holding the token's mint role; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Mints new supply of a BurnMintERC677 token to an account. Gated on the token's mint role. */
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
   * Confirms `sender` holds the token's mint role before encoding.
   *
   * Gated on `isMinter(sender)`, not `owner()`: `mint` is `onlyMinter`, and the owner is only the
   * role admin, who need not hold the role. The read runs even with no `sender` to compare
   * (against the zero address, answer discarded) because it is also the family check
   * ({@link readTokenRole}) — a `mint` built for an address with no code would otherwise mine
   * successfully and mint nothing. It runs here rather than in {@link execute} so the offline /
   * multisig path is gated too. A mint past a capped token's `maxSupply` is not pre-flighted.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * @throws {@link CCTParamsInvalidError} if `sender` is given and does not hold the mint role
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, account, amount, sender }: MintParams,
  ): Promise<UnsignedEVMTx> {
    const isMinter = await readTokenRole(chain, tokenAddress, 'isMinter', sender ?? ZeroAddress)
    if (sender !== undefined && !isMinter)
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must hold the mint role on ${tokenAddress} — grant it with grantMintRole (or grantMintAndBurnRoles) as the token owner`,
      )

    return callTx(tokenAddress, getErc20Token().encodeFunctionData('mint', [account, amount]))
  }

  /**
   * Signs and submits as a minter, defaulting `sender` to the signing wallet — the only address
   * that can satisfy {@link buildUnsigned}'s role check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
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
