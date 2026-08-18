/**
 * acceptAdmin — accepts the admin role for an instrument in the TAR via the
 * `AcceptAdminRole` choice. The caller (`wallet.party`) must equal the
 * `pendingAdmin` previously proposed by `registerAdmin`/`transferAdmin`.
 *
 * Ported from the Go exerciser (`token_admin_registry.go` `AcceptAdminRole`).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTarAdminResult } from '../../types.ts'
import { type CantonExecuteParams, CantonOperation } from '../../operation.ts'
import { parseContractCid, parseInstrumentId } from '../../validate.ts'
import { buildTarExercise, resolveTarCid, resolveTokenConfigCid } from '../shared.ts'

/** Parameters shared by TAR `acceptAdmin` generation and execution. */
export interface AcceptAdminParams {
  /** Instrument to accept admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** TAR contract ID. When omitted, resolved via ACS. */
  tarCid?: string
  /** `TokenConfig` contract ID. When omitted, resolved via ACS. */
  tokenConfigCid?: string
}

/** Parsed `acceptAdmin` params. */
type ParsedAcceptAdminParams = Omit<
  CantonExecuteParams<AcceptAdminParams>,
  'instrumentId' | 'tarCid' | 'tokenConfigCid'
> & {
  instrumentId: { admin: string; id: string }
  tarCid?: string
  tokenConfigCid?: string
}

/** Parameters for unsigned TAR `acceptAdmin` generation. */
export type GenerateAcceptAdminParams = CantonExecuteParams<AcceptAdminParams>

/** Unsigned TAR `acceptAdmin` result. */
export type GenerateAcceptAdminResult = UnsignedCantonTx

/** Parameters for executing TAR `acceptAdmin`. */
export type ExecuteAcceptAdminParams = CantonExecuteParams<AcceptAdminParams>

/** Result of executing TAR `acceptAdmin`. */
export type ExecuteAcceptAdminResult = CantonTarAdminResult

/** TAR `acceptAdmin` operation. */
export class AcceptAdmin extends CantonOperation<AcceptAdminParams, ParsedAcceptAdminParams> {
  readonly name = 'acceptAdmin'

  /** Validates the instrument ID. */
  protected override validate(p: GenerateAcceptAdminParams): void {
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
  }

  /** Parses the instrument ID into `{ admin, id }` and validates CIDs. */
  protected override parse(p: GenerateAcceptAdminParams): ParsedAcceptAdminParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      tarCid: p.tarCid ? parseContractCid(this.name, 'tarCid', p.tarCid) : undefined,
      tokenConfigCid: p.tokenConfigCid
        ? parseContractCid(this.name, 'tokenConfigCid', p.tokenConfigCid)
        : undefined,
    }
  }

  /** Builds the `AcceptAdminRole` exercise command against the TAR. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedAcceptAdminParams,
  ): Promise<JsCommands> {
    const tarCid = p.tarCid ?? (await resolveTarCid(chain, p.wallet))
    const tokenConfigCid = p.tokenConfigCid ?? (await resolveTokenConfigCid(chain, p.instrumentId))

    return buildTarExercise({
      choice: 'AcceptAdminRole',
      tarCid,
      tokenConfigCid,
      choiceArgument: { instrumentId: p.instrumentId },
      actAs: [p.wallet.party],
      commandIdPrefix: 'cct-accept-admin',
    })
  }
}
