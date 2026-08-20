/**
 * Shared helpers for token-pool CCT operations: CCIPFactory + BurnMint/LockRelease
 * pool exercise-command construction and pool contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonActiveContract, CantonChain } from '../../../canton/index.ts'
import type { JsCommands } from '../../../canton/client/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import {
  EMPTY_CHOICE_CONTEXT,
  encodeTransferTimeout,
  rawInstanceAddress,
  type TransferTimeout,
} from '../encoding.ts'

/** CCIPFactory template ID. */
export const FACTORY_TEMPLATE_ID = '#ccip-factory-v2:CCIP.FactoryV2:CCIPFactory'

/** BurnMintTokenPool template ID (pools ship in their own packages, not ccip-core). */
export const BURN_MINT_POOL_TEMPLATE_ID =
  '#ccip-burn-mint-token-pool-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'

/** LockReleaseTokenPool template ID. */
export const LOCK_RELEASE_POOL_TEMPLATE_ID =
  '#ccip-lock-release-token-pool-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'

/** RateLimiter template ID. */
export const RATE_LIMITER_TEMPLATE_ID = '#ccip-rate-limiter-v2:CCIP.RateLimiterV2:RateLimiter'

/** A contract reference for the exercise builders: a CID plus its disclosure blob. */
export interface PoolContractRef {
  /** Contract ID. */
  contractId: string
  /** `createdEventBlob` from the ACS (required for prepared/signed submission). */
  createdEventBlob: string
  /** Synchronizer the contract was read from. */
  synchronizerId: string
}

/** Project a resolved {@link CantonActiveContract} into a {@link PoolContractRef}. */
export function toContractRef(contract: CantonActiveContract): PoolContractRef {
  return {
    contractId: contract.contractId,
    createdEventBlob: contract.createdEventBlob,
    synchronizerId: contract.synchronizerId,
  }
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
  const { choice, templateId, poolContract, extraDisclosedContracts, choiceArgument, actAs, commandIdPrefix } =
    input
  return {
    commands: [
      {
        ExerciseCommand: {
          templateId,
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
        templateId,
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
  /** TAR / RMNRemote / FeeQuoter RAW instance addresses (`"instanceId@party"`). */
  deps: { tokenAdminRegistry: string; rmnRemote: string; feeQuoter: string }
  /** Pool receive-context choice-context (default: empty). */
  poolReceiveContext?: { values: unknown[] }
  /** Transfer timeout (default: `RelativeHours 24`, matching Go). */
  transferTimeout?: TransferTimeout
}

/**
 * Build the full `BurnMintTokenPool`/`LockReleaseTokenPool` create-arguments
 * record (identical field shape for both). Shared by the factory deploy choice
 * (`{contract: …}`) and the direct bare-create path — the factory `create`s
 * this record verbatim.
 */
export function buildPoolCreateArguments(p: PoolCreateArgsInput): Record<string, unknown> {
  return {
    instanceId: p.instanceId,
    poolOwner: p.poolOwner,
    ccipOwner: p.ccipOwner,
    instrumentId: p.instrumentId,
    decimals: p.decimals.toString(),
    rateLimitAdmin: p.rateLimitAdmin ?? null,
    remoteChainConfigs: [], // GenMap → JSON array
    tokenTransferFeeConfigs: [], // GenMap → JSON array
    poolReceiveContext: p.poolReceiveContext ?? EMPTY_CHOICE_CONTEXT,
    transferTimeout: encodeTransferTimeout(p.transferTimeout ?? { type: 'RelativeHours', hours: 24 }),
    deps: {
      tokenAdminRegistry: rawInstanceAddress(p.deps.tokenAdminRegistry),
      rmnRemote: rawInstanceAddress(p.deps.rmnRemote),
      feeQuoter: rawInstanceAddress(p.deps.feeQuoter),
    },
  }
}
