/**
 * setCCIPAdmin: sets a v2.0.0 token's CCIP admin. Unlike v1.x, this call is gated by
 * `DEFAULT_ADMIN_ROLE` (`owner` on a CrossChainPoolToken), not the current CCIP admin.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import {
  CROSS_CHAIN_POOL_TOKEN_INTERFACE,
  assertPoolOwner,
  resolveTokenPool,
} from '../../token-pool/contracts.ts'
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
  /** CrossChainToken or CrossChainPoolToken whose CCIP admin is being changed. */
  tokenAddress: string
  /** New CCIP admin. Zero is allowed, clearing the separate CCIP-admin slot. */
  newAdmin: string
  /** Current default admin (owner, on a CrossChainPoolToken); optional and checked when supplied. */
  sender?: string
}

/** Sets a v2.0.0 token's CCIP admin via `setCCIPAdmin`. */
export class SetCCIPAdmin extends EVMOperation<SetCCIPAdminParams> {
  readonly name = 'setCCIPAdmin'
  private readonly encoders: Partial<Record<TokenVersion, Interface>> = {
    [TokenVersion.V2_0_0]: getTokenInterface(TokenVersion.V2_0_0),
  }

  /** Validates addresses before any RPC; zero `newAdmin` is deliberately allowed. */
  protected override prepare(params: SetCCIPAdminParams): SetCCIPAdminParams {
    const { tokenAddress, newAdmin } = params
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateAddress(this.name, 'newAdmin', newAdmin)
    return params
  }

  /**
   * Resolves the v2 encoder and confirms `sender` (when known) is the current default admin
   * (owner, on a CrossChainPoolToken).
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken or
   * CrossChainPoolToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
   * @throws {@link CCTOperationUnsupportedError} if no encoder supports the resolved version
   * @throws {@link CCTParamsInvalidError} if the token has no default admin or `sender` is not it
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newAdmin, sender }: SetCCIPAdminParams,
  ): Promise<UnsignedEVMTx> {
    const [contractType] = await chain.typeAndVersion(tokenAddress)
    if (contractType === 'CrossChainPoolToken') {
      // version gate only: the pool token's override is onlyOwner, not the CCIP admin
      await resolveTokenPool(chain, tokenAddress)
      if (sender !== undefined) await assertPoolOwner(this.name, chain, tokenAddress, sender)
      return callTx(
        tokenAddress,
        CROSS_CHAIN_POOL_TOKEN_INTERFACE.encodeFunctionData('setCCIPAdmin', [newAdmin]),
      )
    }
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    await assertTokenDefaultAdmin(this.name, chain, tokenAddress, sender)
    return callTx(tokenAddress, iface.encodeFunctionData('setCCIPAdmin', [newAdmin]))
  }
}
