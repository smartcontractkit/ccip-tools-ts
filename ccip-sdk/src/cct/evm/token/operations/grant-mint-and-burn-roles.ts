/**
 * grantMintAndBurnRoles: grants a BurnMintERC677 token's mint *and* burn roles to one account in
 * a single transaction — the call a token owner makes for a newly deployed pool, which needs both.
 * Owner-gated (`onlyOwner`); the owner is the token's mint/burn role admin.
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

/** Parameters for {@link GrantMintAndBurnRoles}. */
export type GrantMintAndBurnRolesParams = {
  /** BurnMintERC677 token (v1.5.1 / v1.6.2) whose roles are being changed. */
  tokenAddress: string
  /** Account receiving both roles, typically the token's pool; must not already hold both. */
  burnAndMinter: string
  /** Current token owner (the role admin); sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Grants both mint and burn roles on a BurnMintERC677 token via `grantMintAndBurnRoles`. */
export class GrantMintAndBurnRoles extends EVMOperation<GrantMintAndBurnRolesParams> {
  readonly name = 'grantMintAndBurnRoles'

  /**
   * Validates both addresses before any RPC. Neither may be zero: a tx to `0x0` hits no code, and
   * granting roles to `0x0` mines as a no-op nobody can use.
   */
  protected override validate({ tokenAddress, burnAndMinter }: GrantMintAndBurnRolesParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'burnAndMinter', burnAndMinter)
  }

  /**
   * Reads both role states, then — when `sender` is known — confirms it owns the token.
   *
   * @remarks Rejected only when `burnAndMinter` already holds **both** roles: holding just one
   * still builds, since completing the pair is exactly what this call is for.
   * @remarks The role reads come first because they are also the family check: only a
   * BurnMintERC677 token declares `isMinter`/`isBurner`, so a v2.0.0 `CrossChainToken` — which
   * declares `grantMintAndBurnRoles` too, but gates the roles through AccessControl — a token
   * pool, or an EOA fails there rather than producing calldata it cannot honour (see
   * {@link readTokenRole}). `owner()` alone would not catch any of them.
   * @remarks Both checks live here, not only in {@link execute}, so the offline / multisig path
   * gets them too — `generateUnsignedGrantMintAndBurnRoles` with an unauthorized `sender` would
   * otherwise hand back a fully-formed transaction that reverts `OnlyOwner` after being reviewed
   * and signed.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * @throws {@link CCTParamsInvalidError} if `burnAndMinter` already holds both roles, or `sender`
   * is given and is not the token owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, burnAndMinter, sender }: GrantMintAndBurnRolesParams,
  ): Promise<UnsignedEVMTx> {
    const [isMinter, isBurner] = await Promise.all([
      readTokenRole(chain, tokenAddress, 'isMinter', burnAndMinter),
      readTokenRole(chain, tokenAddress, 'isBurner', burnAndMinter),
    ])
    if (isMinter && isBurner)
      throw new CCTParamsInvalidError(
        this.name,
        'burnAndMinter',
        `already holds the mint and burn roles on ${tokenAddress}; granting them again changes nothing`,
      )
    if (sender !== undefined) await assertTokenOwner(this.name, chain, tokenAddress, sender)

    return callTx(
      tokenAddress,
      getErc20Token().encodeFunctionData('grantMintAndBurnRoles', [burnAndMinter]),
    )
  }

  /**
   * Signs and submits as the token owner, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, or
   * if any other param is invalid (see {@link buildUnsigned})
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<GrantMintAndBurnRolesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
