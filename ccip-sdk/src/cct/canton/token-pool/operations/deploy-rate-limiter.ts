/**
 * deployRateLimiter — deploy a `RateLimiter` contract for a pool as a bare
 * contract `create` (no factory). The RateLimiter template's only signatory is
 * `poolOwner`, so the owner authorizes the create alone and `generate()` is
 * fully offline (no ACS reads, no disclosures).
 *
 * Two limiters per remote chain are needed before `applyChainUpdates` (inbound
 * + outbound — the choice asserts they are non-empty and distinct).
 *
 * Record mirrors `mkRateLimiterContract` in `CCIP.FactoryV2`: `tokens`
 * initialized to `capacity`, `lastUpdated` to now.
 *
 * This deploys a STANDALONE `RateLimiter`, for lanes added after a pool's
 * initial `Initialize` call (see `deploy-token-pool.ts`, which deploys the
 * first lanes' rate limiters atomically). Registry-pool `RateLimiter`s require
 * a non-empty `observers`, same as the pool itself.
 *
 * @packageDocumentation
 */

import type { RateLimiter as RateLimiterArg } from '../../../../canton/bindings/ccip-registry-rate-limiter-v2-2.0.1/lib/CCIP/Registry/RateLimiterV2/module.js'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { damlTimeNow, encodeRateLimitDirection, encodeRateLimitMode } from '../../encoding.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
} from '../../operation.ts'
import type { CantonDeployResult } from '../../types.ts'
import { parsePartyId } from '../../validate.ts'
import { RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'

/** Parameters shared by `deployRateLimiter` generation and execution. */
export interface DeployRateLimiterParams {
  /** Rate-limiter instance ID (unique; derives the instance address). */
  instanceId: string
  /** Instance ID of the pool this limiter serves. */
  poolInstanceId: string
  /** Pool owner party ID (signatory of the RateLimiter contract). */
  poolOwner: string
  /** Remote chain selector this limiter applies to. */
  remoteChainSelector: bigint
  /** Direction the limiter applies to. */
  direction: 'inbound' | 'outbound'
  /** Finality mode (default: `defaultFinality`). */
  mode?: 'defaultFinality' | 'customFinality'
  /** Whether the limiter starts enabled. */
  isEnabled: boolean
  /** Bucket capacity (max tokens). */
  capacity: bigint
  /** Refill rate (tokens per second). */
  rate: bigint
  /**
   * Observer parties for EDS auto-detection. Mandatory — the on-ledger
   * `ensure` clause rejects an empty list.
   */
  observers: string[]
}

/** Parameters for unsigned `deployRateLimiter` generation. */
export type GenerateDeployRateLimiterParams = CantonGenerateParams<DeployRateLimiterParams>

/** Unsigned `deployRateLimiter` result. */
export type GenerateDeployRateLimiterResult = UnsignedCantonTx

/** Parameters for executing `deployRateLimiter`. */
export type ExecuteDeployRateLimiterParams = CantonExecuteParams<DeployRateLimiterParams>

/** Result of executing `deployRateLimiter`. */
export type ExecuteDeployRateLimiterResult = CantonDeployResult

/** CCIPFactory `deployRateLimiter` operation. */
export class DeployRateLimiter extends CantonOperation<DeployRateLimiterParams> {
  readonly name = 'deployRateLimiter'

  /** Validates IDs, parties, and numeric config. */
  protected override validate(p: GenerateDeployRateLimiterParams): void {
    if (!p.instanceId) {
      throw new CCTParamsInvalidError(
        this.name,
        'instanceId',
        'rate-limiter instance ID is required',
      )
    }
    if (!p.poolInstanceId) {
      throw new CCTParamsInvalidError(this.name, 'poolInstanceId', 'pool instance ID is required')
    }
    parsePartyId(this.name, 'poolOwner', p.poolOwner)
    if (p.capacity < 0n || p.rate < 0n) {
      throw new CCTParamsInvalidError(
        this.name,
        'capacity',
        'capacity and rate must be non-negative',
      )
    }
    if (!p.observers || p.observers.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'observers',
        'at least one observer is required (the on-ledger ensure clause rejects an empty list)',
      )
    }
    p.observers.forEach((o, i) => parsePartyId(this.name, `observers[${i}]`, o))
  }

  /**
   * Builds the bare RateLimiter `CreateCommand`. No chain access — a create
   * has no input contracts, so there is nothing to resolve or disclose.
   */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<DeployRateLimiterParams>,
  ): Promise<JsCommands> {
    // Mirrors mkRateLimiterContract: tokens = capacity, lastUpdated = now.
    const createArguments: RateLimiterArg = {
      instanceId: p.instanceId,
      poolInstanceId: p.poolInstanceId,
      poolOwner: p.poolOwner,
      remoteChainSelector: p.remoteChainSelector.toString(),
      direction: encodeRateLimitDirection(p.direction),
      mode: encodeRateLimitMode(p.mode ?? 'defaultFinality'),
      isEnabled: p.isEnabled,
      capacity: p.capacity.toString(),
      rate: p.rate.toString(),
      tokens: p.capacity.toString(),
      lastUpdated: damlTimeNow(),
      observers: p.observers,
    }

    return {
      commands: [
        {
          CreateCommand: {
            templateId: RATE_LIMITER_TEMPLATE_ID,
            createArguments,
          },
        },
      ],
      commandId: `cct-deploy-rate-limiter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // poolOwner is the RateLimiter's sole signatory — it alone authorizes the create.
      actAs: [p.poolOwner],
      // Bare create — the contract is new, nothing to disclose.
      disclosedContracts: [],
    }
  }
}
