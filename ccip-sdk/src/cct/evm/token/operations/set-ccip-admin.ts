/**
 * setCCIPAdmin — sets a CrossChainToken v2.0.0 CCIP admin. Unlike v1.x, this call is gated by
 * `DEFAULT_ADMIN_ROLE`, not the current CCIP admin.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  assertTokenDefaultAdmin,
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
   * Resolves the v2 encoder and confirms `sender` (when known) is the current default admin.
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTOperationUnsupportedError} if no encoder supports the resolved version
   * @throws {@link CCTParamsInvalidError} if the token has no default admin or `sender` is not it
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newAdmin, sender }: SetCCIPAdminParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    await assertTokenDefaultAdmin(this.name, chain, tokenAddress, sender)
    return callTx(tokenAddress, iface.encodeFunctionData('setCCIPAdmin', [newAdmin]))
  }
}
