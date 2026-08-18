/**
 * Shared helpers for TAR (Token Admin Registry) CCT operations: exercise-command
 * construction and TAR / TokenConfig contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonActiveContract, CantonChain } from '../../../canton/index.ts'
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
 * Resolve a TAR contract reference by its `InstanceAddress` (the canonical
 * Canton resolution path). `tarInstanceAddress` is either the `0x<64-hex>`
 * keccak256 hash or the `RawInstanceAddress` `"instanceId@ccipOwner"` form.
 * The SDK resolves the CID + disclosure blob together via
 * {@link CantonChain.findActiveContractByInstanceAddress}.
 */
export async function resolveTarRef(
  chain: CantonChain,
  sender: string,
  tarInstanceAddress: string,
): Promise<TarContractRef> {
  const contract = await chain.findActiveContractByInstanceAddress(
    TAR_TEMPLATE_ID,
    tarInstanceAddress,
    [sender],
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveTarRef',
      'tarInstanceAddress',
      `TokenAdminRegistry ${tarInstanceAddress} is not active or not visible to ${sender}`,
    )
  }
  return toContractRef(contract)
}

/**
 * Resolve a TokenConfig contract reference by its `InstanceAddress` (the
 * canonical Canton resolution path). `tokenConfigInstanceAddress` is either the
 * `0x<64-hex>` keccak256 hash or the `RawInstanceAddress` `"instanceId@admin"`
 * form.
 */
export async function resolveTokenConfigRef(
  chain: CantonChain,
  adminParty: string,
  tokenConfigInstanceAddress: string,
): Promise<TarContractRef> {
  const contract = await chain.findActiveContractByInstanceAddress(
    TOKEN_CONFIG_TEMPLATE_ID,
    tokenConfigInstanceAddress,
    [adminParty],
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveTokenConfigRef',
      'tokenConfigInstanceAddress',
      `TokenConfig ${tokenConfigInstanceAddress} is not active or not visible to ${adminParty}`,
    )
  }
  return toContractRef(contract)
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

