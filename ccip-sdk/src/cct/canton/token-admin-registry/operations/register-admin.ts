/**
 * registerAdmin — proposes a new administrator for an instrument in the TAR via
 * the `ProposeAdministrator` choice. The caller must be the `ccipOwner` or the
 * instrument admin.
 *
 * Ported from the Go exerciser
 * (`token_admin_registry.go` `ProposeAdministrator`).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTarAdminResult } from '../../types.ts'
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { parseContractCid, parseInstrumentId, parsePartyId } from '../../validate.ts'
import { buildTarExercise, resolveTarRef, resolveTokenConfigRef } from '../shared.ts'

/** Parameters shared by TAR `registerAdmin` generation and execution. */
export interface RegisterAdminParams {
  /** Instrument to propose an admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Party to propose as the new token admin. */
  newAdmin: string
  /** TAR contract ID. When omitted, resolved via ACS. */
  tarCid?: string
  /** `TokenConfig` contract ID. When omitted, resolved via ACS. */
  tokenConfigCid?: string
}

/** Parsed `registerAdmin` params. */
type ParsedRegisterAdminParams = Omit<
  CantonGenerateParams<RegisterAdminParams>,
  'instrumentId' | 'tarCid' | 'tokenConfigCid'
> & {
  instrumentId: { admin: string; id: string }
  tarCid?: string
  tokenConfigCid?: string
}

/** Parameters for unsigned TAR `registerAdmin` generation. */
export type GenerateRegisterAdminParams = CantonGenerateParams<RegisterAdminParams>

/** Unsigned TAR `registerAdmin` result. */
export type GenerateRegisterAdminResult = UnsignedCantonTx

/** Parameters for executing TAR `registerAdmin`. */
export type ExecuteRegisterAdminParams = CantonExecuteParams<RegisterAdminParams>

/** Result of executing TAR `registerAdmin`. */
export type ExecuteRegisterAdminResult = CantonTarAdminResult

/** TAR `registerAdmin` operation. */
export class RegisterAdmin extends CantonOperation<RegisterAdminParams, ParsedRegisterAdminParams> {
  readonly name = 'registerAdmin'

  /** Validates instrument ID and the proposed admin party. */
  protected override validate(p: GenerateRegisterAdminParams): void {
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    parsePartyId(this.name, 'newAdmin', p.newAdmin)
  }

  /** Parses the instrument ID into `{ admin, id }` and validates CIDs. */
  protected override parse(p: GenerateRegisterAdminParams): ParsedRegisterAdminParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      tarCid: p.tarCid ? parseContractCid(this.name, 'tarCid', p.tarCid) : undefined,
      tokenConfigCid: p.tokenConfigCid
        ? parseContractCid(this.name, 'tokenConfigCid', p.tokenConfigCid)
        : undefined,
    }
  }

  /** Builds the `ProposeAdministrator` exercise command against the TAR. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedRegisterAdminParams,
  ): Promise<JsCommands> {
    const tarContract = await resolveTarRef(chain, p.sender, p.tarCid)
    const tokenConfigContract = await resolveTokenConfigRef(chain, p.instrumentId, p.tokenConfigCid)

    return buildTarExercise({
      choice: 'ProposeAdministrator',
      tarContract,
      tokenConfigContract,
      choiceArgument: { instrumentId: p.instrumentId, newAdmin: p.newAdmin },
      actAs: [p.sender],
      commandIdPrefix: 'cct-register-admin',
    })
  }
}
