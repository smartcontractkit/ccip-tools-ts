/**
 * withdrawFromLockbox — pulls tokens back out of an `ERC20LockBox` (v2.0.0) via `withdraw`.
 *
 * @remarks **Authorized-caller-gated, not owner-gated**, and unlike the pre-2.0.0 pool
 * `withdrawLiquidity` the payout address is explicit: `withdraw` takes a `recipient` rather than
 * paying `msg.sender`, and reverts `RecipientCannotBeZeroAddress` for the zero address. The
 * caller must appear in `getAllAuthorizedCallers()` or it reverts `UnauthorizedCaller(address)`
 * (selector `0xd86ad9cf`); the lockbox owner grants that with `authorizeLockboxCallers`.
 *
 * @remarks `amount` of `type(uint256).max` is a sentinel: the lockbox substitutes its whole
 * balance. Preserved rather than rejected, since draining an escrow without first reading its
 * balance is the one case where a caller cannot name the amount.
 *
 * @remarks The v2.0.0 replacement for `withdrawLiquidity`, which pre-2.0.0 pools declared
 * themselves.
 *
 * @remarks The `ILockBox` signature carries a `uint64 remoteChainSelector` that this lockbox
 * ignores, so the op takes no parameter for it and encodes zero; see
 * {@link IGNORED_CHAIN_SELECTOR}.
 *
 * @packageDocumentation
 */

import { MaxUint256 } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256 } from '../../validate.ts'
import {
  IGNORED_CHAIN_SELECTOR,
  LOCKBOX_INTERFACE,
  assertLockbox,
  assertLockboxCaller,
  assertLockboxLiquidity,
  assertLockboxToken,
} from '../contracts.ts'

/**
 * Parameters for {@link WithdrawFromLockbox}.
 * @remarks There is no `remoteChainSelector`: `ERC20LockBox` v2.0.0 ignores it, so the op
 * always encodes {@link IGNORED_CHAIN_SELECTOR} (zero).
 */
export type WithdrawFromLockboxParams = {
  /** `ERC20LockBox` to withdraw from. Must be non-zero — it is the tx `to`, and a call to `0x0`
   * hits no code, so it would mine as a successful no-op. */
  lockbox: string
  /** Token to withdraw; must be the one the lockbox escrows, or it reverts `UnsupportedToken`. */
  token: string
  /**
   * Amount to withdraw (`uint256`), in the token's smallest unit. `MaxUint256` withdraws the
   * lockbox's entire balance of `token`.
   */
  amount: bigint
  /** Account the tokens are sent to. Must be non-zero — the lockbox rejects the zero address. */
  recipient: string
  /**
   * The withdrawing account, which must be an authorized caller of the lockbox. Sets `tx.from`
   * for offline / multisig signing, and when supplied is checked against the lockbox before any
   * calldata is built. Optional for {@link WithdrawFromLockbox.generate};
   * {@link WithdrawFromLockbox.execute} defaults it to the signing wallet, so the check always
   * runs on a broadcast tx.
   */
  sender?: string
}

/** Withdraws tokens from an `ERC20LockBox` as one of its authorized callers (v2.0.0). */
export class WithdrawFromLockbox extends EVMOperation<WithdrawFromLockboxParams> {
  readonly name = 'withdrawFromLockbox'

  /** Validates every param before any RPC; a zero `amount` reverts `TokenAmountCannotBeZero`. */
  protected override validate({
    lockbox,
    token,
    amount,
    recipient,
  }: WithdrawFromLockboxParams): void {
    validateNonZeroAddress(this.name, 'lockbox', lockbox)
    validateNonZeroAddress(this.name, 'token', token)
    validatePositiveUint256(this.name, 'amount', amount)
    validateNonZeroAddress(this.name, 'recipient', recipient)
  }

  /**
   * Confirms the target is a deployed, supported lockbox escrowing `token`, that it holds enough
   * of it, and — with a known `sender` — that it accepts calls from that account.
   *
   * @remarks The balance check runs without a `sender`, unlike the caller check: what the lockbox
   * holds is a property of the lockbox, so it is worth catching for an offline builder too. It is
   * advisory either way — every CCIP transfer through the pool moves that balance, so this
   * catches "withdraw more than was ever deposited" rather than proving the amount still fits
   * when the tx mines.
   * @remarks Skipped entirely for the `MaxUint256` sentinel, which asks for whatever is there and
   * so cannot be short. A drain of an empty lockbox therefore builds and mines as a zero-value
   * transfer rather than failing here.
   * @throws {@link CCTParamsInvalidError} if nothing at `lockbox` answers `typeAndVersion()`, if
   * the lockbox escrows a different token, or if `sender` is not an authorized caller
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is some other contract, e.g. the pool
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @throws {@link CCTTxFailedError} if the lockbox holds less than `amount`
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { lockbox, token, amount, recipient, sender }: WithdrawFromLockboxParams,
  ): Promise<UnsignedEVMTx> {
    await assertLockbox(this.name, chain, lockbox)
    const erc20 = await assertLockboxToken(this.name, chain, lockbox, token)
    if (sender !== undefined) await assertLockboxCaller(this.name, chain, lockbox, sender)
    if (amount !== MaxUint256)
      await assertLockboxLiquidity(this.name, erc20, lockbox, token, amount)
    const data = LOCKBOX_INTERFACE.encodeFunctionData('withdraw', [
      token,
      IGNORED_CHAIN_SELECTOR,
      amount,
      recipient,
    ])
    return callTx(lockbox, data)
  }
}
