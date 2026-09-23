/**
 * grantBurnRole: grants a supported CCT token's burn role to one account.
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

/** Parameters for {@link GrantBurnRole}. */
export type GrantBurnRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account receiving the burn role; must not already hold it. */
  burner: string
  /** Role admin; v1 token owner or v2 role-admin holder (normally `BURN_MINT_ADMIN_ROLE`); sets `tx.from`. */
  sender?: string
}

type Encoder = (iface: Interface, params: GrantBurnRoleParams) => UnsignedEVMTx

const encodeV1: Encoder = (iface, { tokenAddress, burner }) =>
  callTx(tokenAddress, iface.encodeFunctionData('grantBurnRole', [burner]))

const encodeV2: Encoder = (iface, { tokenAddress, burner }) =>
  callTx(tokenAddress, iface.encodeFunctionData('grantRole', [CrossChainTokenRole.BURNER, burner]))

/** Grants the burn role on a supported CCT token. */
export class GrantBurnRole extends EVMOperation<GrantBurnRoleParams> {
  readonly name = 'grantBurnRole'
  private readonly encoders: Partial<Record<TokenVersion, Encoder>> = {
    [TokenVersion.V1_5_1]: encodeV1,
    [TokenVersion.V2_0_0]: encodeV2,
  }

  /**
   * Validates both addresses before any RPC. Neither may be zero: a tx to `0x0` hits no code, and
   * granting a role to `0x0` mines as a no-op nobody can use.
   */
  protected override validate({ tokenAddress, burner }: GrantBurnRoleParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'burner', burner)
  }

  /**
   * Reads the current role state, then — when `sender` is known — confirms it owns the token.
   *
   * The role read runs first because it is also the family check ({@link resolveTokenRoleHandler}), which
   * `owner()` cannot make: a token pool and a v2.0.0 `CrossChainToken` declare `owner()` too. Both
   * checks run here rather than in {@link execute}, so the offline / multisig path gets them, and
   * a redundant grant is rejected even though the chain would mine it as a silent no-op.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677 token
   * nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   * @throws {@link CCTParamsInvalidError} if `burner` already holds the burn role, or `sender`
   * lacks the version's role-admin permission
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: GrantBurnRoleParams,
  ): Promise<UnsignedEVMTx> {
    const { tokenAddress, burner, sender } = params
    const version = await resolveToken(chain, tokenAddress)
    const roleHandler = resolveTokenRoleHandler(version, this.name)
    if (await roleHandler.hasRole(chain, tokenAddress, 'burn', burner))
      throw new CCTParamsInvalidError(
        this.name,
        'burner',
        `already holds the burn role on ${tokenAddress}; granting it again changes nothing`,
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
    params: EVMExecuteParams<GrantBurnRoleParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
