/**
 * revokeBurnRole: removes a supported CCT token's burn role from one account.
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

/** Parameters for {@link RevokeBurnRole}. */
export type RevokeBurnRoleParams = {
  /** BurnMintERC677 v1.x or CrossChainToken v2.0.0 whose roles are being changed. */
  tokenAddress: string
  /** Account losing the burn role; must currently hold it. */
  burner: string
  /** Role admin; v1 token owner or v2 role-admin holder (normally `BURN_MINT_ADMIN_ROLE`); sets `tx.from`. */
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
   * @throws {@link CCTContractVersionUnsupportedError} if CrossChainToken reports an unsupported
   * version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: RevokeBurnRoleParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveToken(chain, params.tokenAddress)
    return resolveTokenEncoder(
      this.encoders,
      version,
      this.name,
    )(getTokenInterface(version), params)
  }

  /**
   * Reports a revoke of a role never held, and checks `sender` against the version's role admin.
   * @remarks Reported rather than thrown outright so this can be planned behind the step that
   * grants the role, or the one that makes `sender` its admin.
   */
  protected override async preconditions(
    chain: EVMChain,
    { tokenAddress, burner, sender }: RevokeBurnRoleParams,
  ): Promise<PreconditionError[]> {
    const roleHandler = resolveTokenRoleHandler(await resolveToken(chain, tokenAddress), this.name)
    const [holdsRole, admin] = await Promise.all([
      roleHandler.hasRole(chain, tokenAddress, 'burn', burner),
      sender === undefined
        ? undefined
        : roleHandler.checkAdmin(chain, tokenAddress, 'burn', sender),
    ])
    return unmet(
      holdsRole
        ? undefined
        : {
            param: 'burner',
            reason: `does not hold the burn role on ${tokenAddress}; revoking it changes nothing`,
          },
      admin,
    )
  }
}
