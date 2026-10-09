/**
 * grantMintRole: grants a supported CCT token's mint role to one account.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { TokenVersion, getTokenInterface, resolveToken, resolveTokenEncoder } from '../contracts.ts'
import { CrossChainTokenRole, resolveTokenRoleHandler } from '../roles.ts'

/** Parameters for {@link GrantMintRole}. */
export type GrantMintRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account receiving the mint role; must not already hold it. */
  minter: string
  /** Role admin; v1 token owner or v2 role-admin holder (normally `BURN_MINT_ADMIN_ROLE`); sets `tx.from`. */
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
   * Resolves the token version and encodes the grant.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677 token
   * nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: GrantMintRoleParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveToken(chain, params.tokenAddress)
    const encode = resolveTokenEncoder(this.encoders, version, this.name)
    return encode(getTokenInterface(version), params)
  }

  /**
   * Reports a redundant grant, and checks the supplied sender against the role's actual on-chain
   * admin: v1.x is owner-gated, CrossChainToken v2 uses AccessControl's `BURN_MINT_ADMIN_ROLE`.
   * @remarks Reported rather than thrown outright so this can be planned behind the step that
   * makes `sender` the role admin. `resolveToken` re-reads nothing — `chain.typeAndVersion` is
   * memoized, so the version {@link buildUnsigned} just resolved is already cached.
   */
  protected override async preconditions(
    chain: EVMChain,
    { tokenAddress, minter, sender }: GrantMintRoleParams,
  ): Promise<PreconditionError[]> {
    const roleHandler = resolveTokenRoleHandler(await resolveToken(chain, tokenAddress), this.name)
    // Role read first: on v1 it doubles as the family check, so an EOA or a non-BurnMintERC677
    // contract surfaces as CCTContractTypeInvalidError rather than as whichever raw `owner()`
    // decode failure won a race against it. Costs a round trip only when `sender` is given.
    const isMinter = await roleHandler.hasRole(chain, tokenAddress, 'mint', minter)
    const admin =
      sender === undefined
        ? undefined
        : await roleHandler.checkAdmin(chain, tokenAddress, 'mint', sender)
    return unmet(
      isMinter
        ? {
            param: 'minter',
            reason: `already holds the mint role on ${tokenAddress}; granting it again changes nothing`,
          }
        : undefined,
      admin,
    )
  }
}
