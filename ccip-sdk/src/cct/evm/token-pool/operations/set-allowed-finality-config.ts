/**
 * setAllowedFinalityConfig — sets the Faster-Than-Finality (FTF) and Fast Confirmation Rule
 * (FCR/safe) modes a v2.0.0 TokenPool accepts.
 *
 * @remarks **v2.0.0 only.** Earlier pools do not implement this selector. The config is encoded
 * as the pool's `bytes4` FinalityCodec value: `finalityDepth` is the minimum FTF block depth and
 * `finalitySafe` enables FCR. A depth of `0` disables FTF; `false` (or omission) disables FCR.
 *
 * Owner-only: finality controls when a transfer may be released, so it is not delegated to either
 * the rate-limit or fee admin.
 *
 * @packageDocumentation
 */

import { type Interface, toBeHex } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type FinalityAllowed, encodeFinality } from '../../../../extra-args.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import { parseRecord, validateBoolean, validateNonZeroAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link SetAllowedFinalityConfig}. */
export type SetAllowedFinalityConfigParams = {
  /** Token pool to reconfigure. Must be non-zero — it is the transaction destination. */
  poolAddress: string
  /**
   * Full replacement finality config. `finalityDepth` is an integer in `[0, 65535]`; `0` disables
   * FTF. Omitting `finalitySafe` disables FCR/safe finality; read the current config with
   * `getAllowedFinalityConfig` before updating one field while preserving the other.
   */
  allowedFinality: FinalityAllowed
  /**
   * Pool owner. Sets `tx.from` for offline / multisig signing and, when supplied, is checked
   * against the pool's on-chain `owner()` before calldata is built. Optional for
   * {@link SetAllowedFinalityConfig.generate}; {@link SetAllowedFinalityConfig.execute} defaults
   * it to the signing wallet.
   */
  sender?: string
}

/** Validates the SDK's semantic representation before encoding its `bytes4` contract value. */
function validateAllowedFinality(
  operation: string,
  allowedFinality: unknown,
): asserts allowedFinality is FinalityAllowed {
  const { finalityDepth, finalitySafe } = parseRecord(
    operation,
    'allowedFinality',
    allowedFinality,
    'finality config',
  )
  if (
    typeof finalityDepth !== 'number' ||
    !Number.isInteger(finalityDepth) ||
    finalityDepth < 0 ||
    finalityDepth > 65535
  )
    throw new CCTParamsInvalidError(
      operation,
      'allowedFinality.finalityDepth',
      'must be an integer in [0, 65535]',
    )
  if (finalitySafe !== undefined)
    validateBoolean(operation, 'allowedFinality.finalitySafe', finalitySafe)
}

/** Encodes the v2.0.0 `setAllowedFinalityConfig(bytes4)` call. */
type Encoder = (iface: Interface, params: SetAllowedFinalityConfigParams) => UnsignedEVMTx

const encodeSetAllowedFinalityConfig: Encoder = (iface, { poolAddress, allowedFinality }) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('setAllowedFinalityConfig', [
      toBeHex(encodeFinality(allowedFinality), 4),
    ]),
  )

/** Sets the finality modes a v2.0.0 TokenPool accepts. Owner-only. */
export class SetAllowedFinalityConfig extends EVMOperation<SetAllowedFinalityConfigParams> {
  readonly name = 'setAllowedFinalityConfig'

  /** The finality setter was introduced with the v2.0.0 pool interface. */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V2_0_0]: encodeSetAllowedFinalityConfig,
  }

  /** Validates the pool address and semantic finality config before any RPC. */
  protected override validate({
    poolAddress,
    allowedFinality,
  }: SetAllowedFinalityConfigParams): void {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateAllowedFinality(this.name, allowedFinality)
  }

  /**
   * Resolves the v2.0.0 pool interface and, when `sender` is supplied, confirms it is the owner.
   * The encoder is resolved first so pre-v2.0.0 pools report the missing operation without an
   * unnecessary owner read.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if `sender` is supplied and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: SetAllowedFinalityConfigParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    const encode = resolveEncoder(this.encoders, version, this.name)
    const unsigned = encode(getTokenPoolInterface(type, version), params)
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)
    return unsigned
  }

  /** Signs and submits as the pool owner, defaulting `sender` to the signing wallet. */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetAllowedFinalityConfigParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
