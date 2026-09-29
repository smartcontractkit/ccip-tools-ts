/**
 * setCCIPAdmin — sets a CrossChainToken v2.0.0 CCIP admin. Unlike v1.x, this call is gated by
 * `DEFAULT_ADMIN_ROLE`, not the current CCIP admin.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  checkTokenDefaultAdmin,
  getTokenInterface,
  resolveCrossChainToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link SetCCIPAdmin}. */
export type SetCCIPAdminParams = {
  /** CrossChainToken whose CCIP admin is being changed. */
  tokenAddress: string
  /** New CCIP admin. Zero is allowed by CrossChainToken, clearing the separate CCIP-admin slot. */
  newAdmin: string
  /** Current default admin; optional for offline signing and checked when supplied. */
  sender?: string
}

/** Sets a CrossChainToken CCIP admin via `setCCIPAdmin`. */
export class SetCCIPAdmin extends EVMOperation<SetCCIPAdminParams> {
  readonly name = 'setCCIPAdmin'
  private readonly encoders: Partial<Record<TokenVersion, Interface>> = {
    [TokenVersion.V2_0_0]: getTokenInterface(TokenVersion.V2_0_0),
  }

  /** Validates addresses before any RPC; v2 CrossChainToken deliberately allows zero `newAdmin`. */
  protected override validate({ tokenAddress, newAdmin }: SetCCIPAdminParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateAddress(this.name, 'newAdmin', newAdmin)
  }

  /**
   * Resolves the v2 encoder and encodes.
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTOperationUnsupportedError} if no encoder supports the resolved version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newAdmin }: SetCCIPAdminParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    return callTx(tokenAddress, iface.encodeFunctionData('setCCIPAdmin', [newAdmin]))
  }

  /**
   * Confirms the token has a default admin and, when known, that `sender` is it.
   * @remarks Reported rather than thrown outright so this can be planned behind the step that
   * makes `sender` the default admin.
   */
  protected override async preconditions(
    chain: EVMChain,
    { tokenAddress, sender }: SetCCIPAdminParams,
  ): Promise<PreconditionError[]> {
    return unmet(await checkTokenDefaultAdmin(chain, tokenAddress, sender))
  }
}
