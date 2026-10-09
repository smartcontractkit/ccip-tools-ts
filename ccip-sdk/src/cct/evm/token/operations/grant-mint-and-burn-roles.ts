/**
 * grantMintAndBurnRoles: grants a supported CCT token's mint *and* burn roles to one account in
 * a single transaction — the call for a newly deployed pool, which needs both.
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
import { type TokenRole, resolveTokenRoleHandler } from '../roles.ts'

/** Parameters for {@link GrantMintAndBurnRoles}. */
export type GrantMintAndBurnRolesParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account receiving both roles, typically the token's pool; must not already hold both. */
  burnAndMinter: string
  /** Role admin; v1 token owner or v2 role-admin holder (normally `BURN_MINT_ADMIN_ROLE`); sets `tx.from`. */
  sender?: string
}

type Encoder = (iface: Interface, params: GrantMintAndBurnRolesParams) => UnsignedEVMTx

const encodeGrantMintAndBurnRoles: Encoder = (iface, { tokenAddress, burnAndMinter }) =>
  callTx(tokenAddress, iface.encodeFunctionData('grantMintAndBurnRoles', [burnAndMinter]))

/** Grants both mint and burn roles on a supported CCT token. */
export class GrantMintAndBurnRoles extends EVMOperation<GrantMintAndBurnRolesParams> {
  readonly name = 'grantMintAndBurnRoles'
  private readonly encoders: Partial<Record<TokenVersion, Encoder>> = {
    [TokenVersion.V1_5_1]: encodeGrantMintAndBurnRoles,
  }

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
   * Rejected only when the account holds both roles already: holding one still builds, since
   * completing the pair is what this call is for.
   *
   * The role reads run first because they are also the family check ({@link resolveTokenRoleHandler}), which
   * `owner()` cannot make: a token pool and a v2.0.0 `CrossChainToken` declare `owner()` too, and
   * v2.0.0 declares `grantMintAndBurnRoles` itself. Both checks run here rather than in
   * {@link execute}, so the offline / multisig path gets them.
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is neither a BurnMintERC677 token
   * nor a supported CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: GrantMintAndBurnRolesParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveToken(chain, params.tokenAddress)
    return resolveTokenEncoder(
      this.encoders,
      version,
      this.name,
    )(getTokenInterface(version), params)
  }

  /**
   * Reports a grant that would change nothing, and checks `sender` against the role admin of
   * *both* roles — they can differ under AccessControl, so both are read and both reported.
   * @remarks Reported rather than thrown outright so this can be planned behind the step that
   * makes `sender` the role admin.
   */
  protected override async preconditions(
    chain: EVMChain,
    { tokenAddress, burnAndMinter, sender }: GrantMintAndBurnRolesParams,
  ): Promise<PreconditionError[]> {
    const version = await resolveToken(chain, tokenAddress)
    const roleHandler = resolveTokenRoleHandler(version, this.name)
    // v1 gates both roles on the token `owner`, so one check covers them and asking twice would
    // just read `owner()` twice. v2's AccessControl can give each role a different admin.
    const adminRoles: TokenRole[] = version === TokenVersion.V2_0_0 ? ['mint', 'burn'] : ['mint']
    // Role reads first: on v1 it doubles as the family check, so an EOA or a non-BurnMintERC677
    // contract surfaces as CCTContractTypeInvalidError rather than as whichever raw `owner()`
    // decode failure won a race against it. Costs a round trip only when `sender` is given.
    const [isMinter, isBurner] = await Promise.all([
      roleHandler.hasRole(chain, tokenAddress, 'mint', burnAndMinter),
      roleHandler.hasRole(chain, tokenAddress, 'burn', burnAndMinter),
    ])
    const admins =
      sender === undefined
        ? []
        : await Promise.all(
            adminRoles.map((role) => roleHandler.checkAdmin(chain, tokenAddress, role, sender)),
          )
    return unmet(
      isMinter && isBurner
        ? {
            param: 'burnAndMinter',
            reason: `already holds the mint and burn roles on ${tokenAddress}; granting them again changes nothing`,
          }
        : undefined,
      ...admins,
    )
  }
}
