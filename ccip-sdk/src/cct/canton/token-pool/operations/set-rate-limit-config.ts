/**
 * setRateLimitConfig — set the rate-limit config for a remote chain on a token
 * pool via the `SetRateLimitConfig` choice (delegates to `RateLimiterV2`).
 *
 * Ported from the Go exerciser (`burn_mint_token_pool.go` `SetRateLimitConfig`).
 * The Go choice arg is `SetRateLimitConfigParams { caller, rateLimiterInstanceAddress,
 * newIsEnabled, newCapacity, newRate }`.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTransactionResult } from '../../types.ts'
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { buildPoolExercise, resolvePoolRef } from '../shared.ts'

/** Rate-limit config for one direction (capacity + refill rate + enabled flag). */
export interface RateLimitConfig {
  /** Bucket capacity (max tokens). */
  capacity: bigint
  /** Refill rate (tokens per second). */
  rate: bigint
  /** Whether the rate limiter is enabled. */
  enabled: boolean
}

/** Parameters shared by `setRateLimitConfig` generation and execution. */
export interface SetRateLimitConfigParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`). */
  poolInstanceAddress: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
  /** Remote chain selector the rate limit applies to. */
  remoteChainSelector: bigint
  /** Rate-limiter contract instance address for the target remote chain. */
  rateLimiterInstanceAddress: string
  /** Inbound rate-limit config. */
  inbound?: RateLimitConfig
  /** Outbound rate-limit config. */
  outbound?: RateLimitConfig
}

/** Parameters for unsigned `setRateLimitConfig` generation. */
export type GenerateSetRateLimitConfigParams = CantonGenerateParams<SetRateLimitConfigParams>

/** Unsigned `setRateLimitConfig` result. */
export type GenerateSetRateLimitConfigResult = UnsignedCantonTx

/** Parameters for executing `setRateLimitConfig`. */
export type ExecuteSetRateLimitConfigParams = CantonExecuteParams<SetRateLimitConfigParams>

/** Result of executing `setRateLimitConfig`. */
export type ExecuteSetRateLimitConfigResult = CantonTransactionResult & {
  /** Rate-limiter contract ID (unchanged; surfaced for follow-on ops). */
  rateLimiterCid: string
}

/** Pool `setRateLimitConfig` operation. */
export class SetRateLimitConfig extends CantonOperation<SetRateLimitConfigParams> {
  readonly name = 'setRateLimitConfig'

  /** Validates the pool target and rate-limiter address. */
  protected override validate(p: GenerateSetRateLimitConfigParams): void {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(this.name, 'poolInstanceAddress', 'pool InstanceAddress is required')
    }
    if (!p.rateLimiterInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'rateLimiterInstanceAddress',
        'rate-limiter instance address is required',
      )
    }
    if (!p.inbound && !p.outbound) {
      throw new CCTParamsInvalidError(
        this.name,
        'inbound',
        'at least one of inbound or outbound rate-limit config must be provided',
      )
    }
  }

  /** Builds the `SetRateLimitConfig` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<SetRateLimitConfigParams>,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint'
        ? '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
        : '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'

    const poolContract = await resolvePoolRef(chain, p.poolType, p.sender, p.poolInstanceAddress)

    // The Go choice sets one direction per call (caller + rateLimiterInstanceAddress +
    // newIsEnabled/newCapacity/newRate). The facade accepts both directions and emits
    // two commands when both are provided.
    const commands: JsCommands[] = []
    const buildOne = (cfg: RateLimitConfig): JsCommands =>
      buildPoolExercise({
        choice: 'SetRateLimitConfig',
        templateId,
        poolContract,
        choiceArgument: {
          caller: p.sender,
          rateLimiterInstanceAddress: p.rateLimiterInstanceAddress,
          newIsEnabled: cfg.enabled,
          newCapacity: cfg.capacity.toString(),
          newRate: cfg.rate.toString(),
        },
        actAs: [p.sender],
        commandIdPrefix: 'cct-set-rate-limit-config',
      })

    if (p.inbound) commands.push(buildOne(p.inbound))
    if (p.outbound) commands.push(buildOne(p.outbound))

    // Merge into a single JsCommands payload (one submission, multiple exercises).
    if (commands.length === 1) return commands[0]!
    return {
      commands: commands.flatMap((c) => c.commands),
      commandId: `cct-set-rate-limit-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [p.sender],
      disclosedContracts: commands[0]!.disclosedContracts,
    }
  }
}
