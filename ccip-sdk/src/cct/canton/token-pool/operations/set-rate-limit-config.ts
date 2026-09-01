/**
 * setRateLimitConfig — set the rate-limit config for a remote chain on a token
 * pool via the `SetRateLimitConfig` choice (delegates to `RateLimiterV2`).
 *
 * The Daml choice takes
 * `{ caller, rateLimiterCid, newIsEnabled, newCapacity, newRate }` — the rate limiter is addressed by CONTRACT ID, so this op
 * resolves the limiter's `InstanceAddress` to a CID (+ disclosure blob) via
 * the ACS first. One choice per direction; each direction has its own
 * RateLimiter contract (they must be distinct — `ApplyChainUpdates` enforces
 * it).
 *
 * @packageDocumentation
 */

import type { SetRateLimitConfig as SetRateLimitConfigArg } from '../../../../canton/bindings/ccip-registry-burn-mint-token-pool-v2-2.1.1/lib/CCIP/Registry/BurnMintTokenPoolV2/module.js'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
} from '../../operation.ts'
import type { CantonTransactionResult } from '../../types.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
  RATE_LIMITER_TEMPLATE_ID,
  buildPoolExercise,
  resolvePoolRef,
  resolveRateLimiterRef,
} from '../shared.ts'

/** Rate-limit config for one direction (capacity + refill rate + enabled flag + limiter). */
export interface RateLimitConfig {
  /** Rate-limiter contract instance address for this direction. */
  rateLimiterInstanceAddress: string
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

  /** Validates the pool target and rate-limiter addresses. */
  protected override validate(p: GenerateSetRateLimitConfigParams): void {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        'pool InstanceAddress is required',
      )
    }
    if (!p.inbound && !p.outbound) {
      throw new CCTParamsInvalidError(
        this.name,
        'inbound',
        'at least one of inbound or outbound rate-limit config must be provided',
      )
    }
    for (const [dir, cfg] of [
      ['inbound', p.inbound],
      ['outbound', p.outbound],
    ] as const) {
      if (cfg && !cfg.rateLimiterInstanceAddress) {
        throw new CCTParamsInvalidError(
          this.name,
          `${dir}.rateLimiterInstanceAddress`,
          'rate-limiter instance address is required',
        )
      }
    }
  }

  /** Builds the `SetRateLimitConfig` exercise command(s) against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<SetRateLimitConfigParams>,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

    const poolContract = await resolvePoolRef(chain, p.poolType, p.sender, p.poolInstanceAddress)

    // The Daml choice sets one direction per call (caller + rateLimiterCid +
    // newIsEnabled/newCapacity/newRate); emit one command per provided
    // direction. The limiter contract is resolved to a CID and disclosed (the
    // choice body exercises it).
    const commands: JsCommands[] = []
    const buildOne = async (cfg: RateLimitConfig): Promise<JsCommands> => {
      const rateLimiter = await resolveRateLimiterRef(
        chain,
        p.sender,
        cfg.rateLimiterInstanceAddress,
      )
      const choiceArgument: SetRateLimitConfigArg = {
        caller: p.sender,
        rateLimiterCid: rateLimiter.contractId,
        newIsEnabled: cfg.enabled,
        newCapacity: cfg.capacity.toString(),
        newRate: cfg.rate.toString(),
      }
      return buildPoolExercise({
        choice: 'SetRateLimitConfig',
        templateId,
        poolContract,
        // Use the rate limiter's CONCRETE package-ID template (from the ACS) —
        // the symbolic `#…` form is rejected by interactive-submission prepare.
        extraDisclosedContracts: [
          { templateId: rateLimiter.templateId ?? RATE_LIMITER_TEMPLATE_ID, ...rateLimiter },
        ],
        choiceArgument,
        actAs: [p.sender],
        commandIdPrefix: 'cct-set-rate-limit-config',
      })
    }

    if (p.inbound) commands.push(await buildOne(p.inbound))
    if (p.outbound) commands.push(await buildOne(p.outbound))

    // Merge into a single JsCommands payload (one submission, multiple exercises).
    if (commands.length === 1) return commands[0]!
    return {
      commands: commands.flatMap((c) => c.commands),
      commandId: `cct-set-rate-limit-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actAs: [p.sender],
      disclosedContracts: commands.flatMap((c) => c.disclosedContracts ?? []),
    }
  }
}
