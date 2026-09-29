/**
 * cancelDefaultAdminTransfer — cancels a pending CrossChainToken v2.0.0 default-admin transfer.
 * Only the current default admin may cancel it.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { PreconditionError } from '../../../errors.ts'
import { EVMOperation, callTx, unmet } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  checkTokenDefaultAdmin,
  getTokenInterface,
  readPendingTokenDefaultAdmin,
  resolveCrossChainToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link CancelDefaultAdminTransfer}. */
export type CancelDefaultAdminTransferParams = {
  /** CrossChainToken whose pending default-admin transfer is being canceled. */
  tokenAddress: string
  /** Current default admin; optional for offline signing and checked when supplied. */
  sender?: string
}

/** Cancels a pending CrossChainToken default-admin transfer via `cancelDefaultAdminTransfer`. */
export class CancelDefaultAdminTransfer extends EVMOperation<CancelDefaultAdminTransferParams> {
  readonly name = 'cancelDefaultAdminTransfer'
  private readonly encoders: Partial<Record<TokenVersion, Interface>> = {
    [TokenVersion.V2_0_0]: getTokenInterface(TokenVersion.V2_0_0),
  }

  /** Validates the token address before any RPC. */
  protected override validate({ tokenAddress }: CancelDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
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
    { tokenAddress }: CancelDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    return callTx(tokenAddress, iface.encodeFunctionData('cancelDefaultAdminTransfer', []))
  }

  /**
   * Confirms a transfer exists to cancel and, when known, that `sender` is the current default
   * admin.
   * @remarks Both reported rather than thrown outright: `beginDefaultAdminTransfer` in an earlier
   * step creates the pending transfer this one cancels.
   */
  protected override async preconditions(
    chain: EVMChain,
    { tokenAddress, sender }: CancelDefaultAdminTransferParams,
  ): Promise<PreconditionError[]> {
    const [{ schedule }, admin] = await Promise.all([
      readPendingTokenDefaultAdmin(chain, tokenAddress),
      sender === undefined ? undefined : checkTokenDefaultAdmin(chain, tokenAddress, sender),
    ])
    return unmet(
      schedule === 0n
        ? { param: 'tokenAddress', reason: 'has no pending default-admin transfer to cancel' }
        : undefined,
      admin,
    )
  }
}
