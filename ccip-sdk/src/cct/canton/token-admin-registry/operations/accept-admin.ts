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
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { parseInstrumentId } from '../../validate.ts'
import { buildTarExercise, resolveTarRef, resolveTokenConfigRef } from '../shared.ts'

/** Parameters shared by TAR `acceptAdmin` generation and execution. */
export interface AcceptAdminParams {
  /** Instrument to accept admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`). Resolved via ACS. */
  tarInstanceAddress: string
  /** `TokenConfig` `InstanceAddress` (`0x<64-hex>` or `"instanceId@admin"`). Resolved via ACS. */
  tokenConfigInstanceAddress: string
}

/** Parsed `acceptAdmin` params. */
type ParsedAcceptAdminParams = Omit<
  CantonGenerateParams<AcceptAdminParams>,
  'instrumentId'
> & {
  instrumentId: { admin: string; id: string }
}

/** Parameters for unsigned TAR `acceptAdmin` generation. */
export type GenerateAcceptAdminParams = CantonGenerateParams<AcceptAdminParams>

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

  /** Parses the instrument ID into `{ admin, id }`. */
  protected override parse(p: GenerateAcceptAdminParams): ParsedAcceptAdminParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
    }
  }

  /** Builds the `AcceptAdminRole` exercise command against the TAR. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedAcceptAdminParams,
  ): Promise<JsCommands> {
    const tarContract = await resolveTarRef(chain, p.sender, p.tarInstanceAddress)
    const tokenConfigContract = await resolveTokenConfigRef(
      chain,
      p.instrumentId.admin,
      p.tokenConfigInstanceAddress,
    )

    return buildTarExercise({
      choice: 'AcceptAdminRole',
      tarContract,
      tokenConfigContract,
      choiceArgument: { instrumentId: p.instrumentId },
      actAs: [p.sender],
      commandIdPrefix: 'cct-accept-admin',
    })
  }
}
