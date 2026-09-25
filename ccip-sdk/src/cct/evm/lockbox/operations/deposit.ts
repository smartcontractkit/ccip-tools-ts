/**
 * depositToLockbox — funds an `ERC20LockBox` (v2.0.0) via `deposit`, the step that makes a v2.0.0
 * LockRelease pool able to release at all.
 *
 * @remarks **Authorized-caller-gated, not owner-gated, and the depositor is the one gated.**
 * `ERC20LockBox._validateDepositWithdraw` ends in `AuthorizedCallers._validateCaller`, so the
 * depositing account must itself appear in `getAllAuthorizedCallers()` — authorizing the pool is
 * not enough. Until it does, the deposit reverts `UnauthorizedCaller(address)` (selector
 * `0xd86ad9cf`); the lockbox owner cures that with `authorizeLockboxCallers`.
 *
 * @remarks The deposit is a `safeTransferFrom` on the depositor, so the tokens must be **approved
 * to the lockbox** — not to the pool, which is the v1.5.x habit — see
 * `token/operations/approve-token.ts`. Pre-flighted here rather than left to revert
 * `ERC20InsufficientAllowance` in the wallet, matching `provideLiquidity`.
 *
 * @remarks The v2.0.0 replacement for `provideLiquidity`, which pre-2.0.0 pools declared
 * themselves. Full sequence: `deployToken` → `deployLockbox` → `deployTokenPool` →
 * `authorizeLockboxCallers` → `setPool` → configure lanes → this.
 *
 * @remarks The `ILockBox` signature carries a `uint64 remoteChainSelector` that this lockbox
 * ignores, so the op takes no parameter for it and encodes zero; see
 * {@link IGNORED_CHAIN_SELECTOR}.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress, validatePositiveUint256 } from '../../validate.ts'
import {
  IGNORED_CHAIN_SELECTOR,
  LOCKBOX_INTERFACE,
  assertLockbox,
  assertLockboxCaller,
  assertLockboxFunding,
  assertLockboxToken,
} from '../contracts.ts'

/**
 * Parameters for {@link DepositToLockbox}.
 * @remarks There is no `remoteChainSelector`: `ERC20LockBox` v2.0.0 ignores it, so the op
 * always encodes {@link IGNORED_CHAIN_SELECTOR} (zero).
 */
export type DepositToLockboxParams = {
  /** `ERC20LockBox` to deposit into. Must be non-zero — it is the tx `to`, and a call to `0x0`
   * hits no code, so it would mine as a successful no-op. */
  lockbox: string
  /** Token to deposit; must be the one the lockbox escrows, or it reverts `UnsupportedToken`. */
  token: string
  /** Amount to deposit (`uint256`), in the token's smallest unit. */
  amount: bigint
  /**
   * The depositing account, which must be an authorized caller of the lockbox and must have
   * approved it for `amount`. Sets `tx.from` for offline / multisig signing, and when supplied is
   * checked against the lockbox before any calldata is built. Optional for
   * {@link DepositToLockbox.generate} (an offline builder may not yet know the signer);
   * {@link DepositToLockbox.execute} defaults it to the signing wallet, so the checks always run
   * on a broadcast tx.
   */
  sender?: string
}

/** Deposits tokens into an `ERC20LockBox` as one of its authorized callers (v2.0.0). */
export class DepositToLockbox extends EVMOperation<DepositToLockboxParams> {
  readonly name = 'depositToLockbox'

  /** Validates every param before any RPC; a zero `amount` reverts `TokenAmountCannotBeZero`. */
  protected override validate({ lockbox, token, amount }: DepositToLockboxParams): void {
    validateNonZeroAddress(this.name, 'lockbox', lockbox)
    validateNonZeroAddress(this.name, 'token', token)
    validatePositiveUint256(this.name, 'amount', amount)
  }

  /**
   * Confirms the target is a deployed, supported lockbox and that it escrows `token`, then — with
   * a known `sender` — that it accepts calls from that account and that the account can actually
   * fund the transfer.
   *
   * @remarks Ordered cheapest-to-narrowest, and property-of-the-lockbox before
   * property-of-the-caller: an unusable lockbox or a token mismatch fails for every possible
   * sender, so no choice of signer helps and there is no point reading the caller set first.
   * @remarks The checks live here, not in {@link execute}, so the offline / multisig path gets
   * them too rather than being handed a transaction that reverts once signed. The caller and
   * funding checks need a depositor, so they run only with a `sender`.
   * @throws {@link CCTParamsInvalidError} if nothing at `lockbox` answers `typeAndVersion()`, if
   * the lockbox escrows a different token, or if `sender` is not an authorized caller
   * @throws {@link CCTContractTypeInvalidError} if `lockbox` is some other contract, e.g. the pool
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @throws {@link CCTTxFailedError} if `sender` holds, or has approved the lockbox for, less
   * than `amount`
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { lockbox, token, amount, sender }: DepositToLockboxParams,
  ): Promise<UnsignedEVMTx> {
    await assertLockbox(this.name, chain, lockbox)
    const erc20 = await assertLockboxToken(this.name, chain, lockbox, token)
    if (sender !== undefined) {
      await assertLockboxCaller(this.name, chain, lockbox, sender)
      await assertLockboxFunding(this.name, erc20, lockbox, token, sender, amount)
    }
    const data = LOCKBOX_INTERFACE.encodeFunctionData('deposit', [
      token,
      IGNORED_CHAIN_SELECTOR,
      amount,
    ])
    return callTx(lockbox, data)
  }
}
