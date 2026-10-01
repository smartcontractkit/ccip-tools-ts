/**
 * applyChainUpdates — add and/or remove remote-chain configs on a token pool via
 * the `ApplyChainUpdates` choice (a consuming choice that returns a new pool CID).
 *
 * The pool is resolved by its `InstanceAddress` alone: one ACS query covers
 * both pool templates, and the pool type is read off the matched contract.
 *
 * Ported from the Go exerciser
 * (`chainlink-canton-fcr/deployment/operations/ccip/burn_mint_token_pool/burn_mint_token_pool.go`).
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { ApplyChainUpdatesArg } from '../../daml-types.ts'
import { type FinalityConfig, encodeFinalityConfig, rawInstanceAddress } from '../../encoding.ts'
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
  buildPoolExercise,
  encodeRemoteAddress,
  parseLaneRemoteAddresses,
  resolvePool,
  toContractRef,
} from '../shared.ts'

/** A single remote-chain config to add to the pool. */
export interface ChainUpdate {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /**
   * Remote pool addresses in the remote chain's own format, like
   * `remoteTokenAddress`; unique within the lane (compared by canonical
   * spelling, so two spellings of one address collide).
   */
  remotePools: string[]
  /**
   * Remote token address in the remote chain's own format (`0x…` for EVM,
   * base58 for Solana, …), the family taken from `remoteChainSelector`. Stored
   * on-ledger as 32-byte left-padded hex (see `normalizeRemoteAddress`).
   */
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
   * Inbound custom-block-confirmations rate-limiter raw instance address — the
   * bucket faster-than-finality inbound transfers draw on. Required when
   * `finalityConfig` is faster than finality (`WaitForSafe` or `BlockDepth`);
   * may be omitted (stored empty) for `WaitForFinality`.
   */
  inboundCustomBlockConfirmationsRateLimiter?: string
  /** Outbound rate-limiter raw instance address. Required, distinct from inbound. */
  outboundRateLimiter: string
}

/** Parameters shared by `applyChainUpdates` generation and execution. */
export interface ApplyChainUpdatesParams {
  /**
   * Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of
   * either pool type — the type is read off the resolved contract.
   */
  poolInstanceAddress: string
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

  /**
   * Validates the pool target, that at least one add/remove is specified, and
   * each added lane's rate-limiter references.
   */
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
      parseRawInstanceAddress(
        this.name,
        `chainsToAdd[${i}].inboundRateLimiter`,
        c.inboundRateLimiter,
      )
      parseRawInstanceAddress(
        this.name,
        `chainsToAdd[${i}].outboundRateLimiter`,
        c.outboundRateLimiter,
      )
      // Faster-than-finality inbound transfers draw on the custom-finality
      // limiter, so a lane that allows them must reference one.
      const finality = c.finalityConfig?.type ?? 'WaitForFinality'
      if (c.inboundCustomBlockConfirmationsRateLimiter) {
        parseRawInstanceAddress(
          this.name,
          `chainsToAdd[${i}].inboundCustomBlockConfirmationsRateLimiter`,
          c.inboundCustomBlockConfirmationsRateLimiter,
        )
      } else if (finality !== 'WaitForFinality') {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].inboundCustomBlockConfirmationsRateLimiter`,
          `is required when finalityConfig is faster than finality (got ${finality})`,
        )
      }
    }
  }

  /**
   * Parses each added lane's remote token + pool addresses, in the remote
   * chain's own format, into their canonical spellings.
   */
  protected override parse(p: GenerateApplyChainUpdatesParams): GenerateApplyChainUpdatesParams {
    if (!p.chainsToAdd) return p
    return {
      ...p,
      chainsToAdd: p.chainsToAdd.map((c, i) =>
        parseLaneRemoteAddresses(this.name, `chainsToAdd[${i}]`, c),
      ),
    }
  }

  /** Resolves the pool (either type), then builds the `ApplyChainUpdates` exercise command. */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<ApplyChainUpdatesParams>,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )

    // RawInstanceAddress newtypes encode as {unpack: raw}; FinalityConfig is a
    // Daml variant ({tag, value}).
    const choiceArgument: ApplyChainUpdatesArg = {
      remoteChainSelectorsToRemove: (p.remoteChainSelectorsToRemove ?? []).map((s) => s.toString()),
      chainsToAdd: (p.chainsToAdd ?? []).map((c) => ({
        remoteChainSelector: c.remoteChainSelector.toString(),
        remotePools: c.remotePools.map(encodeRemoteAddress),
        remoteTokenAddress: encodeRemoteAddress(c.remoteTokenAddress),
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
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-apply-chain-updates',
    })
  }

  override async execute(
    chain: CantonChain,
    params: ExecuteApplyChainUpdatesParams,
  ): Promise<ExecuteApplyChainUpdatesResult> {
    const base = await super.execute(chain, params)
    const poolCid = extractExerciseResult(base.response, 'ApplyChainUpdates')
    if (typeof poolCid !== 'string') {
      throw new CCTTxFailedError(
        this.name,
        'ApplyChainUpdates exerciseResult was not a contract ID',
        { context: { updateId: base.hash } },
      )
    }
    return { ...base, poolCid }
  }
}
