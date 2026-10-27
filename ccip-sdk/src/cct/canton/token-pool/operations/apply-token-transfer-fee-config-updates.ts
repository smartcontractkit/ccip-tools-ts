/**
 * applyTokenTransferFeeConfigUpdates — set/update per-destination token
 * transfer fee configs (and disable existing ones) via the consuming
 * `ApplyTokenTransferFeeConfigUpdates` choice (returns the new pool CID).
 * Callable by the pool owner.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { ApplyTokenTransferFeeConfigUpdatesArg } from '../../daml-types.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** One destination chain's token transfer fee config. */
export interface TokenTransferFeeConfigUpdate {
  /** Destination chain selector (the lane must already exist). */
  destChainSelector: bigint
  /** Gas charged to execute the token transfer on the destination chain. */
  destGasOverhead: number | bigint
  /** Data availability bytes. */
  destBytesOverhead: number | bigint
  /** Fee to charge for token transfers, multiples of 0.01 USD. */
  feeUSDCents: bigint
  /** Proportional token fee in bps, applied by the pool during LockOrBurn. */
  feeBps: bigint
}

/** Parameters shared by `applyTokenTransferFeeConfigUpdates` generation and execution. */
export interface ApplyTokenTransferFeeConfigUpdatesParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Fee configs to set (always enabled — the choice rejects `isEnabled: false`). */
  tokenTransferFeeConfigArgs?: TokenTransferFeeConfigUpdate[]
  /** Destination chain selectors whose fee configs to disable. */
  disableTokenTransferFeeConfigArgs?: bigint[]
}

/** Parameters for unsigned `applyTokenTransferFeeConfigUpdates` generation. */
export type GenerateApplyTokenTransferFeeConfigUpdatesParams =
  CantonGenerateParams<ApplyTokenTransferFeeConfigUpdatesParams>

/** Unsigned `applyTokenTransferFeeConfigUpdates` result. */
export type GenerateApplyTokenTransferFeeConfigUpdatesResult = UnsignedCantonTx

/** Parameters for executing `applyTokenTransferFeeConfigUpdates`. */
export type ExecuteApplyTokenTransferFeeConfigUpdatesParams =
  CantonExecuteParams<ApplyTokenTransferFeeConfigUpdatesParams>

/** Result of executing `applyTokenTransferFeeConfigUpdates`. */
export type ExecuteApplyTokenTransferFeeConfigUpdatesResult = ExecutePoolChoiceResult

/** Pool `applyTokenTransferFeeConfigUpdates` operation. */
export class ApplyTokenTransferFeeConfigUpdates extends PoolChoiceOperation<ApplyTokenTransferFeeConfigUpdatesParams> {
  readonly name = 'applyTokenTransferFeeConfigUpdates'
  protected readonly poolChoice = 'ApplyTokenTransferFeeConfigUpdates'

  protected override prepare(
    p: GenerateApplyTokenTransferFeeConfigUpdatesParams,
  ): GenerateApplyTokenTransferFeeConfigUpdatesParams {
    super.prepare(p)
    if (!p.tokenTransferFeeConfigArgs?.length && !p.disableTokenTransferFeeConfigArgs?.length) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenTransferFeeConfigArgs',
        'at least one of tokenTransferFeeConfigArgs or disableTokenTransferFeeConfigArgs must be provided',
      )
    }
    for (const [i, c] of (p.tokenTransferFeeConfigArgs ?? []).entries()) {
      if (!c.destChainSelector) {
        throw new CCTParamsInvalidError(
          this.name,
          `tokenTransferFeeConfigArgs[${i}].destChainSelector`,
          'destination chain selector is required',
        )
      }
      if (c.feeBps < 0n || c.feeUSDCents < 0n) {
        throw new CCTParamsInvalidError(
          this.name,
          `tokenTransferFeeConfigArgs[${i}].feeBps`,
          'feeBps and feeUSDCents must be non-negative (the choice rejects negatives)',
        )
      }
    }
    return p
  }

  /** Builds the `ApplyTokenTransferFeeConfigUpdates` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateApplyTokenTransferFeeConfigUpdatesParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    const choiceArgument: ApplyTokenTransferFeeConfigUpdatesArg = {
      tokenTransferFeeConfigArgs: (p.tokenTransferFeeConfigArgs ?? []).map((c) => ({
        destChainSelector: c.destChainSelector.toString(),
        isEnabled: true, // the choice rejects false; disable via disableTokenTransferFeeConfigArgs
        destGasOverhead: c.destGasOverhead.toString(),
        destBytesOverhead: c.destBytesOverhead.toString(),
        feeUSDCents: c.feeUSDCents.toString(),
        feeBps: c.feeBps.toString(),
      })),
      disableTokenTransferFeeConfigArgs: (p.disableTokenTransferFeeConfigArgs ?? []).map((s) =>
        s.toString(),
      ),
    }
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-apply-fee-config-updates',
    })
  }
}
