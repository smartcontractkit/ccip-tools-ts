/**
 * approveToken — grants an ERC-20 allowance, the prerequisite for a pool liquidity deposit.
 *
 * @remarks The counterpart of Solana's `approveToken` (`cct/solana/token/operations/approve-token.ts`),
 * which delegates spend authority on an SPL token account. `provideLiquidity` deposits with
 * `safeTransferFrom`, so without an allowance to the pool it reverts
 * `ERC20InsufficientAllowance`; this is how a rebalancer grants it.
 *
 * @remarks No version resolution and no chain read: `approve(address,uint256)` is ERC-20, declared
 * identically by `FactoryBurnMintERC20` v1.5.1 / v1.6.2 and by v2.0.0's `CrossChainToken`. Nor is
 * `tokenAddress` gated to a CCT token — a LockRelease pool can escrow an arbitrary ERC-20, and that
 * is precisely the token an operator needs to approve.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validateUint256 } from '../../validate.ts'
import { TokenVersion, getTokenInterface } from '../contracts.ts'

/** Parameters for {@link ApproveToken}. */
export type ApproveTokenParams = {
  /** ERC-20 token to approve on — any ERC-20, not only a CCT-deployed one. Must be non-zero: it
   * is the tx `to`, and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  tokenAddress: string
  /**
   * Address allowed to spend. For a liquidity deposit this is the **token pool**.
   * @remarks Must be non-zero — OpenZeppelin's ERC-20 reverts `ERC20InvalidSpender` on a zero
   * spender, so unlike a role-clearing address this one can never be meaningful.
   */
  spender: string
  /**
   * Allowance in the token's smallest unit. **Replaces** the current allowance rather than adding
   * to it, and `0n` is allowed and revokes it.
   * @remarks An allowance is consumed as it is spent, so a deposit of exactly `amount` leaves
   * nothing for the next one. Approving the amount you intend to deposit each time is the tighter
   * choice; approving `2n ** 256n - 1n` once is the convenient one.
   */
  amount: bigint
  /**
   * The account whose tokens are being approved. Sets `tx.from` for offline / multisig signing.
   * Optional for {@link ApproveToken.generate}; {@link ApproveToken.execute} defaults it to the
   * signing wallet, since that is the account the allowance actually comes from.
   */
  sender?: string
}

/** Grants an ERC-20 allowance — e.g. a rebalancer approving a LockRelease pool before a deposit. */
export class ApproveToken extends EVMOperation<ApproveTokenParams> {
  readonly name = 'approveToken'

  /** Validates both addresses and the amount before any RPC; a zero `amount` revokes. */
  protected override validate({ tokenAddress, spender, amount }: ApproveTokenParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'spender', spender)
    validateUint256(this.name, 'amount', amount)
  }

  /**
   * Encodes `approve` with no chain access at all — there is no version to resolve and nothing
   * about the caller's balance to check, since an ERC-20 allows approving more than is held.
   */
  protected buildUnsigned(
    _chain: EVMChain,
    { tokenAddress, spender, amount }: ApproveTokenParams,
  ): UnsignedEVMTx {
    const iface = getTokenInterface(TokenVersion.V1_5_1)
    return callTx(tokenAddress, iface.encodeFunctionData('approve', [spender, amount]))
  }

  /**
   * Signs and submits, defaulting `sender` to the signing wallet.
   * @remarks The allowance is granted from `msg.sender`'s balance, so a `sender` that differs from
   * the wallet would approve a *different* account's tokens than the one reviewed — rejected here
   * rather than signed. See {@link EVMOperation.resolveWalletSender}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<ApproveTokenParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
