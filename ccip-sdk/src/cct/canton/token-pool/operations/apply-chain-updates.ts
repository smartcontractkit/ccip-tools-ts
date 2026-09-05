/**
 * applyChainUpdates — add and/or remove remote-chain configs on a token pool via
 * the `ApplyChainUpdates` choice (a consuming choice that returns a new pool CID).
 *
 * Ported from the Go exerciser
 * (`chainlink-canton-fcr/deployment/operations/ccip/burn_mint_token_pool/burn_mint_token_pool.go`).
 *
 * @packageDocumentation
 */

import type { ApplyChainUpdates as ApplyChainUpdatesArg } from '../../../../canton/bindings/ccip-registry-burn-mint-token-pool-v2-2.1.1/lib/CCIP/Registry/BurnMintTokenPoolV2/module.js'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type FinalityConfig, encodeFinalityConfig, rawInstanceAddress } from '../../encoding.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
} from '../../operation.ts'
import type { CantonTransactionResult } from '../../types.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
  buildPoolExercise,
  resolvePoolRef,
} from '../shared.ts'

/** A single remote-chain config to add to the pool. */
export interface ChainUpdate {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /** Remote pool addresses (encoded). */
  remotePools: string[]
  /** Remote token address (encoded instrument ID). */
  remoteTokenAddress: string
  /** Inbound committee-verifier raw instance addresses (`"instanceId@party"`). */
  inboundCCVs?: string[]
  /** Outbound committee-verifier raw instance addresses (`"instanceId@party"`). */
  outboundCCVs?: string[]
  /** Finality config (default: `WaitForFinality`). */
  finalityConfig?: FinalityConfig
  /**
   * Inbound rate-limiter raw instance address (`"instanceId@party"`).
   * Required by the choice (must be non-empty and distinct from outbound).
   */
  inboundRateLimiter: string
  /**
   * Inbound custom-block-confirmations rate-limiter raw instance address.
   * Required when `finalityConfig` is faster than finality.
   */
  inboundCustomBlockConfirmationsRateLimiter?: string
  /** Outbound rate-limiter raw instance address. Required, distinct from inbound. */
  outboundRateLimiter: string
}

/** Parameters shared by `applyChainUpdates` generation and execution. */
export interface ApplyChainUpdatesParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`). */
  poolInstanceAddress: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
  /** Remote chain selectors to remove from the pool config. */
  remoteChainSelectorsToRemove?: bigint[]
  /** Remote chain configs to add to the pool config. */
  chainsToAdd?: ChainUpdate[]
}

/** Parameters for unsigned `applyChainUpdates` generation. */
export type GenerateApplyChainUpdatesParams = CantonGenerateParams<ApplyChainUpdatesParams>

/** Unsigned `applyChainUpdates` result. */
export type GenerateApplyChainUpdatesResult = UnsignedCantonTx

/** Parameters for executing `applyChainUpdates`. */
export type ExecuteApplyChainUpdatesParams = CantonExecuteParams<ApplyChainUpdatesParams>

/** Result of executing `applyChainUpdates`. */
export type ExecuteApplyChainUpdatesResult = CantonTransactionResult & {
  /** New pool contract ID (consuming choice → new CID). */
  poolCid: string
}

/** Pool `applyChainUpdates` operation. */
export class ApplyChainUpdates extends CantonOperation<ApplyChainUpdatesParams> {
  readonly name = 'applyChainUpdates'

  /** Validates the pool target and that at least one add/remove is specified. */
  protected override validate(p: GenerateApplyChainUpdatesParams): void {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        'pool InstanceAddress is required',
      )
    }
    if (
      (!p.remoteChainSelectorsToRemove || p.remoteChainSelectorsToRemove.length === 0) &&
      (!p.chainsToAdd || p.chainsToAdd.length === 0)
    ) {
      throw new CCTParamsInvalidError(
        this.name,
        'chainsToAdd',
        'at least one of remoteChainSelectorsToRemove or chainsToAdd must be provided',
      )
    }
    for (const [i, c] of (p.chainsToAdd ?? []).entries()) {
      if (!c.remoteChainSelector) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remoteChainSelector`,
          'remote chain selector is required',
        )
      }
      if (!c.remoteTokenAddress) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remoteTokenAddress`,
          'remote token address is required',
        )
      }
      // Mirrors the on-ledger assertDistinctRateLimiters: inbound/outbound must
      // be present and distinct.
      if (!c.inboundRateLimiter || !c.outboundRateLimiter) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].inboundRateLimiter`,
          'inbound and outbound rate limiters are required (the choice rejects empty ones)',
        )
      }
      if (c.inboundRateLimiter === c.outboundRateLimiter) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].outboundRateLimiter`,
          'inbound and outbound rate limiters must be distinct',
        )
      }
    }
  }

  /** Builds the `ApplyChainUpdates` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<ApplyChainUpdatesParams>,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

    const poolContract = await resolvePoolRef(chain, p.poolType, p.sender, p.poolInstanceAddress)

    // RawInstanceAddress newtypes encode as {unpack: raw}; FinalityConfig is a
    // Daml variant ({tag, value}).
    const choiceArgument: ApplyChainUpdatesArg = {
      remoteChainSelectorsToRemove: (p.remoteChainSelectorsToRemove ?? []).map((s) => s.toString()),
      chainsToAdd: (p.chainsToAdd ?? []).map((c) => ({
        remoteChainSelector: c.remoteChainSelector.toString(),
        remotePools: c.remotePools,
        remoteTokenAddress: c.remoteTokenAddress,
        inboundCCVs: (c.inboundCCVs ?? []).map(rawInstanceAddress),
        outboundCCVs: (c.outboundCCVs ?? []).map(rawInstanceAddress),
        finalityConfig: encodeFinalityConfig(c.finalityConfig ?? { type: 'WaitForFinality' }),
        inboundRateLimiter: rawInstanceAddress(c.inboundRateLimiter),
        inboundCustomBlockConfirmationsRateLimiter: rawInstanceAddress(
          c.inboundCustomBlockConfirmationsRateLimiter ?? '',
        ),
        outboundRateLimiter: rawInstanceAddress(c.outboundRateLimiter),
      })),
    }

    return buildPoolExercise({
      choice: 'ApplyChainUpdates',
      templateId,
      poolContract,
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-apply-chain-updates',
    })
  }
}
