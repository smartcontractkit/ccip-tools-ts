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
import { type CantonExecuteParams, CantonOperation } from '../../operation.ts'
import { parseContractCid, parseInstrumentId, parsePartyId } from '../../validate.ts'
import { buildTarExercise, resolveTarCid, resolveTokenConfigCid } from '../shared.ts'

/** Parameters shared by TAR `transferAdmin` generation and execution. */
export interface TransferAdminParams {
  /** Instrument to transfer admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Party to transfer the admin role to. */
  newAdmin: string
  /** TAR contract ID. When omitted, resolved via ACS. */
  tarCid?: string
  /** `TokenConfig` contract ID. When omitted, resolved via ACS. */
  tokenConfigCid?: string
}

/** Parsed `transferAdmin` params. */
type ParsedTransferAdminParams = Omit<
  CantonExecuteParams<TransferAdminParams>,
  'instrumentId' | 'tarCid' | 'tokenConfigCid'
> & {
  instrumentId: { admin: string; id: string }
  tarCid?: string
  tokenConfigCid?: string
}

/** Parameters for unsigned TAR `transferAdmin` generation. */
export type GenerateTransferAdminParams = CantonExecuteParams<TransferAdminParams>

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

  /** Parses the instrument ID into `{ admin, id }` and validates CIDs. */
  protected override parse(p: GenerateTransferAdminParams): ParsedTransferAdminParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      tarCid: p.tarCid ? parseContractCid(this.name, 'tarCid', p.tarCid) : undefined,
      tokenConfigCid: p.tokenConfigCid
        ? parseContractCid(this.name, 'tokenConfigCid', p.tokenConfigCid)
        : undefined,
    }
  }

  /** Builds the `TransferAdminRole` exercise command against the TAR. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedTransferAdminParams,
  ): Promise<JsCommands> {
    const tarCid = p.tarCid ?? (await resolveTarCid(chain, p.wallet))
    const tokenConfigCid = p.tokenConfigCid ?? (await resolveTokenConfigCid(chain, p.instrumentId))

    return buildTarExercise({
      choice: 'TransferAdminRole',
      tarCid,
      tokenConfigCid,
      choiceArgument: { instrumentId: p.instrumentId, newAdmin: p.newAdmin },
      actAs: [p.wallet.party],
      commandIdPrefix: 'cct-transfer-admin',
    })
  }
}
