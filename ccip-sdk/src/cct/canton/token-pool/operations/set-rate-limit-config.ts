/**
 * setRateLimitConfig — update one lane rate limiter's `isEnabled`/`capacity`/`rate`
 * via the pool's nonconsuming `SetRateLimitConfig` choice (returns the new
 * RateLimiter CID).
 *
 * Callable by the pool owner or the pool's `rateLimitAdmin`. Note the on-ledger
 * semantics: `isEnabled: false` disables rate *limiting* (unlimited
 * throughput, and the choice requires capacity/rate 0); to block a direction,
 * set `isEnabled: true` with zero capacity and rate.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import { type CantonChain, decodeDamlRecord, extractFieldValue } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { SetRateLimitConfigArg } from '../../daml-types.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
  extractExerciseResult,
} from '../../operation.ts'
import type { CantonTransactionResult } from '../../types.ts'
import { parseRawInstanceAddress } from '../../validate.ts'
import {
  POOL_TEMPLATE_IDS,
  RATE_LIMITER_TEMPLATE_ID,
  buildPoolExercise,
  resolvePool,
  resolveRateLimiterRef,
  toContractRef,
} from '../shared.ts'

/** Parameters shared by `setRateLimitConfig` generation and execution. */
export interface SetRateLimitConfigParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** RateLimiter raw instance address (`"instanceId@poolOwner"`); must be one the pool's lanes reference. */
  rateLimiterInstanceAddress: string
  /** Whether the limiter enforces (`false` = unlimited, and requires zero capacity/rate). */
  isEnabled: boolean
  /** Bucket capacity, in the pool's local decimals. */
  capacity: bigint
  /** Refill rate (tokens/second), in the pool's local decimals. */
  rate: bigint
}

/** Parameters for unsigned `setRateLimitConfig` generation. */
export type GenerateSetRateLimitConfigParams = CantonGenerateParams<SetRateLimitConfigParams>

/** Unsigned `setRateLimitConfig` result. */
export type GenerateSetRateLimitConfigResult = UnsignedCantonTx

/** Parameters for executing `setRateLimitConfig`. */
export type ExecuteSetRateLimitConfigParams = CantonExecuteParams<SetRateLimitConfigParams>

/** Result of executing `setRateLimitConfig`. */
export type ExecuteSetRateLimitConfigResult = CantonTransactionResult & {
  /** New RateLimiter contract ID (nonconsuming choice → new limiter CID). */
  rateLimiterCid: string
}

/** Pool `setRateLimitConfig` operation. */
export class SetRateLimitConfig extends CantonOperation<SetRateLimitConfigParams> {
  readonly name = 'setRateLimitConfig'

  /** Validates the pool/limiter targets and mirrors the on-ledger config constraints. */
  protected override prepare(
    p: GenerateSetRateLimitConfigParams,
  ): GenerateSetRateLimitConfigParams {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        'pool InstanceAddress is required',
      )
    }
    parseRawInstanceAddress(this.name, 'rateLimiterInstanceAddress', p.rateLimiterInstanceAddress)
    if (p.capacity < 0n || p.rate < 0n) {
      throw new CCTParamsInvalidError(
        this.name,
        'capacity',
        'capacity and rate must be non-negative',
      )
    }
    if (p.isEnabled && p.rate > p.capacity) {
      throw new CCTParamsInvalidError(
        this.name,
        'rate',
        'an enabled config requires rate <= capacity (the choice rejects it)',
      )
    }
    if (!p.isEnabled && (p.capacity !== 0n || p.rate !== 0n)) {
      throw new CCTParamsInvalidError(
        this.name,
        'capacity',
        'a disabled config requires zero capacity and zero rate (the choice rejects it)',
      )
    }
    return p
  }

  /** Builds the `SetRateLimitConfig` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetRateLimitConfigParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )

    // The limiter's signatory is the pool owner, so its visibility follows the
    // pool owner party — decoded from the resolved pool contract.
    const poolOwner = extractFieldValue(decodeDamlRecord(contract.createArgument)['poolOwner'])
    if (typeof poolOwner !== 'string') {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        `pool ${p.poolInstanceAddress} has no decodable poolOwner`,
      )
    }
    const rateLimiter = await resolveRateLimiterRef(chain, poolOwner, p.rateLimiterInstanceAddress)

    const choiceArgument: SetRateLimitConfigArg = {
      caller: p.sender,
      rateLimiterCid: rateLimiter.contractId,
      newIsEnabled: p.isEnabled,
      newCapacity: p.capacity.toString(),
      newRate: p.rate.toString(),
    }

    return buildPoolExercise({
      choice: 'SetRateLimitConfig',
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      // The choice body exercises the limiter by CID — it must be disclosed.
      extraDisclosedContracts: [
        { ...rateLimiter, templateId: rateLimiter.templateId ?? RATE_LIMITER_TEMPLATE_ID },
      ],
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-rate-limit-config',
    })
  }

  override async execute(
    chain: CantonChain,
    params: ExecuteSetRateLimitConfigParams,
  ): Promise<ExecuteSetRateLimitConfigResult> {
    const base = await super.execute(chain, params)
    const rateLimiterCid = extractExerciseResult(base.response, 'SetRateLimitConfig')
    if (typeof rateLimiterCid !== 'string') {
      throw new CCTTxFailedError(
        this.name,
        'SetRateLimitConfig exerciseResult was not a contract ID',
        { context: { updateId: base.hash } },
      )
    }
    return { ...base, rateLimiterCid }
  }
}
