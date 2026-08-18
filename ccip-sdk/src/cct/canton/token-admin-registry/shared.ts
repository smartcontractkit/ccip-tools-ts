/**
 * Shared helpers for TAR (Token Admin Registry) CCT operations: exercise-command
 * construction and TAR / TokenConfig contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonActiveContract, CantonChain, CantonInstrumentId } from '../../../canton/index.ts'
import { decodeDamlRecord, extractRecordField } from '../../../canton/index.ts'
import type { JsCommands } from '../../../canton/client/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/** TAR template ID (`#<package>:<Module>:<Entity>`). */
export const TAR_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'

/** TokenConfig template ID (the per-instrument config contract the TAR manages). */
export const TOKEN_CONFIG_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'

/** A contract reference for {@link buildTarExercise}: a CID plus its disclosure blob. */
export interface TarContractRef {
  /** Contract ID. */
  contractId: string
  /** `createdEventBlob` from the ACS (required for prepared/signed submission). */
  createdEventBlob: string
  /** Synchronizer the contract was read from. */
  synchronizerId: string
}

/** Project a resolved {@link CantonActiveContract} into a {@link TarContractRef}. */
export function toContractRef(contract: CantonActiveContract): TarContractRef {
  return {
    contractId: contract.contractId,
    createdEventBlob: contract.createdEventBlob,
    synchronizerId: contract.synchronizerId,
  }
}

/**
 * Resolve a TAR contract reference for an op. When `tarCid` is provided, fetches
 * its disclosure blob by CID; otherwise resolves the active TAR for `sender`
 * (the `ccipOwner`) from the ACS. Throws {@link CCTParamsInvalidError} when the
 * provided CID is not active/visible or no TAR is found for the party.
 */
export async function resolveTarRef(
  chain: CantonChain,
  sender: string,
  tarCid?: string,
): Promise<TarContractRef> {
  if (tarCid) {
    const contract = await chain.findActiveContractByCid(TAR_TEMPLATE_ID, tarCid, [sender])
    if (!contract) {
      throw new CCTParamsInvalidError(
        'resolveTarRef',
        'tarCid',
        `provided tarCid ${tarCid} is not active or not visible to ${sender}`,
      )
    }
    return toContractRef(contract)
  }
  return toContractRef(await resolveTarContract(chain, sender))
}

/**
 * Resolve a TokenConfig contract reference for an op. When `tokenConfigCid` is
 * provided, fetches its disclosure blob by CID; otherwise resolves the active
 * TokenConfig for `instrumentId` from the ACS. Throws {@link CCTParamsInvalidError}
 * when the provided CID is not active/visible or no TokenConfig is found.
 */
export async function resolveTokenConfigRef(
  chain: CantonChain,
  instrumentId: CantonInstrumentId,
  tokenConfigCid?: string,
): Promise<TarContractRef> {
  if (tokenConfigCid) {
    const contract = await chain.findActiveContractByCid(
      TOKEN_CONFIG_TEMPLATE_ID,
      tokenConfigCid,
      [instrumentId.admin],
    )
    if (!contract) {
      throw new CCTParamsInvalidError(
        'resolveTokenConfigRef',
        'tokenConfigCid',
        `provided tokenConfigCid ${tokenConfigCid} is not active or not visible`,
      )
    }
    return toContractRef(contract)
  }
  return toContractRef(await resolveTokenConfigContract(chain, instrumentId))
}

/** Inputs to {@link buildTarExercise}. */
export interface BuildTarExerciseInput {
  /** TAR choice name (e.g. `SetPool`, `ProposeAdministrator`, `AcceptAdminRole`, `TransferAdminRole`). */
  choice: string
  /** TAR contract reference (CID + disclosure blob). */
  tarContract: TarContractRef
  /** `TokenConfig` contract reference for the instrument (disclosed with the command). */
  tokenConfigContract: TarContractRef
  /** Daml choice argument record. */
  choiceArgument: Record<string, unknown>
  /** Acting party IDs (`actAs`). */
  actAs: string[]
  /** Command-ID prefix (a timestamp + random suffix is appended for dedup). */
  commandIdPrefix: string
}

/**
 * Build a `JsCommands` exercising a TAR choice. The TAR contract and the
 * instrument's `TokenConfig` are disclosed alongside the command with their
 * real `createdEventBlob` + `synchronizerId` (fetched by the resolvers or
 * supplied by the caller), so the participant can reconstruct them during
 * interactive submission.
 */
export function buildTarExercise(input: BuildTarExerciseInput): JsCommands {
  const { choice, tarContract, tokenConfigContract, choiceArgument, actAs, commandIdPrefix } = input

  const disclosedContracts = [
    {
      templateId: TAR_TEMPLATE_ID,
      contractId: tarContract.contractId,
      createdEventBlob: tarContract.createdEventBlob,
      synchronizerId: tarContract.synchronizerId,
    },
    {
      templateId: TOKEN_CONFIG_TEMPLATE_ID,
      contractId: tokenConfigContract.contractId,
      createdEventBlob: tokenConfigContract.createdEventBlob,
      synchronizerId: tokenConfigContract.synchronizerId,
    },
  ]

  return {
    commands: [
      {
        ExerciseCommand: {
          templateId: TAR_TEMPLATE_ID,
          contractId: tarContract.contractId,
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
 * Resolve the active `TokenAdminRegistry` contract for the acting party (the
 * CCIP owner / registry owner). Queries the ACS by the `TokenAdminRegistry`
 * template ID and matches on the `ccipOwner` create-argument field equal to
 * `sender`. The TAR is a singleton per `ccipOwner` (signatory).
 *
 * @returns The active TAR contract (CID + disclosure blob), or throws if none.
 */
export async function resolveTarContract(
  chain: CantonChain,
  sender: string,
): Promise<CantonActiveContract> {
  const contract = await chain.findActiveContractByTemplate(
    TAR_TEMPLATE_ID,
    [sender],
    (createArgument) => {
      const fields = decodeDamlRecord(createArgument)
      return fields['ccipOwner'] === sender
    },
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveTarContract',
      'tarCid',
      `no active TokenAdminRegistry found for ccipOwner ${sender}; pass \`tarCid\` explicitly or ensure the party is a registry owner`,
    )
  }
  return contract
}

/**
 * Resolve the active `TokenConfig` contract for an instrument. Queries the ACS
 * by the `TokenConfig` template ID and matches on the `instrumentId`
 * create-argument field (a `{ admin, id }` record) equal to the target.
 *
 * @returns The active TokenConfig contract (CID + disclosure blob), or throws if none.
 */
export async function resolveTokenConfigContract(
  chain: CantonChain,
  instrumentId: CantonInstrumentId,
): Promise<CantonActiveContract> {
  const contract = await chain.findActiveContractByTemplate(
    TOKEN_CONFIG_TEMPLATE_ID,
    [instrumentId.admin],
    (createArgument) => {
      const fields = decodeDamlRecord(createArgument)
      const inst = extractRecordField(fields, 'instrumentId')
      if (!inst) return false
      return inst['admin'] === instrumentId.admin && inst['id'] === instrumentId.id
    },
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveTokenConfigContract',
      'tokenConfigCid',
      `no active TokenConfig found for instrument ${instrumentId.admin}::${instrumentId.id}; pass \`tokenConfigCid\` explicitly or ensure the instrument is registered`,
    )
  }
  return contract
}
