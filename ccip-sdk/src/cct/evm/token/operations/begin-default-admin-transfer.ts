/**
 * beginDefaultAdminTransfer — schedules a CrossChainToken v2.0.0 default-admin transfer. The
 * pending admin must accept after the contract's configured delay.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateAddress, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  assertTokenDefaultAdmin,
  getTokenInterface,
  resolveCrossChainToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link BeginDefaultAdminTransfer}. */
export type BeginDefaultAdminTransferParams = {
  /** CrossChainToken whose default admin is being transferred. */
  tokenAddress: string
  /** Proposed default admin. Zero is allowed to schedule renunciation through `renounceRole`. */
  newAdmin: string
  /** Current default admin; optional for offline signing and checked when supplied. */
  sender?: string
}

/** Schedules a CrossChainToken default-admin transfer via `beginDefaultAdminTransfer`. */
export class BeginDefaultAdminTransfer extends EVMOperation<BeginDefaultAdminTransferParams> {
  readonly name = 'beginDefaultAdminTransfer'
  private readonly encoders: Partial<Record<TokenVersion, Interface>> = {
    [TokenVersion.V2_0_0]: getTokenInterface(TokenVersion.V2_0_0),
  }

  /** Validates addresses before any RPC. `newAdmin = 0x0` intentionally schedules renunciation. */
  protected override validate({ tokenAddress, newAdmin }: BeginDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
    validateAddress(this.name, 'newAdmin', newAdmin)
  }

  /**
   * Confirms the `defaultAdmin()` capability and, when known, that `sender` is its default admin.
   * OpenZeppelin permits replacing an existing pending transfer and permits the zero-address
   * proposal used for renunciation, so neither is rejected here.
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTParamsInvalidError} if the token has no default admin or `sender` is not it
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, newAdmin, sender }: BeginDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    await assertTokenDefaultAdmin(this.name, chain, tokenAddress, sender)
    return callTx(tokenAddress, iface.encodeFunctionData('beginDefaultAdminTransfer', [newAdmin]))
  }

  /**
   * Signs and submits as the current default admin.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` differs from the wallet or it is not the
   * current default admin
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<BeginDefaultAdminTransferParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
