/**
 * Shared helpers for token-pool CCT operations: CCIPFactory + BurnMint/LockRelease
 * pool exercise-command construction and pool contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../canton/index.ts'
import type { JsCommands } from '../canton/client/index.ts'

/** CCIPFactory template ID. */
export const FACTORY_TEMPLATE_ID = '#ccip-factory-v2:CCIP.FactoryV2:CCIPFactory'

/** BurnMintTokenPool template ID. */
export const BURN_MINT_POOL_TEMPLATE_ID =
  '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'

/** LockReleaseTokenPool template ID. */
export const LOCK_RELEASE_POOL_TEMPLATE_ID =
  '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'

/** Inputs to {@link buildFactoryExercise}. */
export interface BuildFactoryExerciseInput {
  /** CCIPFactory choice name (e.g. `DeployBurnMintTokenPool`, `DeployLockReleaseTokenPool`). */
  choice: string
  /** CCIPFactory contract ID to exercise the choice on. */
  factoryCid: string
  /** Daml choice argument record. */
  choiceArgument: Record<string, unknown>
  /** Acting party IDs (`actAs`). */
  actAs: string[]
  /** Command-ID prefix. */
  commandIdPrefix: string
}

/**
 * Build a `JsCommands` exercising a CCIPFactory choice. The factory contract is
 * disclosed alongside the command.
 *
 * TODO(cct-canton): fetch the factory's createdEventBlob + synchronizerId via
 * `chain.acsDisclosureProvider` for full interactive-submission disclosures.
 */
export function buildFactoryExercise(input: BuildFactoryExerciseInput): JsCommands {
  const { choice, factoryCid, choiceArgument, actAs, commandIdPrefix } = input
  return {
    commands: [
      {
        ExerciseCommand: {
          templateId: FACTORY_TEMPLATE_ID,
          contractId: factoryCid,
          choice,
          choiceArgument,
        },
      },
    ],
    commandId: `${commandIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs,
    disclosedContracts: [
      { templateId: FACTORY_TEMPLATE_ID, contractId: factoryCid, createdEventBlob: '', synchronizerId: '' },
    ],
  }
}

/** Inputs to {@link buildPoolExercise}. */
export interface BuildPoolExerciseInput {
  /** Pool choice name (e.g. `ApplyChainUpdates`, `SetRateLimitConfig`, `SetDynamicConfig`). */
  choice: string
  /** Pool template ID (burn-mint or lock-release). */
  templateId: string
  /** Pool contract ID to exercise the choice on. */
  poolCid: string
  /** Daml choice argument record. */
  choiceArgument: Record<string, unknown>
  /** Acting party IDs (`actAs`). */
  actAs: string[]
  /** Command-ID prefix. */
  commandIdPrefix: string
}

/**
 * Build a `JsCommands` exercising a pool choice. The pool contract is disclosed
 * alongside the command.
 *
 * TODO(cct-canton): fetch the pool's createdEventBlob + synchronizerId via
 * `chain.acsDisclosureProvider` for full interactive-submission disclosures.
 */
export function buildPoolExercise(input: BuildPoolExerciseInput): JsCommands {
  const { choice, templateId, poolCid, choiceArgument, actAs, commandIdPrefix } = input
  return {
    commands: [
      {
        ExerciseCommand: {
          templateId,
          contractId: poolCid,
          choice,
          choiceArgument,
        },
      },
    ],
    commandId: `${commandIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs,
    disclosedContracts: [
      { templateId, contractId: poolCid, createdEventBlob: '', synchronizerId: '' },
    ],
  }
}

/**
 * Resolve the CCIPFactory contract ID for the acting party. TODO(cct-canton):
 * implement ACS resolution. Until then, require an explicit `factoryCid`.
 */
export async function resolveFactoryCid(chain: CantonChain, party: string): Promise<string> {
  void chain
  void party
  throw new Error(
    'resolveFactoryCid: CCIPFactory contract ID resolution from ACS is not yet implemented; ' +
      'pass `factoryCid` explicitly',
  )
}
