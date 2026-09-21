/**
 * acceptDefaultAdminTransfer — completes a pending CrossChainToken v2.0.0 default-admin transfer
 * after its mandatory AccessControlDefaultAdminRules delay.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import {
  TokenVersion,
  getTokenInterface,
  readPendingTokenDefaultAdmin,
  resolveCrossChainToken,
  resolveTokenEncoder,
} from '../contracts.ts'

/** Parameters for {@link AcceptDefaultAdminTransfer}. */
export type AcceptDefaultAdminTransferParams = {
  /** CrossChainToken whose pending default-admin transfer is being accepted. */
  tokenAddress: string
  /** Pending default admin; optional for offline signing and checked when supplied. */
  sender?: string
}

/** Completes a delayed CrossChainToken default-admin transfer via `acceptDefaultAdminTransfer`. */
export class AcceptDefaultAdminTransfer extends EVMOperation<AcceptDefaultAdminTransferParams> {
  readonly name = 'acceptDefaultAdminTransfer'
  private readonly encoders: Partial<Record<TokenVersion, Interface>> = {
    [TokenVersion.V2_0_0]: getTokenInterface(TokenVersion.V2_0_0),
  }

  /** Validates the token address before any RPC. */
  protected override validate({ tokenAddress }: AcceptDefaultAdminTransferParams): void {
    validateNonZeroAddress(this.name, 'tokenAddress', tokenAddress)
  }

  /**
   * Confirms a transfer is pending and, when known, that `sender` is its proposed admin.
   * The contract also requires its schedule to have passed; that time-dependent check remains
   * on-chain so an unsigned tx may be signed for execution after the delay.
   *
   * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` is not a CrossChainToken
   * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown token version
   * @throws {@link CCTParamsInvalidError} if no transfer is pending, it schedules renunciation, or
   * `sender` is not its pending default admin
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { tokenAddress, sender }: AcceptDefaultAdminTransferParams,
  ): Promise<UnsignedEVMTx> {
    const version = await resolveCrossChainToken(chain, tokenAddress)
    const iface = resolveTokenEncoder(this.encoders, version, this.name)
    const { newAdmin, schedule } = await readPendingTokenDefaultAdmin(chain, tokenAddress)
    if (schedule === 0n)
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        `has no pending default-admin transfer`,
      )
    if (sender !== undefined && getAddress(sender) !== newAdmin)
      throw new CCTParamsInvalidError(
        this.name,
        'sender',
        `must be the pending default admin (${newAdmin})`,
      )
    // A zero pending admin is the separate, deliberate renunciation path and cannot accept.
    if (newAdmin === ZeroAddress)
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAddress',
        'has a pending default-admin renunciation, which must be completed with renounceRole',
      )
    return callTx(tokenAddress, iface.encodeFunctionData('acceptDefaultAdminTransfer', []))
  }

  /**
   * Signs and submits as the pending default admin.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` differs from the wallet or it is not pending
   * @throws {@link CCIPExecTxRevertedError} if the mandatory delay has not passed or the tx reverts
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<AcceptDefaultAdminTransferParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
