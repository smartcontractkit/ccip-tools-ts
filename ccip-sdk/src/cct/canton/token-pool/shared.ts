/**
 * Shared helpers for token-pool CCT operations: CCIPFactory + BurnMint/LockRelease
 * pool exercise-command construction and pool contract resolution.
 *
 * @packageDocumentation
 */

import type {
  BurnMintTokenPool,
  Initialize as InitializeArg,
} from '../../../canton/bindings/ccip-registry-burn-mint-token-pool-v2-2.1.1/lib/CCIP/Registry/BurnMintTokenPoolV2/module.js'
import type {
  LaneDeploySpec as LaneDeploySpecArg,
  RateLimiterDeploySpec as RateLimiterDeploySpecArg,
} from '../../../canton/bindings/ccip-registry-burn-mint-token-pool-v2-2.1.1/lib/CCIP/Registry/BurnMintTokenPoolV2Types/module.js'
import type { JsCommands } from '../../../canton/client/index.ts'
import type { CantonActiveContract, CantonChain } from '../../../canton/index.ts'
import { getCantonNetworkConfig } from '../../../canton/networks.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import {
  type FinalityConfig,
  type TransferTimeout,
  EMPTY_CHOICE_CONTEXT,
  encodeFinalityConfig,
  encodeTransferTimeout,
  rawInstanceAddress,
} from '../encoding.ts'

/**
 * Pool receive-context choice-context values. `ChoiceContext.values` is a
 * `TextMap` → encodes as a JSON object; almost always empty (`{}`).
 */
export type PoolReceiveContext = { values: Record<string, unknown> }

/** CCIPFactory template ID. */
export const FACTORY_TEMPLATE_ID = '#ccip-factory-v2:CCIP.FactoryV2:CCIPFactory'

/**
 * BurnMintTokenPool template ID — the registry-pools family
 * (`CCIP.Registry.BurnMintTokenPoolV2`, package `ccip-registry-burn-mint-token-pool-v2`).
 * This is the ONLY BurnMintTokenPool family the SDK targets: it adds the
 * mandatory `observers` field (EDS auto-detection) and the atomic
 * `Initialize` choice the production-pools family (`CCIP.BurnMintTokenPoolV2`,
 * pre-registry) lacks. Nothing in this SDK should reference the production
 * package.
 */
export const BURN_MINT_POOL_TEMPLATE_ID =
  '#ccip-registry-burn-mint-token-pool-v2:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'

/** LockReleaseTokenPool template ID — registry-pools family (see {@link BURN_MINT_POOL_TEMPLATE_ID}). */
export const LOCK_RELEASE_POOL_TEMPLATE_ID =
  '#ccip-registry-lock-release-token-pool-v2:CCIP.Registry.LockReleaseTokenPoolV2:LockReleaseTokenPool'

/** RateLimiter template ID — registry-pools family (see {@link BURN_MINT_POOL_TEMPLATE_ID}). */
export const RATE_LIMITER_TEMPLATE_ID =
  '#ccip-registry-rate-limiter-v2:CCIP.Registry.RateLimiterV2:RateLimiter'

/** A contract reference for the exercise builders: a CID plus its disclosure blob. */
export interface PoolContractRef {
  /** Contract ID. */
  contractId: string
  /** `createdEventBlob` from the ACS (required for prepared/signed submission). */
  createdEventBlob: string
  /** Synchronizer the contract was read from. */
  synchronizerId: string
  /**
   * Concrete package-ID template ID (`<pkg-id>:<Module>:<Entity>`) as returned
   * by the ACS. Preferred over the symbolic `#<pkg-name>:…` form — the
   * participant's interactive-submission path rejects package-name references
   * (`#…`) in exercise commands
   * (`non expected character 0x23 in Daml-LF Package ID`). Populated by {@link resolvePoolRef} / {@link toContractRef}.
   */
  templateId?: string
}

