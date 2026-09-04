/**
 * revokeBurnRole: removes a BurnMintERC677 token's burn role from one account. Owner-gated
 * (`onlyOwner`); the owner is the token's mint/burn role admin.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { assertTokenOwner, getErc20Token, readTokenRole } from '../contracts.ts'

/** Parameters for {@link RevokeBurnRole}. */
export type RevokeBurnRoleParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) whose roles are being changed. */
  tokenAddress: string
  /** Account losing the burn role; must currently hold it. */
  burner: string
  /** Current token owner (the role admin); sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Removes the burn role from an account on a BurnMintERC677 token via `revokeBurnRole`. */
export class RevokeBurnRole extends EVMOperation<RevokeBurnRoleParams> {
  readonly name = 'revokeBurnRole'

  /**
   * Validates both addresses before any RPC. Neither may be zero: a tx to `0x0` hits no code, and
   * revoking a role from `0x0` mines as a no-op.
   */
  protected override validate({ tokenAddress, burner }: RevokeBurnRoleParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'burner', burner)
  }

  /**
   * Reads the current role state, then — when `sender` is known — confirms it owns the token.
   *
   * @remarks The role read comes first because it is also the family check: only a
   * BurnMintERC677 token declares `isBurner`, so a v2.0.0 `CrossChainToken`, a token pool, or an
   * EOA fails there rather than one step later (see {@link readTokenRole}). `owner()` alone
   * would not catch any of them, since all three declare it.
   * @remarks Both checks live here, not only in {@link execute}, so the offline / multisig path
   * gets them too — `generateUnsignedRevokeBurnRole` with an unauthorized `sender` would otherwise hand
   * back a fully-formed transaction that reverts `OnlyOwner` after being reviewed and signed.
   * @remarks Rejecting a revoke of a role never held is deliberately stricter than the chain: the
   * role set is an `EnumerableSet`, so removing an absent member is a silent on-chain no-op,
   * not a revert. Surfacing it here is what tells you the address (or the token) was not the
   * one you meant, instead of a mined transaction that changed nothing.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * @throws {@link CCTParamsInvalidError} if `burner` does not currently hold the burn role, or `sender` is given and is
   * not the token owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, burner, sender }: RevokeBurnRoleParams,
  ): Promise<UnsignedEVMTx> {
    if (!(await readTokenRole(chain, tokenAddress, 'isBurner', burner)))
      throw new CCTParamsInvalidError(
        this.name,
        'burner',
        `does not hold the burn role on ${tokenAddress}; revoking it changes nothing`,
      )
    if (sender !== undefined) await assertTokenOwner(this.name, chain, tokenAddress, sender)

    return callTx(tokenAddress, getErc20Token().encodeFunctionData('revokeBurnRole', [burner]))
  }

  /**
   * Signs and submits as the token owner, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * or if any other param is invalid (see {@link buildUnsigned})
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<RevokeBurnRoleParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
