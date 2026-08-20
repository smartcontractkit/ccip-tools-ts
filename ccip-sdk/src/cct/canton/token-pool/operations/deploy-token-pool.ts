/**
 * deployTokenPool — deploy a `BurnMintTokenPool` or `LockReleaseTokenPool` as
 * a bare contract `create` (no factory). The pool template's only signatory is
 * `poolOwner`, so the owner party authorizes the create alone — and since a
 * create has no input contracts, `generate()` is fully OFFLINE (no ACS reads,
 * no disclosures), matching the EVM/Solana generate model.
 *
 * On-ledger `ensure` constraints: `instrumentId.admin == poolOwner`, valid
 * `instanceId`, valid token `decimals`.
 *
 * `edsConfig` is intentionally NOT returned — it is assembled separately by
 * the EDS-standup pipeline from the pool's instance address.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { CantonWallet, UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonDeployResult } from '../../types.ts'
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseInstrumentId, parsePartyId } from '../../validate.ts'
import { type TransferTimeout } from '../../encoding.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  buildPoolCreateArguments,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
} from '../shared.ts'
import type { ChainUpdate } from './apply-chain-updates.ts'

/** Pool type to deploy. */
export type PoolType = 'burnMint' | 'lockRelease'

/**
 * Factory deps — the shared CCIP contracts the pool references, as
 * `RawInstanceAddress` RAW strings (`"instanceId@party"`, NOT the hashed
 * `0x…` form — the hash is one-way and the choice stores the raw value).
 */
export interface PoolFactoryDeps {
  /** Token Admin Registry raw instance address. */
  tokenAdminRegistry: string
  /** Fee Quoter raw instance address. */
  feeQuoter: string
  /** RMN Remote raw instance address. */
  rmnRemote: string
}

/**
 * Pool receive-context choice-context values. `ChoiceContext.values` is a
 * `GenMap` → encodes as a JSON array of entries; almost always empty (`[]`).
 */
export type PoolReceiveContext = { values: unknown[] }

/** Parameters shared by `deployTokenPool` generation and execution. */
export interface DeployTokenPoolParams {
  /** Pool type to deploy. */
  poolType: PoolType
  /** Pool instance ID (unique per pool; used to derive the pool instance address). */
  instanceId: string
  /** Pool owner party ID (`hint::1220…`) — must equal `instrumentId.admin`. */
  poolOwner: string
  /** CCIP owner party ID (the protocol-level owner). */
  ccipOwner: string
  /** Instrument to bridge (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Token decimals. */
  decimals: number
  /** Optional rate-limit admin party. */
  rateLimitAdmin?: string
  /** Factory deps (TAR, FeeQuoter, RMNRemote raw instance addresses). */
  deps: PoolFactoryDeps
  /** Pool receive-context choice-context. */
  poolReceiveContext?: PoolReceiveContext
  /** Transfer timeout (Daml variant; defaults to `RelativeHours 24`, matching Go). */
  transferTimeout?: TransferTimeout
  /**
   * Optional remote-chain configs — NOT applied at deploy; call
   * `applyChainUpdates` separately after the pool exists (and after deploying
   * its rate limiters).
   */
  remoteChainConfigs?: ChainUpdate[]
}

/** Parsed `deployTokenPool` params. */
type ParsedDeployTokenPoolParams = Omit<
  CantonGenerateParams<DeployTokenPoolParams>,
  'instrumentId'
> & {
  instrumentId: { admin: string; id: string }
}

/** Parameters for unsigned `deployTokenPool` generation. */
export type GenerateDeployTokenPoolParams = CantonGenerateParams<DeployTokenPoolParams>

/** Unsigned `deployTokenPool` result. */
export type GenerateDeployTokenPoolResult = UnsignedCantonTx

/** Parameters for executing `deployTokenPool`. */
export type ExecuteDeployTokenPoolParams = CantonExecuteParams<DeployTokenPoolParams>

/** Result of executing `deployTokenPool`. */
export type ExecuteDeployTokenPoolResult = CantonDeployResult

/** CCIPFactory `deployTokenPool` operation. */
export class DeployTokenPool extends CantonOperation<
  DeployTokenPoolParams,
  ParsedDeployTokenPoolParams
> {
  readonly name = 'deployTokenPool'

  /** Validates party IDs, instrument ID, instance ID, and decimals. */
  protected override validate(p: GenerateDeployTokenPoolParams): void {
    if (p.poolType !== 'burnMint' && p.poolType !== 'lockRelease') {
      throw new CCTParamsInvalidError(
        this.name,
        'poolType',
        `expected "burnMint" or "lockRelease", got "${p.poolType}"`,
      )
    }
    if (!p.instanceId) {
      throw new CCTParamsInvalidError(this.name, 'instanceId', 'pool instance ID is required')
    }
    parsePartyId(this.name, 'poolOwner', p.poolOwner)
    parsePartyId(this.name, 'ccipOwner', p.ccipOwner)
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    if (!Number.isInteger(p.decimals) || p.decimals < 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'decimals',
        `expected a non-negative integer, got ${p.decimals}`,
      )
    }
    if (p.rateLimitAdmin) parsePartyId(this.name, 'rateLimitAdmin', p.rateLimitAdmin)
    if (!p.deps?.tokenAdminRegistry) {
      throw new CCTParamsInvalidError(
        this.name,
        'deps.tokenAdminRegistry',
        'TAR instance address is required',
      )
    }
    if (!p.deps?.feeQuoter) {
      throw new CCTParamsInvalidError(this.name, 'deps.feeQuoter', 'FeeQuoter instance address is required')
    }
    if (!p.deps?.rmnRemote) {
      throw new CCTParamsInvalidError(this.name, 'deps.rmnRemote', 'RMNRemote instance address is required')
    }
  }

  /** Parses the instrument ID. */
  protected override parse(p: GenerateDeployTokenPoolParams): ParsedDeployTokenPoolParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
    }
  }

  /**
   * Builds the bare pool `CreateCommand`. No chain access — a create has no
   * input contracts, so there is nothing to resolve or disclose.
   */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedDeployTokenPoolParams,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

    if (p.remoteChainConfigs && p.remoteChainConfigs.length > 0) {
      chain.logger.debug(
        `${this.name}: remoteChainConfigs provided; caller must run applyChainUpdates after deploy completes`,
      )
    }

    return {
      commands: [
        {
          CreateCommand: {
            templateId,
            createArguments: buildPoolCreateArguments(p),
          },
        },
      ],
      commandId: `cct-deploy-${p.poolType}-pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // poolOwner is the pool's sole signatory — it alone authorizes the create.
      actAs: [p.poolOwner],
      // Bare create — the contract is new, nothing to disclose.
      disclosedContracts: [],
    }
  }
}