/** Project a resolved {@link CantonActiveContract} into a {@link PoolContractRef}. */
export function toContractRef(contract: CantonActiveContract): PoolContractRef {
  return {
    contractId: contract.contractId,
    createdEventBlob: contract.createdEventBlob,
    synchronizerId: contract.synchronizerId,
    templateId: contract.templateId,
  }
}

/**
 * Shared CCIP singleton deps (TAR / FeeQuoter / RMNRemote raw instance
 * addresses) a pool references. All fields optional at the API surface —
 * unresolved fields fall back to the well-known per-network constants.
 */
export interface PoolFactoryDeps {
  /** Token Admin Registry raw instance address. */
  tokenAdminRegistry: string
  /** FeeQuoter raw instance address. */
  feeQuoter: string
  /** RMNRemote raw instance address. */
  rmnRemote: string
}

/**
 * Resolve pool factory deps: explicit per-field overrides win; missing fields
 * fall back to the well-known contracts registered for `chain.network.chainId`
 * (see {@link getCantonNetworkConfig}). Throws unless every field resolves.
 */
export function resolvePoolFactoryDeps(
  opName: string,
  chain: CantonChain,
  overrides?: Partial<PoolFactoryDeps>,
): PoolFactoryDeps {
  const chainId = String(chain.network.chainId)
  const wellKnown = getCantonNetworkConfig(chainId)
  const deps = {
    tokenAdminRegistry: overrides?.tokenAdminRegistry ?? wellKnown?.tokenAdminRegistry,
    feeQuoter: overrides?.feeQuoter ?? wellKnown?.feeQuoter,
    rmnRemote: overrides?.rmnRemote ?? wellKnown?.rmnRemote,
  }
  const missing = Object.entries(deps)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length > 0) {
    throw new CCTParamsInvalidError(
      opName,
      'deps',
      `missing ${missing.join(', ')} and no well-known contracts registered for network ` +
        `"${chainId}" — pass deps explicitly`,
    )
  }
  return deps as PoolFactoryDeps
}

/** Inputs to {@link buildFactoryExercise}. */
export interface BuildFactoryExerciseInput {
  /** CCIPFactory choice name (e.g. `DeployBurnMintTokenPool`, `DeployLockReleaseTokenPool`). */
  choice: string
  /** CCIPFactory contract reference (CID + disclosure blob). */
  factoryContract: PoolContractRef
  /** Daml choice argument record. */
  choiceArgument: Record<string, unknown>
  /** Acting party IDs (`actAs`). */
  actAs: string[]
  /** Command-ID prefix. */
  commandIdPrefix: string
}

/**
 * Build a `JsCommands` exercising a CCIPFactory choice. The factory contract is
 * disclosed alongside the command with its real `createdEventBlob` +
 * `synchronizerId` (fetched by {@link resolveFactoryRef} or supplied by the
 * caller).
 */
