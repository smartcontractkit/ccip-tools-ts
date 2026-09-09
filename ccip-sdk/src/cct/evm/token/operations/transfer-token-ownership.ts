/**
 * transferTokenOwnership — proposes a new owner for a v1.x `FactoryBurnMintERC20` (step 1 of
 * Ownable2Step; the proposed owner completes it with {@link AcceptTokenOwnership}).
 *
 * @remarks The token counterpart of {@link TransferPoolOwnership}. A CCT deployment has two
 * independent owners — the token's, which controls mint/burn roles, and the pool's, which controls
 * lane config — and moving one leaves the other exactly where it was.
 *
 * @remarks **v1.x only, by contract rather than by check.** v2.0.0's `CrossChainToken` has no
 * `transferOwnership` at all; ownership there is `AccessControlDefaultAdminRules`, moved with
 * `beginDefaultAdminTransfer` / `acceptDefaultAdminTransfer` on a mandatory delay. Nothing here
 * detects one: `owner()` exists on v2.0.0 too, aliasing the default admin, so the pre-flight
 * passes and the tx reverts once broadcast. Deliberate — the only signal separating the two is
 * `typeAndVersion()`, which v1.5.1 predates, so reading it would mean treating every revert as
 * v1.5.1 and guessing.
 *
 * @remarks Nothing changes on-chain until the proposed owner accepts.
 *
 * @packageDocumentation
 */

import { getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import { TokenVersion, assertTokenOwner, getTokenInterface } from '../contracts.ts'

/** Parameters for {@link TransferTokenOwnership}. */
export type TransferTokenOwnershipParams = {
  /** Token whose ownership is being proposed away. Must be non-zero — it is the tx `to`, and a
   * call to `0x0` hits no code, so it would mine as a successful no-op. */
  tokenAddress: string
  /**
   * Address to propose as the next owner. It gains nothing until it calls `acceptOwnership`.
   *
   * @remarks The zero address is **allowed** and meaningful: it parks the pending owner on an
   * address nobody can sign as, retracting a mistaken proposal. The one address the contract
   * rejects is the caller's own (`Cannot transfer to self`), checked below when `sender` is known.
   */
  newOwner: string
  /**
   * The current token owner. Sets `tx.from` for offline / multisig signing, and when supplied is
   * checked against the token's on-chain `owner()` before any calldata is built. Optional for
   * {@link TransferTokenOwnership.generate}; {@link TransferTokenOwnership.execute} defaults it to
   * the signing wallet, so the owner check always runs on a broadcast tx.
   */
  sender?: string
}

/** Proposes a new v1.x token owner via Ownable2Step `transferOwnership`. Owner-only. */
export class TransferTokenOwnership extends EVMOperation<TransferTokenOwnershipParams> {
  readonly name = 'transferTokenOwnership'

  /**
   * Validates both addresses and, when `sender` is known, rejects a self-transfer — the single
   * bound the contract puts on `newOwner`, and free to catch here.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is zero or malformed, `newOwner` is
   * malformed, or `newOwner` equals `sender`
   */
  protected override validate({
    tokenAddress,
    newOwner,
    sender,
  }: TransferTokenOwnershipParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateAddress(this.name, 'newOwner', newOwner)
    if (sender === undefined) return
    // `generate` validates `sender` only after this hook, so the comparison below would otherwise
    // run on an unvalidated string and leak a raw ethers error for a malformed one.
    validateAddress(this.name, 'sender', sender)
    if (getAddress(newOwner) === getAddress(sender))
      throw new CCTParamsInvalidError(
        this.name,
        'newOwner',
        `must differ from sender (${sender}) — the token already has that owner and would revert CannotTransferToSelf`,
      )
  }

  /**
   * Encodes `transferOwnership`, then confirms `sender` (when given) is the token owner.
   * @remarks No version resolution at all: `transferOwnership(address)` is declared identically by
   * v1.5.1 and v1.6.2, so the v1.5.1 interface encodes for both — the same reason `approveToken`
   * builds off a single interface.
   * @remarks The owner check lives here, not only in {@link execute}, so the offline / multisig
   * path gets it too: `generateUnsignedTransferTokenOwnership` with an unauthorized `sender` would
   * otherwise hand back a fully-formed transaction that reverts only after being reviewed and
   * signed.
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the token owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newOwner, sender }: TransferTokenOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    const iface = getTokenInterface(TokenVersion.V1_5_1)
    const unsigned = callTx(tokenAddress, iface.encodeFunctionData('transferOwnership', [newOwner]))
    if (sender !== undefined) await assertTokenOwner(this.name, chain, tokenAddress, sender)
    return unsigned
  }

  /**
   * Signs and submits as the current token owner, defaulting `sender` to the signing wallet — the
   * only address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather than
   * signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, or
   * is not the token owner, or equals `newOwner`
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<TransferTokenOwnershipParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
