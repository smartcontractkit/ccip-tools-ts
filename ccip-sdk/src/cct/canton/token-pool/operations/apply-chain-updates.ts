/**
 * applyChainUpdates — add and/or remove remote-chain configs on a token pool via
 * the `ApplyChainUpdates` choice (a consuming choice that returns a new pool CID).
 *
 * Ported from the Go exerciser
 * (`chainlink-canton-fcr/deployment/operations/ccip/burn_mint_token_pool/burn_mint_token_pool.go`).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTransactionResult } from '../../types.ts'
import { type CantonExecuteParams, CantonOperation } from '../../operation.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseContractCid } from '../../validate.ts'
import { buildPoolExercise } from '../shared.ts'

/** A single remote-chain config to add to the pool. */
export interface ChainUpdate {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /** Remote pool addresses (encoded). */
  remotePools: string[]
  /** Remote token address (encoded instrument ID). */
  remoteTokenAddress: string
  /** Inbound committee-verifier instance addresses. */
  inboundCCVs?: string[]
  /** Outbound committee-verifier instance addresses. */
  outboundCCVs?: string[]
  /** Finality config (default vs custom block confirmations). */
  finalityConfig?: { type: string; [k: string]: unknown }
  /** Inbound rate-limiter instance address. */
  inboundRateLimiter?: string
  /** Inbound custom-block-confirmations rate-limiter instance address. */
  inboundCustomBlockConfirmationsRateLimiter?: string
  /** Outbound rate-limiter instance address. */
  outboundRateLimiter?: string
}

/** Parameters shared by `applyChainUpdates` generation and execution. */
export interface ApplyChainUpdatesParams {
  /** Pool contract ID. */
  poolCid: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
  /** Remote chain selectors to remove from the pool config. */
  remoteChainSelectorsToRemove?: bigint[]
  /** Remote chain configs to add to the pool config. */
  chainsToAdd?: ChainUpdate[]
}

/** Parameters for unsigned `applyChainUpdates` generation. */
export type GenerateApplyChainUpdatesParams = CantonExecuteParams<ApplyChainUpdatesParams>

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

  /** Validates the pool CID and that at least one add/remove is specified. */
  protected override validate(p: GenerateApplyChainUpdatesParams): void {
    parseContractCid(this.name, 'poolCid', p.poolCid)
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
    }
  }

  /** Builds the `ApplyChainUpdates` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonExecuteParams<ApplyChainUpdatesParams>,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint'
        ? '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
        : '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'

    const choiceArgument: Record<string, unknown> = {
      remoteChainSelectorsToRemove: (p.remoteChainSelectorsToRemove ?? []).map((s) => s.toString()),
      chainsToAdd: (p.chainsToAdd ?? []).map((c) => ({
        remoteChainSelector: c.remoteChainSelector.toString(),
        remotePools: c.remotePools,
        remoteTokenAddress: c.remoteTokenAddress,
        inboundCCVs: c.inboundCCVs ?? [],
        outboundCCVs: c.outboundCCVs ?? [],
        finalityConfig: c.finalityConfig ?? { type: 'WaitForFinality' },
        inboundRateLimiter: c.inboundRateLimiter ?? '',
        inboundCustomBlockConfirmationsRateLimiter: c.inboundCustomBlockConfirmationsRateLimiter ?? '',
        outboundRateLimiter: c.outboundRateLimiter ?? '',
      })),
    }

    return buildPoolExercise({
      choice: 'ApplyChainUpdates',
      templateId,
      poolCid: p.poolCid,
      choiceArgument,
      actAs: [p.wallet.party],
      commandIdPrefix: 'cct-apply-chain-updates',
    })
  }
}
