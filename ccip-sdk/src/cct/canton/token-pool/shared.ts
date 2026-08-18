/**
 * Shared helpers for token-pool CCT operations: CCIPFactory + BurnMint/LockRelease
 * pool exercise-command construction and pool contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonActiveContract, CantonChain } from '../../../canton/index.ts'
import type { JsCommands } from '../../../canton/client/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/** CCIPFactory template ID. */
export const FACTORY_TEMPLATE_ID = '#ccip-factory-v2:CCIP.FactoryV2:CCIPFactory'

/** BurnMintTokenPool template ID. */
export const BURN_MINT_POOL_TEMPLATE_ID =
  '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'

/** LockReleaseTokenPool template ID. */
export const LOCK_RELEASE_POOL_TEMPLATE_ID =
  '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'

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
  const { choice, templateId, poolContract, choiceArgument, actAs, commandIdPrefix } = input
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
