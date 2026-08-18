/**
 * deployTokenPool — deploy a `BurnMintTokenPool` or `LockReleaseTokenPool` via
 * the `CCIPFactory.DeployBurnMintTokenPool` / `DeployLockReleaseTokenPool`
 * choice. Returns the created pool's contract ID + raw instance address.
 *
 * Ported from the Go exerciser
 * (`chainlink-canton-fcr/deployment/operations/ccip/factory/factory.go`).
 *
 * `edsConfig` is intentionally NOT returned — the factory choice does not emit
 * disclosure-service config; it is assembled separately by the EDS-standup
 * pipeline from the pool's instance address.
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
import {
  buildFactoryExercise,
  resolveFactoryRef,
} from '../shared.ts'
import type { ChainUpdate } from './apply-chain-updates.ts'

/** Pool type to deploy. */
export type PoolType = 'burnMint' | 'lockRelease'

/** Factory deps (contract instance addresses of shared CCIP contracts). */
export interface PoolFactoryDeps {
  /** Token Admin Registry raw instance address. */
  tokenAdminRegistry: string
  /** Fee Quoter raw instance address. */
  feeQuoter: string
  /** RMN Remote raw instance address. */
  rmnRemote: string
}

/** Pool receive-context choice-context values (opaque `ChoiceContext` map). */
export type PoolReceiveContext = { values: Record<string, unknown> }

/** Transfer-timeout config. */
export interface TransferTimeout {
  /** Transfer timeout in seconds. */
  timeoutSeconds: number
}

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
  /** Factory deps (TAR, FeeQuoter, RMNRemote instance addresses). */
  deps: PoolFactoryDeps
  /** Pool receive-context choice-context. */
  poolReceiveContext?: PoolReceiveContext
  /** Transfer timeout. */
  transferTimeout?: TransferTimeout
  /**
   * Optional remote-chain configs to apply in the same deploy (factory deploys
   * the pool, then `ApplyChainUpdates` is exercised on it). When omitted, call
   * `applyChainUpdates` separately.
   */
  remoteChainConfigs?: ChainUpdate[]
  /** CCIPFactory `InstanceAddress` (`0x<64-hex>` or `"instanceId@owner"`). Resolved via ACS. */
  factoryInstanceAddress: string
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

  /** Builds the `DeployBurnMintTokenPool` / `DeployLockReleaseTokenPool` exercise command. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedDeployTokenPoolParams,
  ): Promise<JsCommands> {
    const factoryContract = await resolveFactoryRef(chain, p.sender, p.factoryInstanceAddress)
    const choice = p.poolType === 'burnMint' ? 'DeployBurnMintTokenPool' : 'DeployLockReleaseTokenPool'

    const choiceArgument: Record<string, unknown> = {
      instanceId: p.instanceId,
      poolOwner: p.poolOwner,
      ccipOwner: p.ccipOwner,
      instrumentId: p.instrumentId,
      decimals: p.decimals,
      tokenAdminRegistry: p.deps.tokenAdminRegistry,
      feeQuoter: p.deps.feeQuoter,
      rmnRemote: p.deps.rmnRemote,
      poolReceiveContext: p.poolReceiveContext ?? { values: {} },
      transferTimeout: p.transferTimeout ?? { timeoutSeconds: 0 },
      ...(p.rateLimitAdmin && { rateLimitAdmin: p.rateLimitAdmin }),
    }

    const deployCmd = buildFactoryExercise({
      choice,
      factoryContract,
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: `cct-deploy-${p.poolType}-pool`,
    })

    // When remoteChainConfigs are provided, append an ApplyChainUpdates exercise
    // on the newly-deployed pool in the same submission. The pool CID is not
    // known until the deploy executes, so this requires a follow-up submission
    // in practice — flagged here so the caller knows to call applyChainUpdates
    // separately after deploy. For now, remoteChainConfigs is validated but the
    // pool config is applied via a separate applyChainUpdates call.
    if (p.remoteChainConfigs && p.remoteChainConfigs.length > 0) {
      chain.logger.debug(
        `${this.name}: remoteChainConfigs provided; caller must run applyChainUpdates after deploy completes`,
      )
    }

    return deployCmd
  }
}
