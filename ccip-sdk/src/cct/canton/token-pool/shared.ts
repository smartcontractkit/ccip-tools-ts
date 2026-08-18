/**
 * Shared helpers for token-pool CCT operations: CCIPFactory + BurnMint/LockRelease
 * pool exercise-command construction and pool contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonActiveContract, CantonChain } from '../../../canton/index.ts'
import { decodeDamlRecord } from '../../../canton/index.ts'
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
 * Resolve the active `CCIPFactory` contract for the acting party. Queries the
 * ACS by the `CCIPFactory` template ID and matches on the `owner` create-argument
 * field equal to `party`. The factory is a singleton per `owner` (signatory).
 *
 * @returns The active factory contract (CID + disclosure blob), or throws if none.
 */
export async function resolveFactoryContract(
  chain: CantonChain,
  party: string,
): Promise<CantonActiveContract> {
  const contract = await chain.findActiveContractByTemplate(
    FACTORY_TEMPLATE_ID,
    [party],
    (createArgument) => {
      const fields = decodeDamlRecord(createArgument)
      return fields['owner'] === party
    },
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveFactoryContract',
      'factoryCid',
      `no active CCIPFactory found for owner ${party}; pass \`factoryCid\` explicitly or ensure the party owns a factory`,
    )
  }
  return contract
}

/**
 * Resolve a CCIPFactory contract reference for an op. When `factoryCid` is
 * provided, fetches its disclosure blob by CID; otherwise resolves the active
 * factory for `party` (the `owner`) from the ACS.
 */
export async function resolveFactoryRef(
  chain: CantonChain,
  party: string,
  factoryCid?: string,
): Promise<PoolContractRef> {
  if (factoryCid) {
    const contract = await chain.findActiveContractByCid(FACTORY_TEMPLATE_ID, factoryCid, [party])
    if (!contract) {
      throw new CCTParamsInvalidError(
        'resolveFactoryRef',
        'factoryCid',
        `provided factoryCid ${factoryCid} is not active or not visible to ${party}`,
      )
    }
    return toContractRef(contract)
  }
  return toContractRef(await resolveFactoryContract(chain, party))
}

/**
 * Resolve a pool contract reference by its (mandatory) `poolCid`. Fetches the
 * disclosure blob by CID using the pool template ID. Pool ops require an
 * explicit `poolCid` (pools are not singletons — they are keyed by
 * `poolOwner` + `instrumentId`, and the caller is expected to know which pool
 * it is operating on).
 */
export async function resolvePoolRef(
  chain: CantonChain,
  poolCid: string,
  poolType: 'burnMint' | 'lockRelease',
  poolOwner: string,
): Promise<PoolContractRef> {
  const templateId =
    poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID
  const contract = await chain.findActiveContractByCid(templateId, poolCid, [poolOwner])
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolvePoolRef',
      'poolCid',
      `provided poolCid ${poolCid} is not active or not visible to ${poolOwner}`,
    )
  }
  return toContractRef(contract)
}
