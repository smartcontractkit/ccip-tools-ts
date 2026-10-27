/**
 * setRateLimiterObservers — update a RateLimiter contract's EDS observer
 * parties via its consuming `SetObservers` choice (returns the new limiter
 * CID). Callable by the pool owner (the limiter's signatory).
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { SetObserversArg } from '../../daml-types.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
  extractExerciseResult,
} from '../../operation.ts'
import type { CantonTransactionResult } from '../../types.ts'
import { parsePartyId, parseRawInstanceAddress } from '../../validate.ts'
import { RATE_LIMITER_TEMPLATE_ID, buildPoolExercise, resolveRateLimiterRef } from '../shared.ts'

/** Parameters shared by `setRateLimiterObservers` generation and execution. */
export interface SetRateLimiterObserversParams {
  /** RateLimiter raw instance address (`"instanceId@poolOwner"`). */
  rateLimiterInstanceAddress: string
  /** Observer party IDs (used by EDS to auto-detect this rate limiter). */
  observers: string[]
}

/** Parameters for unsigned `setRateLimiterObservers` generation. */
export type GenerateSetRateLimiterObserversParams =
  CantonGenerateParams<SetRateLimiterObserversParams>

/** Unsigned `setRateLimiterObservers` result. */
export type GenerateSetRateLimiterObserversResult = UnsignedCantonTx

/** Parameters for executing `setRateLimiterObservers`. */
export type ExecuteSetRateLimiterObserversParams =
  CantonExecuteParams<SetRateLimiterObserversParams>

/** Result of executing `setRateLimiterObservers`. */
export type ExecuteSetRateLimiterObserversResult = CantonTransactionResult & {
  /** New RateLimiter contract ID (consuming choice → new CID). */
  rateLimiterCid: string
}

/** RateLimiter `setObservers` operation. */
export class SetRateLimiterObservers extends CantonOperation<SetRateLimiterObserversParams> {
  readonly name = 'setRateLimiterObservers'

  /** Validates the limiter target and observer list. */
  protected override prepare(
    p: GenerateSetRateLimiterObserversParams,
  ): GenerateSetRateLimiterObserversParams {
    const { owner } = parseRawInstanceAddress(
      this.name,
      'rateLimiterInstanceAddress',
      p.rateLimiterInstanceAddress,
    )
    // The choice's controller is the pool owner (the limiter's signatory).
    if (owner !== p.sender) {
      throw new CCTParamsInvalidError(
        this.name,
        'rateLimiterInstanceAddress',
        `the limiter's owner (${owner}) must be the sender`,
      )
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!p.observers || p.observers.length === 0) {
      throw new CCTParamsInvalidError(this.name, 'observers', 'at least one observer is required')
    }
    p.observers.forEach((o, i) => parsePartyId(this.name, `observers[${i}]`, o))
    return p
  }

  /** Builds the `SetObservers` exercise command against the limiter. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetRateLimiterObserversParams,
  ): Promise<JsCommands> {
    const rateLimiter = await resolveRateLimiterRef(chain, p.sender, p.rateLimiterInstanceAddress)
    const choiceArgument: SetObserversArg = { observers: p.observers }
    return buildPoolExercise({
      choice: 'SetObservers',
      templateId: RATE_LIMITER_TEMPLATE_ID,
      poolContract: rateLimiter,
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-rate-limiter-observers',
    })
  }

  override async execute(
    chain: CantonChain,
    params: ExecuteSetRateLimiterObserversParams,
  ): Promise<ExecuteSetRateLimiterObserversResult> {
    const base = await super.execute(chain, params)
    const rateLimiterCid = extractExerciseResult(base.response, 'SetObservers')
    if (typeof rateLimiterCid !== 'string') {
      throw new CCTTxFailedError(this.name, 'SetObservers exerciseResult was not a contract ID', {
        context: { updateId: base.hash },
      })
    }
    return { ...base, rateLimiterCid }
  }
}
