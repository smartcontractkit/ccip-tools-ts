/**
 * revokeMintRole: removes a supported CCT token's mint role from one account.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { TokenVersion, getTokenInterface, resolveToken, resolveTokenEncoder } from '../contracts.ts'
import { CrossChainTokenRole, resolveTokenRoleHandler } from '../roles.ts'

/** Parameters for {@link RevokeMintRole}. */
export type RevokeMintRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account losing the mint role; must currently hold it. */
  minter: string
  /** Role admin; v1 token owner or v2 role-admin holder (normally `BURN_MINT_ADMIN_ROLE`); sets `tx.from`. */
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
   * The role read runs first because it is also the family check ({@link resolveTokenRoleHandler}), which
   * `owner()` cannot make: a token pool and a v2.0.0 `CrossChainToken` declare `owner()` too. Both
   * checks run here rather than in {@link execute}, so the offline / multisig path gets them, and
   * revoking a role never held is rejected even though the chain would mine it as a silent no-op.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677 token
   * nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   * @throws {@link CCTParamsInvalidError} if `minter` does not hold the mint role, or `sender`
   * lacks the version's role-admin permission
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
}
