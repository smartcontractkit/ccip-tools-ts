/**
 * applyCCVConfigUpdates — replaces complete per-remote-chain CCV requirements on an
 * `AdvancedPoolHooks`.
 *
 * @remarks Base CCVs apply to every transfer; threshold CCVs add requirements above the hooks'
 * configured threshold. This writes all four lists for every supplied selector — it does not merge
 * with the current config or read it to fill omitted fields. Empty base and threshold lists clear a
 * selector's configuration; threshold lists require their corresponding base list to be non-empty.
 * `address(0)` is valid in any list and requests the default CCV alongside any explicitly named
 * CCVs.
 *
 * Owner-only. The target's `typeAndVersion()` is checked before building calldata, so an EOA or an
 * unrelated Ownable contract cannot produce an unsigned no-op or misrouted transaction.
 *
 * @packageDocumentation
 */

import { getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation, callTx } from '../../operation.ts'
import {
  validateAddress,
  validateArray,
  validateNonZeroAddress,
  validateUint64,
} from '../../validate.ts'
import {
  type CCVConfigUpdate,
  ADVANCED_POOL_HOOKS_INTERFACE,
  assertAdvancedPoolHooksContract,
  assertAdvancedPoolHooksOwner,
} from '../contracts.ts'

/** Parameters for {@link ApplyCCVConfigUpdates}. */
export type ApplyCCVConfigUpdatesParams = {
  /** Hooks contract to reconfigure. Must be non-zero and report type `AdvancedPoolHooks`. */
  advancedPoolHooks: string
  /** Complete replacements to apply; an empty array is a permitted on-chain no-op. */
  ccvConfigArgs: CCVConfigUpdate[]
  /**
   * Hooks owner. Sets `tx.from` for offline / multisig signing and, when supplied, is checked
   * against the hooks' on-chain `owner()` before calldata is built. Optional for
   * {@link ApplyCCVConfigUpdates.generate}; {@link ApplyCCVConfigUpdates.execute} defaults it to
   * the signing wallet.
   */
  sender?: string
}

function validateCCVList(operation: string, param: string, value: unknown): string[] {
  validateArray(operation, param, value)
  const seen = new Set<string>()
  return value.map((address, i) => {
    validateAddress(operation, `${param}[${i}]`, address)
    const normalized = getAddress(address as string)
    if (seen.has(normalized))
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must not duplicate an earlier CCV',
      )
    seen.add(normalized)
    return normalized
  })
}

function validateCCVConfig(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CCTParamsInvalidError(operation, param, 'must be a CCV config update')
  const config = value as Record<string, unknown>
  validateUint64(operation, `${param}.remoteChainSelector`, config.remoteChainSelector)
  const outbound = validateCCVList(operation, `${param}.outboundCCVs`, config.outboundCCVs)
  const thresholdOutbound = validateCCVList(
    operation,
    `${param}.thresholdOutboundCCVs`,
    config.thresholdOutboundCCVs,
  )
  const inbound = validateCCVList(operation, `${param}.inboundCCVs`, config.inboundCCVs)
  const thresholdInbound = validateCCVList(
    operation,
    `${param}.thresholdInboundCCVs`,
    config.thresholdInboundCCVs,
  )
  if (thresholdOutbound.length > 0 && outbound.length === 0)
    throw new CCTParamsInvalidError(
      operation,
      `${param}.outboundCCVs`,
      'must not be empty when thresholdOutboundCCVs is set',
    )
  if (thresholdInbound.length > 0 && inbound.length === 0)
    throw new CCTParamsInvalidError(
      operation,
      `${param}.inboundCCVs`,
      'must not be empty when thresholdInboundCCVs is set',
    )
  for (const address of thresholdOutbound)
    if (outbound.includes(address))
      throw new CCTParamsInvalidError(
        operation,
        `${param}.thresholdOutboundCCVs`,
        'must not duplicate outboundCCVs',
      )
  for (const address of thresholdInbound)
    if (inbound.includes(address))
      throw new CCTParamsInvalidError(
        operation,
        `${param}.thresholdInboundCCVs`,
        'must not duplicate inboundCCVs',
      )
}

/** Applies complete CCV config replacements. Owner-only. */
export class ApplyCCVConfigUpdates extends EVMOperation<ApplyCCVConfigUpdatesParams> {
  readonly name = 'applyCCVConfigUpdates'

  /** Validates the hooks target and contract CCV constraints before any RPC. */
  protected override validate({
    advancedPoolHooks,
    ccvConfigArgs,
  }: ApplyCCVConfigUpdatesParams): void {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', advancedPoolHooks)
    validateArray(this.name, 'ccvConfigArgs', ccvConfigArgs)
    ccvConfigArgs.forEach((config, i) =>
      validateCCVConfig(this.name, `ccvConfigArgs[${i}]`, config),
    )
  }

  /**
   * Confirms the target is `AdvancedPoolHooks`, checks `sender` when supplied, then encodes the
   * update calldata.
   * @throws {@link CCTContractTypeInvalidError} if `advancedPoolHooks` is not `AdvancedPoolHooks`
   * @throws {@link CCTParamsInvalidError} if `sender` is supplied and is not the hooks owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    { advancedPoolHooks, ccvConfigArgs, sender }: ApplyCCVConfigUpdatesParams,
  ): Promise<UnsignedEVMTx> {
    await assertAdvancedPoolHooksContract(chain, advancedPoolHooks)
    if (sender !== undefined)
      await assertAdvancedPoolHooksOwner(this.name, chain, advancedPoolHooks, sender)
    return callTx(
      advancedPoolHooks,
      ADVANCED_POOL_HOOKS_INTERFACE.encodeFunctionData('applyCCVConfigUpdates', [ccvConfigArgs]),
    )
  }
}
