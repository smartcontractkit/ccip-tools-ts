/**
 * revokeMintRole: removes a BurnMintERC677 token's mint role from one account. Owner-gated
 * (`onlyOwner`); the owner is the token's mint/burn role admin.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { TokenVersion, getTokenInterface, resolveToken, resolveTokenEncoder } from '../contracts.ts'
import { CrossChainTokenRole, resolveTokenRoleHandler } from '../roles.ts'

/** Parameters for {@link RevokeMintRole}. */
export type RevokeMintRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account losing the mint role; must currently hold it. */
  minter: string
  /** Role admin; token owner for v1.x, `BURN_MINT_ADMIN_ROLE` holder for v2; sets `tx.from`. */
  sender?: string
}

type Encoder = (iface: Interface, params: RevokeMintRoleParams) => UnsignedEVMTx

const encodeV1: Encoder = (iface, { tokenAddress, minter }) =>
  callTx(tokenAddress, iface.encodeFunctionData('revokeMintRole', [minter]))

const encodeV2: Encoder = (iface, { tokenAddress, minter }) =>
  callTx(tokenAddress, iface.encodeFunctionData('revokeRole', [CrossChainTokenRole.MINTER, minter]))

/** Removes the mint role from an account on a supported CCT token. */
export class RevokeMintRole extends EVMOperation<RevokeMintRoleParams> {
  readonly name = 'revokeMintRole'
  private readonly encoders: Partial<Record<TokenVersion, Encoder>> = {
    [TokenVersion.V1_5_1]: encodeV1,
    [TokenVersion.V2_0_0]: encodeV2,
  }

  /**
   * Validates both addresses before any RPC. Neither may be zero: a tx to `0x0` hits no code, and
   * revoking a role from `0x0` mines as a no-op.
   */
  protected override validate({ tokenAddress, minter }: RevokeMintRoleParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'minter', minter)
  }

  /**
   * Reads the current role state, then — when `sender` is known — confirms it owns the token.
   *
   * The role read runs first because it is also the family check ({@link readTokenRole}), which
   * `owner()` cannot make: a token pool and a v2.0.0 `CrossChainToken` declare `owner()` too. Both
   * checks run here rather than in {@link execute}, so the offline / multisig path gets them, and
   * revoking a role never held is rejected even though the chain would mine it as a silent no-op.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a BurnMintERC677 token
   * @throws {@link CCTParamsInvalidError} if `minter` does not hold the mint role, or `sender`
   * is given and is not the token owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: RevokeMintRoleParams,
  ): Promise<UnsignedEVMTx> {
    const { tokenAddress, minter, sender } = params
    const version = await resolveToken(chain, tokenAddress)
    const roleHandler = resolveTokenRoleHandler(version, this.name)
    if (!(await roleHandler.hasRole(chain, tokenAddress, 'mint', minter)))
      throw new CCTParamsInvalidError(
        this.name,
        'minter',
        `does not hold the mint role on ${tokenAddress}; revoking it changes nothing`,
      )
    if (sender !== undefined)
      await roleHandler.assertAdmin(this.name, chain, tokenAddress, 'mint', sender)

    return resolveTokenEncoder(
      this.encoders,
      version,
      this.name,
    )(getTokenInterface(version), params)
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
    params: EVMExecuteParams<RevokeMintRoleParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
