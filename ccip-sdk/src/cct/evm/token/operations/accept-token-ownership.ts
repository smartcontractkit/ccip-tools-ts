/**
 * acceptTokenOwnership — completes a pending v1.x `FactoryBurnMintERC20` ownership transfer
 * (step 2 of Ownable2Step; {@link TransferTokenOwnership} is step 1).
 *
 * @remarks Called by the **proposed** owner, so it pre-flights nothing about the caller: the
 * contract compares `msg.sender` against a `private` pending-owner slot with no getter, in both
 * `ConfirmedOwnerWithProposal` (v1.5.1) and `Ownable2Step` (v1.6.2). A caller who is not the
 * proposed owner simply reverts. The token counterpart of {@link AcceptPoolOwnership}.
 *
 * @remarks **v1.x only, by contract rather than by check**, per {@link TransferTokenOwnership}:
 * v2.0.0's `CrossChainToken` has no `acceptOwnership`, using `acceptDefaultAdminTransfer` instead,
 * and nothing here detects one before the tx is broadcast.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { TokenVersion, getTokenInterface } from '../contracts.ts'

/** Parameters for {@link AcceptTokenOwnership}. */
export type AcceptTokenOwnershipParams = {
  /** Token whose pending ownership transfer is being completed. Must be non-zero — it is the tx
   * `to`, and a call to `0x0` hits no code, so it would mine as a successful no-op. */
  tokenAddress: string
  /** The proposed owner. Sets `tx.from` for offline / multisig signing, and is not checked
   * against the chain, per the module remark. {@link AcceptTokenOwnership.execute} defaults it to
   * the signing wallet. */
  sender?: string
}

/** Completes a pending v1.x token ownership transfer via Ownable2Step `acceptOwnership`. */
export class AcceptTokenOwnership extends EVMOperation<AcceptTokenOwnershipParams> {
  readonly name = 'acceptTokenOwnership'

  /** Validates the token address before any RPC; there is no other parameter to check. */
  protected override validate({ tokenAddress }: AcceptTokenOwnershipParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
  }

  /**
   * Encodes `acceptOwnership` with no chain access at all.
   * @remarks Nothing to resolve and nothing to read: `acceptOwnership()` is one fixed selector,
   * declared identically by v1.5.1 and v1.6.2, and the only account the contract accepts is the
   * `private` pending owner — so, like `approveToken`, it builds without touching the chain.
   */
  protected buildUnsigned(
    _chain: EVMChain,
    { tokenAddress }: AcceptTokenOwnershipParams,
  ): UnsignedEVMTx {
    const iface = getTokenInterface(TokenVersion.V1_5_1)
    return callTx(tokenAddress, iface.encodeFunctionData('acceptOwnership', []))
  }

  /**
   * Signs and submits as the proposed owner, defaulting `sender` to the signing wallet.
   * @remarks The contract authorizes on `msg.sender`, so the wallet *is* the address that must be
   * the proposed owner; see {@link EVMOperation.resolveWalletSender}.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain — notably when the wallet is
   * not the token's proposed owner, which cannot be checked before signing
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<AcceptTokenOwnershipParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
