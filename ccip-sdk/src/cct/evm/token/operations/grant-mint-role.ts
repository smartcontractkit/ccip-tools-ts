/**
 * grantMintRole: grants a BurnMintERC677 token's mint role to one account. Owner-gated
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

/** Parameters for {@link GrantMintRole}. */
export type GrantMintRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account receiving the mint role; must not already hold it. */
  minter: string
  /** Role admin; token owner for v1.x, `BURN_MINT_ADMIN_ROLE` holder for v2; sets `tx.from`. */
  sender?: string
}

type Encoder = (iface: Interface, params: GrantMintRoleParams) => UnsignedEVMTx

const encodeV1: Encoder = (iface, { tokenAddress, minter }) =>
  callTx(tokenAddress, iface.encodeFunctionData('grantMintRole', [minter]))

const encodeV2: Encoder = (iface, { tokenAddress, minter }) =>
  callTx(tokenAddress, iface.encodeFunctionData('grantRole', [CrossChainTokenRole.MINTER, minter]))

/** Grants the mint role on a supported CCT token. */
export class GrantMintRole extends EVMOperation<GrantMintRoleParams> {
  readonly name = 'grantMintRole'
  private readonly encoders: Partial<Record<TokenVersion, Encoder>> = {
    [TokenVersion.V1_5_1]: encodeV1,
    [TokenVersion.V2_0_0]: encodeV2,
  }

  /**
   * Validates both addresses before any RPC. Neither may be zero: a tx to `0x0` hits no code, and
   * granting a role to `0x0` mines as a no-op nobody can use.
   */
  protected override validate({ tokenAddress, minter }: GrantMintRoleParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateNonZeroAddress(this.name, 'minter', minter)
  }

  /**
   * Reads the current role state, then checks the supplied sender against the role's actual
   * on-chain admin. v1.x is owner-gated; CrossChainToken v2 uses AccessControl's
   * `BURN_MINT_ADMIN_ROLE`. Both paths reject a redundant grant before it becomes a mined no-op.
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: GrantMintRoleParams,
  ): Promise<UnsignedEVMTx> {
    const { tokenAddress, minter, sender } = params
    const version = await resolveToken(chain, tokenAddress)
    const roleHandler = resolveTokenRoleHandler(version, this.name)
    const isMinter = await roleHandler.hasRole(chain, tokenAddress, 'mint', minter)
    if (isMinter)
      throw new CCTParamsInvalidError(
        this.name,
        'minter',
        `already holds the mint role on ${tokenAddress}; granting it again changes nothing`,
      )
    if (sender !== undefined)
      await roleHandler.assertAdmin(this.name, chain, tokenAddress, 'mint', sender)

    const encode = resolveTokenEncoder(this.encoders, version, this.name)
    return encode(getTokenInterface(version), params)
  }

  /**
   * Signs and submits as the token's v1 owner or v2 mint-role admin. `sender` defaults to the
   * signing wallet; {@link EVMOperation.resolveWalletSender} rejects a divergent sender.
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
