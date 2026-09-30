/**
 * cancelDefaultAdminTransfer — cancels a pending CrossChainToken v2.0.0 default-admin transfer.
 * Only the current default admin may cancel it.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  assertTokenDefaultAdmin,
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
   * Confirms a transfer exists and, when known, that `sender` is the current default admin.
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTOperationUnsupportedError} if no encoder supports the resolved version
   * @throws {@link CCTParamsInvalidError} if no transfer is pending or `sender` is not the admin
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, sender }: CancelDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    const { schedule } = await readPendingTokenDefaultAdmin(chain, tokenAddress)
    if (schedule === 0n)
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        'has no pending default-admin transfer to cancel',
      )
    if (sender !== undefined) await assertTokenDefaultAdmin(this.name, chain, tokenAddress, sender)
    return callTx(tokenAddress, iface.encodeFunctionData('cancelDefaultAdminTransfer', []))
  }
}
