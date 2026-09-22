/**
 * revokeBurnRole: removes a supported CCT token's burn role from one account.
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

/** Parameters for {@link RevokeBurnRole}. */
export type RevokeBurnRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account losing the burn role; must currently hold it. */
  burner: string
  /** Role admin; token owner for v1.x, `BURN_MINT_ADMIN_ROLE` holder for v2; sets `tx.from`. */
  sender?: string
}

type Encoder = (iface: Interface, params: RevokeBurnRoleParams) => UnsignedEVMTx

const encodeV1: Encoder = (iface, { tokenAddress, burner }) =>
  callTx(tokenAddress, iface.encodeFunctionData('revokeBurnRole', [burner]))

const encodeV2: Encoder = (iface, { tokenAddress, burner }) =>
  callTx(tokenAddress, iface.encodeFunctionData('revokeRole', [CrossChainTokenRole.BURNER, burner]))

/** Removes the burn role from an account on a supported CCT token. */
export class RevokeBurnRole extends EVMOperation<RevokeBurnRoleParams> {
  readonly name = 'revokeBurnRole'
  private readonly encoders: Partial<Record<TokenVersion, Encoder>> = {
    [TokenVersion.V1_5_1]: encodeV1,
    [TokenVersion.V2_0_0]: encodeV2,
  }

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
   * The role read runs first because it is also the family check ({@link resolveTokenRoleHandler}), which
   * `owner()` cannot make: a token pool and a v2.0.0 `CrossChainToken` declare `owner()` too. Both
   * checks run here rather than in {@link execute}, so the offline / multisig path gets them, and
   * revoking a role never held is rejected even though the chain would mine it as a silent no-op.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677 token
   * nor a supported CrossChainToken
   * @throws {@link CCTParamsInvalidError} if `burner` does not hold the burn role, or `sender`
   * lacks the version's role-admin permission
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: RevokeBurnRoleParams,
  ): Promise<UnsignedEVMTx> {
    const { tokenAddress, burner, sender } = params
    const version = await resolveToken(chain, tokenAddress)
    const roleHandler = resolveTokenRoleHandler(version, this.name)
    if (!(await roleHandler.hasRole(chain, tokenAddress, 'burn', burner)))
      throw new CCTParamsInvalidError(
        this.name,
        'burner',
        `does not hold the burn role on ${tokenAddress}; revoking it changes nothing`,
      )
    if (sender !== undefined)
      await roleHandler.assertAdmin(this.name, chain, tokenAddress, 'burn', sender)

    return resolveTokenEncoder(
      this.encoders,
      version,
      this.name,
    )(getTokenInterface(version), params)
  }

  /**
   * Signs and submits as the token's v1 owner or v2 burn-role admin, defaulting `sender` to the
   * signing wallet. See
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
