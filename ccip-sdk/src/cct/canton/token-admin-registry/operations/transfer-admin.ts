/**
 * transferAdmin — transfers the admin role for an instrument to a new party via
 * the TAR `TransferAdminRole` choice. The caller must be the current admin.
 *
 * Ported from the Go exerciser (`token_admin_registry.go` `TransferAdminRole`).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTarAdminResult } from '../../types.ts'
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { parseInstrumentId, parsePartyId } from '../../validate.ts'
import { buildTarExercise, resolveTarRef, resolveTokenConfigRef } from '../shared.ts'

/** Parameters shared by TAR `transferAdmin` generation and execution. */
export interface TransferAdminParams {
  /** Instrument to transfer admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Party to transfer the admin role to. */
  newAdmin: string
  /** TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`). Resolved via ACS. */
  tarInstanceAddress: string
  /** `TokenConfig` `InstanceAddress` (`0x<64-hex>` or `"instanceId@admin"`). Resolved via ACS. */
  tokenConfigInstanceAddress: string
}

/** Parsed `transferAdmin` params. */
type ParsedTransferAdminParams = Omit<
  CantonGenerateParams<TransferAdminParams>,
  'instrumentId'
> & {
  instrumentId: { admin: string; id: string }
}

/** Parameters for unsigned TAR `transferAdmin` generation. */
export type GenerateTransferAdminParams = CantonGenerateParams<TransferAdminParams>

/** Unsigned TAR `transferAdmin` result. */
export type GenerateTransferAdminResult = UnsignedCantonTx

/** Parameters for executing TAR `transferAdmin`. */
export type ExecuteTransferAdminParams = CantonExecuteParams<TransferAdminParams>

/** Result of executing TAR `transferAdmin`. */
export type ExecuteTransferAdminResult = CantonTarAdminResult

/** TAR `transferAdmin` operation. */
export class TransferAdmin extends CantonOperation<TransferAdminParams, ParsedTransferAdminParams> {
  readonly name = 'transferAdmin'

  /** Validates the instrument ID and the new admin party. */
  protected override validate(p: GenerateTransferAdminParams): void {
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    parsePartyId(this.name, 'newAdmin', p.newAdmin)
  }

  /** Parses the instrument ID into `{ admin, id }`. */
  protected override parse(p: GenerateTransferAdminParams): ParsedTransferAdminParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
    }
  }

  /** Builds the `TransferAdminRole` exercise command against the TAR. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedTransferAdminParams,
  ): Promise<JsCommands> {
    const tarContract = await resolveTarRef(chain, p.sender, p.tarInstanceAddress)
    const tokenConfigContract = await resolveTokenConfigRef(
      chain,
      p.instrumentId.admin,
      p.tokenConfigInstanceAddress,
    )

    return buildTarExercise({
      choice: 'TransferAdminRole',
      tarContract,
      tokenConfigContract,
      choiceArgument: { instrumentId: p.instrumentId, newAdmin: p.newAdmin },
      actAs: [p.sender],
      commandIdPrefix: 'cct-transfer-admin',
    })
  }
}
