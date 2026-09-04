/**
 * grantMintRole: grants a BurnMintERC677 token's mint role to one account. Owner-gated
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

/** Parameters for {@link GrantMintRole}. */
export type GrantMintRoleParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) whose roles are being changed. */
  tokenAddress: string
  /** Account receiving the mint role; must not already hold it. */
  minter: string
  /** Current token owner (the role admin); sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Grants the mint role on a BurnMintERC677 token via `grantMintRole`. */
export class GrantMintRole extends EVMOperation<GrantMintRoleParams> {
  readonly name = 'grantMintRole'

  /**
   * Validates both addresses before any RPC. Neither may be zero: a tx to `0x0` hits no code, and
   * granting a role to `0x0` mines as a no-op nobody can use.
   */
  protected override validate({ tokenAddress, minter }: GrantMintRoleParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'minter', minter)
  }

  /**
   * Reads the current role state, then — when `sender` is known — confirms it owns the token.
   *
   * @remarks The role read comes first because it is also the family check: only a
   * BurnMintERC677 token declares `isMinter`, so a v2.0.0 `CrossChainToken`, a token pool, or an
   * EOA fails there rather than one step later (see {@link readTokenRole}). `owner()` alone
   * would not catch any of them, since all three declare it.
   * @remarks Both checks live here, not only in {@link execute}, so the offline / multisig path
   * gets them too — `generateUnsignedGrantMintRole` with an unauthorized `sender` would otherwise hand
   * back a fully-formed transaction that reverts `OnlyOwner` after being reviewed and signed.
   * @remarks Rejecting a redundant grant is deliberately stricter than the chain: the role set is
   * an `EnumerableSet`, so granting twice is a silent on-chain no-op, not a revert. Surfacing
   * it here stops a multisig from spending a review cycle on a transaction that changes
   * nothing.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * @throws {@link CCTParamsInvalidError} if `minter` already holds the mint role, or `sender` is given and is
   * not the token owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, minter, sender }: GrantMintRoleParams,
  ): Promise<UnsignedEVMTx> {
    if (await readTokenRole(chain, tokenAddress, 'isMinter', minter))
      throw new CCTParamsInvalidError(
        this.name,
        'minter',
        `already holds the mint role on ${tokenAddress}; granting it again changes nothing`,
      )
    if (sender !== undefined) await assertTokenOwner(this.name, chain, tokenAddress, sender)

    return callTx(tokenAddress, getErc20Token().encodeFunctionData('grantMintRole', [minter]))
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
    params: EVMExecuteParams<GrantMintRoleParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
