/**
 * Shared helpers for TAR (Token Admin Registry) CCT operations: exercise-command
 * construction and TAR / TokenConfig contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../canton/index.ts'
import type { CantonWallet } from '../canton/types.ts'
import type { JsCommands } from '../canton/client/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/** TAR template ID (`#<package>:<Module>:<Entity>`). */
export const TAR_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'

/** TokenConfig template ID (the per-instrument config contract the TAR manages). */
export const TOKEN_CONFIG_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'

/** Inputs to {@link buildTarExercise}. */
export interface BuildTarExerciseInput {
  /** TAR choice name (e.g. `SetPool`, `ProposeAdministrator`, `AcceptAdminRole`, `TransferAdminRole`). */
  choice: string
  /** TAR contract ID to exercise the choice on. */
  tarCid: string
  /** `TokenConfig` contract ID for the instrument (disclosed with the command). */
  tokenConfigCid: string
  /** Daml choice argument record. */
  choiceArgument: Record<string, unknown>
  /** Acting party IDs (`actAs`). */
  actAs: string[]
  /** Command-ID prefix (a timestamp + random suffix is appended for dedup). */
  commandIdPrefix: string
}

/**
 * Build a `JsCommands` exercising a TAR choice. The TAR contract and the
 * instrument's `TokenConfig` are disclosed alongside the command so the
 * participant can reconstruct them during interactive submission.
 *
 * Disclosures currently carry only the TAR + TokenConfig contracts (by CID).
 * Full ACS disclosure assembly (matching `CantonChain.generateUnsignedSendMessage`'s
 * `dedupeDisclosedContracts` + created-event-blob fetch) is layered in by the
 * `getTokenAdminRegistry` Query / a dedicated disclosure resolver in a follow-up.
 */
export function buildTarExercise(input: BuildTarExerciseInput): JsCommands {
  const { choice, tarCid, tokenConfigCid, choiceArgument, actAs, commandIdPrefix } = input

  // Placeholder createdEventBlob / synchronizerId — the real values are fetched
  // from the ACS by the disclosure resolver (to be wired from
  // `chain.acsDisclosureProvider`). Operations that pass a `tarCid` resolved
  // out-of-band carry the CID only; the participant re-fetches the blob.
  // TODO(cct-canton): fetch createdEventBlob + synchronizerId for tarCid + tokenConfigCid
  //   via chain.acsDisclosureProvider so interactive submission has full disclosures.
  const disclosedContracts = [
    { templateId: TAR_TEMPLATE_ID, contractId: tarCid, createdEventBlob: '', synchronizerId: '' },
    {
      templateId: TOKEN_CONFIG_TEMPLATE_ID,
      contractId: tokenConfigCid,
      createdEventBlob: '',
      synchronizerId: '',
    },
  ]

  return {
    commands: [
      {
        ExerciseCommand: {
          templateId: TAR_TEMPLATE_ID,
          contractId: tarCid,
          choice,
          choiceArgument,
        },
      },
    ],
    commandId: `${commandIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs,
    disclosedContracts,
  }
}

/**
 * Resolve the TAR contract ID for the acting party. Caller-provided `tarCid`
 * wins; otherwise this queries the ACS for the active TAR the party can act on.
 *
 * TODO(cct-canton): implement ACS resolution via `getTokenAdminRegistry` Query
 * (TAR `Get` / `IsAdministrator` read choices). Until then, require an explicit
 * `tarCid`.
 */
export async function resolveTarCid(chain: CantonChain, wallet: CantonWallet): Promise<string> {
  // ACS resolution not yet wired — require the caller to pass tarCid.
  void chain
  void wallet
  throw new CCTParamsInvalidError(
    'setPool',
    'tarCid',
    'TAR contract ID resolution from ACS is not yet implemented; pass `tarCid` explicitly',
  )
}

/**
 * Resolve the `TokenConfig` contract ID for an instrument. Caller-provided
 * `tokenConfigCid` wins; otherwise this queries the TAR (GetTokenConfigByCid).
 *
 * TODO(cct-canton): implement via `getTokenAdminRegistry` Query. Until then,
 * require an explicit `tokenConfigCid`.
 */
export async function resolveTokenConfigCid(
  chain: CantonChain,
  instrumentId: { admin: string; id: string },
): Promise<string> {
  void chain
  void instrumentId
  throw new CCTParamsInvalidError(
    'setPool',
    'tokenConfigCid',
    'TokenConfig contract ID resolution from TAR is not yet implemented; pass `tokenConfigCid` explicitly',
  )
}
