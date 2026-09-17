/**
 * applyTokenTransferFeeConfigUpdates — updates or disables v2.0.0 pool token-transfer fees per
 * destination chain in one call.
 *
 * @remarks The pool owner or its `feeAdmin` may call this operation. Updates are applied before
 * disables; a selector must therefore appear in exactly one list. An update with `isEnabled:
 * false` stores a disabled config; `disables` removes one.
 *
 * @see {@link SetDynamicConfig} to appoint or revoke the delegated `feeAdmin`.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { TokenTransferFeeConfig } from '../../../../chain.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import {
  parseRecord,
  validateArray,
  validateBoolean,
  validateNonZeroAddress,
  validateUint32,
  validateUint64,
} from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwnerOrFeeAdmin,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** One destination-chain token-transfer fee update. */
export type TokenTransferFeeConfigUpdate = {
  /** Destination CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
  /** Complete fee configuration for this destination chain. */
  tokenTransferFeeConfig: TokenTransferFeeConfig
}

/** Parameters for {@link ApplyTokenTransferFeeConfigUpdates}. */
export type ApplyTokenTransferFeeConfigUpdatesParams = {
  /** v2.0.0 token pool to reconfigure. */
  poolAddress: string
  /** Fee configurations to set, one per remote chain; defaults to none. */
  updates?: TokenTransferFeeConfigUpdate[]
  /** Remote chains whose token-transfer fees to disable; defaults to none. */
  disables?: bigint[]
  /**
   * Pool owner or delegated `feeAdmin`; optional when generating an unsigned transaction.
   * @see {@link SetDynamicConfig} to configure `feeAdmin`.
   */
  sender?: string
}

type ParsedParams = Omit<ApplyTokenTransferFeeConfigUpdatesParams, 'updates' | 'disables'> & {
  updates: TokenTransferFeeConfigUpdate[]
  disables: bigint[]
}

type Encoder = (iface: Interface, params: ParsedParams) => UnsignedEVMTx

const encodeApplyTokenTransferFeeConfigUpdates: Encoder = (
  iface,
  { poolAddress, updates, disables },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [
      updates.map(({ remoteChainSelector, tokenTransferFeeConfig }) => [
        remoteChainSelector,
        tokenTransferFeeConfig,
      ]),
      disables,
    ]),
  )

function validateFeeConfig(operation: string, param: string, value: unknown): void {
  const config = parseRecord(operation, param, value, 'token transfer fee config')
  for (const field of [
    'destGasOverhead',
    'destBytesOverhead',
    'finalityFeeUSDCents',
    'fastFinalityFeeUSDCents',
  ]) {
    validateUint32(operation, `${param}.${field}`, config[field])
  }

  for (const field of ['finalityTransferFeeBps', 'fastFinalityTransferFeeBps']) {
    const value = config[field]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000)
      throw new CCTParamsInvalidError(
        operation,
        `${param}.${field}`,
        'must be an integer in [0, 10000]',
      )
  }
  validateBoolean(operation, `${param}.isEnabled`, config.isEnabled)
}

/** Applies v2.0.0 token-transfer fee configuration updates. Owner- or `feeAdmin`-only. */
export class ApplyTokenTransferFeeConfigUpdates extends EVMOperation<
  ApplyTokenTransferFeeConfigUpdatesParams,
  ParsedParams
> {
  readonly name = 'applyTokenTransferFeeConfigUpdates'

  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V2_0_0]: encodeApplyTokenTransferFeeConfigUpdates,
  }

  /**
   * Defaults omitted lists while validating all ABI fields before any RPC.
   *
   * @throws {@link CCTParamsInvalidError} if a selector or fee field cannot be encoded, a selector
   * is zero, duplicated, or overlaps the other list, or both lists are empty
   */
  protected override parse({
    poolAddress,
    updates = [],
    disables = [],
    ...params
  }: ApplyTokenTransferFeeConfigUpdatesParams): ParsedParams {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateArray(this.name, 'updates', updates)
    validateArray(this.name, 'disables', disables)

    if (updates.length + disables.length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'updates',
        'at least one fee config must be updated or disabled',
      )

    const selectors = new Set<bigint>()

    updates.forEach((update, i) => {
      const param = `updates[${i}]`
      const record = parseRecord(this.name, param, update, 'token transfer fee update')
      validateUint64(this.name, `${param}.remoteChainSelector`, record.remoteChainSelector)
      if (record.remoteChainSelector === 0n)
        throw new CCTParamsInvalidError(
          this.name,
          `${param}.remoteChainSelector`,
          'must not be zero',
        )
      if (selectors.has(record.remoteChainSelector))
        throw new CCTParamsInvalidError(
          this.name,
          `${param}.remoteChainSelector`,
          'must not duplicate an earlier selector',
        )
      selectors.add(record.remoteChainSelector)
      validateFeeConfig(this.name, `${param}.tokenTransferFeeConfig`, record.tokenTransferFeeConfig)
    })

    disables.forEach((selector, i) => {
      const param = `disables[${i}]`
      validateUint64(this.name, param, selector)
      if (selector === 0n) throw new CCTParamsInvalidError(this.name, param, 'must not be zero')
      if (selectors.has(selector))
        throw new CCTParamsInvalidError(
          this.name,
          param,
          'must not duplicate or overlap an updated selector',
        )
      selectors.add(selector)
    })

    return { ...params, poolAddress, updates, disables }
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
  protected async buildUnsigned(chain: EVMChain, params: ParsedParams): Promise<UnsignedEVMTx> {
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
    params: EVMExecuteParams<ApplyTokenTransferFeeConfigUpdatesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