export function buildFactoryExercise(input: BuildFactoryExerciseInput): JsCommands {
  const { choice, factoryContract, choiceArgument, actAs, commandIdPrefix } = input
  return {
    commands: [
      {
        ExerciseCommand: {
          templateId: FACTORY_TEMPLATE_ID,
          contractId: factoryContract.contractId,
          choice,
          choiceArgument,
        },
      },
    ],
    commandId: `${commandIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs,
    disclosedContracts: [
      {
        templateId: FACTORY_TEMPLATE_ID,
        contractId: factoryContract.contractId,
        createdEventBlob: factoryContract.createdEventBlob,
        synchronizerId: factoryContract.synchronizerId,
      },
    ],
  }
}

/** Inputs to {@link buildPoolExercise}. */
export interface BuildPoolExerciseInput {
  /** Pool choice name (e.g. `ApplyChainUpdates`, `SetRateLimitConfig`, `SetDynamicConfig`). */
  choice: string
  /** Pool template ID (burn-mint or lock-release). */
  templateId: string
  /** Pool contract reference (CID + disclosure blob). */
  poolContract: PoolContractRef
  /**
   * Extra contracts to disclose alongside the pool (e.g. the RateLimiter for
   * `SetRateLimitConfig`, which the choice body exercises by CID).
   */
  extraDisclosedContracts?: Array<PoolContractRef & { templateId: string }>
  /** Daml choice argument record. */
  choiceArgument: Record<string, unknown>
  /** Acting party IDs (`actAs`). */
  actAs: string[]
  /** Command-ID prefix. */
  commandIdPrefix: string
}

/**
 * Build a `JsCommands` exercising a pool choice. The pool contract is disclosed
 * alongside the command with its real `createdEventBlob` + `synchronizerId`.
 */
export function buildPoolExercise(input: BuildPoolExerciseInput): JsCommands {
  const {
    choice,
    templateId,
    poolContract,
    extraDisclosedContracts,
    choiceArgument,
    actAs,
    commandIdPrefix,
  } = input
  // Prefer the concrete package-ID template from the resolved contract over
  // the symbolic `#<pkg-name>:…` form — the interactive-submission `prepare`
  // step rejects package-name references (`non expected character 0x23 in
  // Daml-LF Package ID`). The ACS / EDS return the concrete form; fall back to
  // the symbolic form only if the contract was supplied without one.
  const concreteTemplateId = poolContract.templateId ?? templateId
  return {
    commands: [
      {
        ExerciseCommand: {
          templateId: concreteTemplateId,
          contractId: poolContract.contractId,
          choice,
          choiceArgument,
        },
      },
    ],
    commandId: `${commandIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs,
    disclosedContracts: [
      {
        templateId: concreteTemplateId,
        contractId: poolContract.contractId,
        createdEventBlob: poolContract.createdEventBlob,
        synchronizerId: poolContract.synchronizerId,
      },
      ...(extraDisclosedContracts ?? []).map((c) => ({
        templateId: c.templateId,
        contractId: c.contractId,
        createdEventBlob: c.createdEventBlob,
        synchronizerId: c.synchronizerId,
      })),
    ],
  }
}

/**
 * Resolve a CCIPFactory contract reference by its `InstanceAddress` (the
 * canonical Canton resolution path). `factoryInstanceAddress` is either the
 * `0x<64-hex>` keccak256 hash or the `RawInstanceAddress` `"instanceId@owner"`
 * form. The SDK resolves the CID + disclosure blob together via
 * {@link CantonChain.findActiveContractByInstanceAddress}.
 */
export async function resolveFactoryRef(
  chain: CantonChain,
  party: string,
  factoryInstanceAddress: string,
): Promise<PoolContractRef> {
  const contract = await chain.findActiveContractByInstanceAddress(
    FACTORY_TEMPLATE_ID,
    factoryInstanceAddress,
    [party],
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveFactoryRef',
      'factoryInstanceAddress',
      `CCIPFactory ${factoryInstanceAddress} is not active or not visible to ${party}`,
    )
  }
  return toContractRef(contract)
}

/**
 * Resolve a pool contract reference by its `InstanceAddress` (the canonical
 * Canton resolution path, mirroring Go `FindActiveContractByInstanceAddress`).
 *
 * `poolInstanceAddress` is the pool's `InstanceAddress` — either the `0x<64-hex>`
 * keccak256 hash, or the `RawInstanceAddress` `"instanceId@poolOwner"` form
 * (resolved to the hash internally). The SDK queries the ACS by pool template,
 * derives each contract's instance address from its `instanceId` create-arg +
 * sole signatory, and matches — returning the CID + disclosure blob together so
 * the caller never handles `createdEventBlob`.
 */
export async function resolvePoolRef(
  chain: CantonChain,
  poolType: 'burnMint' | 'lockRelease',
  poolOwner: string,
  poolInstanceAddress: string,
): Promise<PoolContractRef> {
  const templateId =
    poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

  const contract = await chain.findActiveContractByInstanceAddress(
    templateId,
    poolInstanceAddress,
    [poolOwner],
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolvePoolRef',
      'poolInstanceAddress',
      `pool ${poolInstanceAddress} is not active or not visible to ${poolOwner}`,
    )
  }
  return toContractRef(contract)
}

/**
 * Resolve a RateLimiter contract reference by its `InstanceAddress`. The
 * RateLimiter's signatory is the pool owner, so visibility follows the pool
 * owner party. Needed by `setRateLimitConfig` — the choice takes the limiter's
 * contract ID (`rateLimiterCid`), not its instance address.
 */
export async function resolveRateLimiterRef(
  chain: CantonChain,
  poolOwner: string,
  rateLimiterInstanceAddress: string,
): Promise<PoolContractRef> {
  const contract = await chain.findActiveContractByInstanceAddress(
    RATE_LIMITER_TEMPLATE_ID,
    rateLimiterInstanceAddress,
    [poolOwner],
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveRateLimiterRef',
      'rateLimiterInstanceAddress',
      `RateLimiter ${rateLimiterInstanceAddress} is not active or not visible to ${poolOwner}`,
    )
  }
  return toContractRef(contract)
}

/** Inputs to {@link buildPoolCreateArguments} (mirrors the pool template fields). */
export interface PoolCreateArgsInput {
  /** Pool instance ID (unique; derives the pool instance address). */
  instanceId: string
  /** Pool owner party (signatory; must equal `instrumentId.admin` — on-ledger `ensure`). */
  poolOwner: string
  /** CCIP owner party (the protocol-level owner). */
  ccipOwner: string
  /** Instrument to bridge. */
  instrumentId: { admin: string; id: string }
  /** Token decimals. */
  decimals: number
  /** Optional rate-limit admin party. */
  rateLimitAdmin?: string
  /**
   * Observer parties for EDS auto-detection. Mandatory — the on-ledger
   * `ensure` clause rejects an empty list. Set at creation or updated later
   * via the `SetObservers` choice.
   */
  observers: string[]
  /** TAR / RMNRemote / FeeQuoter RAW instance addresses (`"instanceId@party"`). */
  deps: { tokenAdminRegistry: string; rmnRemote: string; feeQuoter: string }
  /** Pool receive-context choice-context (default: empty). */
  poolReceiveContext?: PoolReceiveContext
  /** Transfer timeout (default: `RelativeHours 24`, matching Go). */
  transferTimeout?: TransferTimeout
}

/**
 * Build the full `BurnMintTokenPool`/`LockReleaseTokenPool` create-arguments
 * record (identical field shape for both — `LockReleaseTokenPool` shares the
 * same fields). Shared by the `Initialize`-atomic-deploy path
 * (`deploy-token-pool.ts`) and the standalone bare-create path.
 *
 * Typed against the `BurnMintTokenPool` binding; `LockReleaseTokenPool` is a
 * separate generated package but shares the identical field shape, so this
 * return type is structurally valid for both.
 */
export function buildPoolCreateArguments(p: PoolCreateArgsInput): BurnMintTokenPool {
  return {
    instanceId: p.instanceId,
    poolOwner: p.poolOwner,
    ccipOwner: p.ccipOwner,
    instrumentId: p.instrumentId,
    decimals: p.decimals.toString(),
    rateLimitAdmin: p.rateLimitAdmin ?? null,
    observers: p.observers,
    remoteChainConfigs: [], // GenMap → JSON array
    tokenTransferFeeConfigs: [], // GenMap → JSON array
    poolReceiveContext: p.poolReceiveContext ?? EMPTY_CHOICE_CONTEXT,
    transferTimeout: encodeTransferTimeout(
      p.transferTimeout ?? { type: 'RelativeHours', hours: 24 },
    ),
    deps: {
      tokenAdminRegistry: rawInstanceAddress(p.deps.tokenAdminRegistry),
      rmnRemote: rawInstanceAddress(p.deps.rmnRemote),
      feeQuoter: rawInstanceAddress(p.deps.feeQuoter),
    },
  }
}

/**
 * One rate limiter to deploy alongside a lane via `Initialize`. Mirrors Daml
 * `RateLimiterDeploySpec`. Direction/mode are implied by which slot of
 * {@link LaneDeploySpec} this occupies, not repeated here.
 */
export interface RateLimiterDeploySpec {
  /** Rate-limiter instance ID (unique; derives its instance address as `instanceId@poolOwner`). */
  instanceId: string
  /** Whether the limiter starts enabled. */
  isEnabled: boolean
  /** Bucket capacity (max tokens). */
  capacity: bigint
  /** Refill rate (tokens per second). */
  rate: bigint
}

/**
 * One remote-chain lane to wire up via `Initialize`: routing/CCV/finality
 * config, plus the three rate limiters deployed alongside it. Mirrors Daml
 * `LaneDeploySpec`.
 */
export interface LaneDeploySpec {
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
  /** Inbound rate limiter to deploy for this lane. */
  inbound: RateLimiterDeploySpec
  /** Outbound rate limiter to deploy for this lane. */
  outbound: RateLimiterDeploySpec
  /** Inbound custom-block-confirmations rate limiter to deploy for this lane. */
  inboundCustomFinality: RateLimiterDeploySpec
}

/** Encode a {@link RateLimiterDeploySpec} for the `Initialize` choice argument. */
function encodeRateLimiterDeploySpec(s: RateLimiterDeploySpec): RateLimiterDeploySpecArg {
  return {
    instanceId: s.instanceId,
    isEnabled: s.isEnabled,
    capacity: s.capacity.toString(),
    rate: s.rate.toString(),
  }
}

/** Encode a {@link LaneDeploySpec} for the `Initialize` choice argument. */
export function encodeLaneDeploySpec(l: LaneDeploySpec): LaneDeploySpecArg {
  return {
    remoteChainSelector: l.remoteChainSelector.toString(),
    remotePools: l.remotePools,
    remoteTokenAddress: l.remoteTokenAddress,
    inboundCCVs: (l.inboundCCVs ?? []).map(rawInstanceAddress),
    outboundCCVs: (l.outboundCCVs ?? []).map(rawInstanceAddress),
    finalityConfig: encodeFinalityConfig(l.finalityConfig ?? { type: 'WaitForFinality' }),
    inbound: encodeRateLimiterDeploySpec(l.inbound),
    outbound: encodeRateLimiterDeploySpec(l.outbound),
    inboundCustomFinality: encodeRateLimiterDeploySpec(l.inboundCustomFinality),
  }
}

/** Inputs to {@link buildInitializeChoiceArgument}. */
export interface InitializeChoiceArgsInput {
  /** TAR contract ID (resolved + disclosed by the caller — see `resolveTar`). */
  tokenAdminRegistryCid: string
  /**
   * Existing `TokenConfig` CID, for third-party-admin tokens that already went
   * through a separate propose/accept flow. Not yet supported by the SDK —
   * always `null` (fresh `ProposeAdministrator` + `AcceptAdminRole` inline).
   */
  existingTokenConfigCid?: string
  /** Token admin party — authorizes the choice jointly with `poolOwner`. */
  admin: string
  /** Remote-chain lanes to wire up atomically with the pool. */
  lanes: LaneDeploySpec[]
}

/** Build the `Initialize` choice argument record. */
export function buildInitializeChoiceArgument(p: InitializeChoiceArgsInput): InitializeArg {
  return {
    tokenAdminRegistryCid: p.tokenAdminRegistryCid,
    existingTokenConfigCid: p.existingTokenConfigCid ?? null,
    admin: p.admin,
    lanes: p.lanes.map(encodeLaneDeploySpec),
  }
}
