/**
 * withdrawFeeTokens — transfers all accrued balances of selected fee tokens from a v2.0.0 pool.
 *
 * @remarks The pool owner or its `feeAdmin` may call this operation. Each selected token's full
 * pool balance is sent to `recipient`; on LockRelease pools this excludes bridge liquidity, which
 * is held by the external lockbox.
 *
 * @see {@link SetDynamicConfig} to appoint or revoke the delegated `feeAdmin`.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { validateArray, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwnerOrFeeAdmin,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link WithdrawFeeTokens}. */
export type WithdrawFeeTokensParams = {
  /** v2.0.0 token pool holding the accrued fees. */
  poolAddress: string
  /** Fee-token addresses whose entire pool balances to transfer. */
  feeTokens: string[]
  /** Non-zero address that receives the withdrawn balances. */
  recipient: string
  /** Pool owner or delegated `feeAdmin`; optional when generating an unsigned transaction. */
  sender?: string
}

type Encoder = (iface: Interface, params: WithdrawFeeTokensParams) => UnsignedEVMTx

const encodeWithdrawFeeTokens: Encoder = (iface, { poolAddress, feeTokens, recipient }) =>
  callTx(poolAddress, iface.encodeFunctionData('withdrawFeeTokens', [feeTokens, recipient]))

/** Withdraws all accrued balances of selected fee tokens. Owner- or `feeAdmin`-only. */
export class WithdrawFeeTokens extends EVMOperation<WithdrawFeeTokensParams> {
  readonly name = 'withdrawFeeTokens'

  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V2_0_0]: encodeWithdrawFeeTokens,
  }

  /** Validates every ABI address before any RPC; an empty token list would mine as a no-op. */
  protected override validate({
    poolAddress,
    feeTokens,
    recipient,
  }: WithdrawFeeTokensParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateArray(this.name, 'feeTokens', feeTokens, 1)
    feeTokens.forEach((feeToken, i) =>
      validateNonZeroAddress(this.name, `feeTokens[${i}]`, feeToken),
    )
    validateNonZeroAddress(this.name, 'recipient', recipient)
  }

  /**
   * Resolves the v2.0.0 interface and, when known, verifies the owner-or-`feeAdmin` sender. The
   * encoder is resolved before role reads, so older pools fail without unnecessary RPCs.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if `sender` is supplied and is neither the pool owner
   * nor its configured `feeAdmin`
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: WithdrawFeeTokensParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    if (params.sender !== undefined)
      await assertPoolOwnerOrFeeAdmin(this.name, chain, params.poolAddress, params.sender)
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Signs and submits as the pool owner or delegated `feeAdmin`, defaulting `sender` to the
   * signing wallet.
   *
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if any parameter is invalid, `sender` differs from the
   * wallet, or the wallet is neither the owner nor its configured `feeAdmin`
   * @throws {@link CCIPExecTxRevertedError} if the transaction reverts on-chain
   * @throws {@link CCTTxFailedError} if submission fails before broadcast
   * @throws {@link CCTTxNotConfirmedError} if it is not confirmed in time
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<WithdrawFeeTokensParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
