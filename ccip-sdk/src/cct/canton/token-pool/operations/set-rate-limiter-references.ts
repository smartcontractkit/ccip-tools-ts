/**
 * setRateLimiterReferences — swap which `RateLimiter` contracts a pool's lanes
 * reference, via the consuming `SetRateLimiterReferences` choice (returns the
 * new pool CID). Callable by the pool owner.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { SetRateLimiterReferencesArg } from '../../daml-types.ts'
import { rawInstanceAddress } from '../../encoding.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { parseRawInstanceAddress } from '../../validate.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** One lane's rate-limiter reference update. */
export interface RateLimiterReferenceUpdate {
  /** Remote chain selector (the lane must already exist). */
  remoteChainSelector: bigint
  /** New inbound rate-limiter raw instance address (`"instanceId@party"`). */
  inboundRateLimiter: string
  /**
   * New inbound custom-block-confirmations limiter. Required to stay set when
   * the lane's finality is faster than finality (`WaitForSafe`/`BlockDepth`).
   */
  inboundCustomBlockConfirmationsRateLimiter?: string
  /** New outbound rate-limiter raw instance address. */
  outboundRateLimiter: string
}

/** Parameters shared by `setRateLimiterReferences` generation and execution. */
export interface SetRateLimiterReferencesParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Per-lane limiter reference updates. */
  rateLimitConfigArgs: RateLimiterReferenceUpdate[]
}

/** Parameters for unsigned `setRateLimiterReferences` generation. */
export type GenerateSetRateLimiterReferencesParams =
  CantonGenerateParams<SetRateLimiterReferencesParams>

/** Unsigned `setRateLimiterReferences` result. */
export type GenerateSetRateLimiterReferencesResult = UnsignedCantonTx

/** Parameters for executing `setRateLimiterReferences`. */
export type ExecuteSetRateLimiterReferencesParams =
  CantonExecuteParams<SetRateLimiterReferencesParams>

/** Result of executing `setRateLimiterReferences`. */
export type ExecuteSetRateLimiterReferencesResult = ExecutePoolChoiceResult

/** Pool `setRateLimiterReferences` operation. */
export class SetRateLimiterReferences extends PoolChoiceOperation<SetRateLimiterReferencesParams> {
  readonly name = 'setRateLimiterReferences'
  protected readonly poolChoice = 'SetRateLimiterReferences'

  protected override prepare(
    p: GenerateSetRateLimiterReferencesParams,
  ): GenerateSetRateLimiterReferencesParams {
    super.prepare(p)
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!p.rateLimitConfigArgs || p.rateLimitConfigArgs.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'rateLimitConfigArgs',
        'at least one update is required',
      )
    }
    for (const [i, c] of p.rateLimitConfigArgs.entries()) {
      if (!c.remoteChainSelector) {
        throw new CCTParamsInvalidError(
          this.name,
          `rateLimitConfigArgs[${i}].remoteChainSelector`,
          'remote chain selector is required',
        )
      }
      // Mirrors the on-ledger assertDistinctRateLimiters: inbound/outbound must
      // be present and distinct.
      if (!c.inboundRateLimiter || !c.outboundRateLimiter) {
        throw new CCTParamsInvalidError(
          this.name,
          `rateLimitConfigArgs[${i}].inboundRateLimiter`,
          'inbound and outbound rate limiters are required (the choice rejects empty ones)',
        )
      }
      if (c.inboundRateLimiter === c.outboundRateLimiter) {
        throw new CCTParamsInvalidError(
          this.name,
          `rateLimitConfigArgs[${i}].outboundRateLimiter`,
          'inbound and outbound rate limiters must be distinct',
        )
      }
      parseRawInstanceAddress(
        this.name,
        `rateLimitConfigArgs[${i}].inboundRateLimiter`,
        c.inboundRateLimiter,
      )
      parseRawInstanceAddress(
        this.name,
        `rateLimitConfigArgs[${i}].outboundRateLimiter`,
        c.outboundRateLimiter,
      )
      if (c.inboundCustomBlockConfirmationsRateLimiter) {
        parseRawInstanceAddress(
          this.name,
          `rateLimitConfigArgs[${i}].inboundCustomBlockConfirmationsRateLimiter`,
          c.inboundCustomBlockConfirmationsRateLimiter,
        )
      }
    }
    return p
  }

  /** Builds the `SetRateLimiterReferences` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetRateLimiterReferencesParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    const choiceArgument: SetRateLimiterReferencesArg = {
      rateLimitConfigArgs: p.rateLimitConfigArgs.map((c) => ({
        remoteChainSelector: c.remoteChainSelector.toString(),
        inboundRateLimiter: rawInstanceAddress(c.inboundRateLimiter),
        inboundCustomBlockConfirmationsRateLimiter: rawInstanceAddress(
          c.inboundCustomBlockConfirmationsRateLimiter ?? '',
        ),
        outboundRateLimiter: rawInstanceAddress(c.outboundRateLimiter),
      })),
    }
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-rate-limiter-references',
    })
  }
}
