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

import type { CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTarAdminResult } from '../../types.ts'
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseInstrumentId, parsePartyId } from '../../validate.ts'
import { EMPTY_CHOICE_CONTEXT } from '../../encoding.ts'
import {
  buildTarExercise,
  deriveTokenConfigInstanceAddress,
  resolveTar,
  TOKEN_CONFIG_TEMPLATE_ID,
  toContractRef,
} from '../shared.ts'

/** Parameters shared by TAR `registerAdmin` generation and execution. */
export interface RegisterAdminParams {
  /** Instrument to propose an admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Party to propose as the new token admin. */
  newAdmin: string
  /** TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`). Resolved via ACS. */
  tarInstanceAddress: string
  /**
   * `TokenConfig` `InstanceAddress` — optional. When omitted, the address is
   * derived offline from the instrument ID + the TAR owner (the
   * `tarInstanceAddress` signatory). When the TokenConfig does not exist yet,
   * `tokenConfigCid: None` is sent and the choice creates it (first-time
   * registration).
   */
  tokenConfigInstanceAddress?: string
}

/** Parsed `registerAdmin` params. */
type ParsedRegisterAdminParams = Omit<
  CantonGenerateParams<RegisterAdminParams>,
  'instrumentId'
> & {
  instrumentId: { admin: string; id: string }
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

  /** Parses the instrument ID into `{ admin, id }`. */
  protected override parse(p: GenerateRegisterAdminParams): ParsedRegisterAdminParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
    }
  }

  /** Builds the `ProposeAdministrator` exercise command against the TAR. */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedRegisterAdminParams,
  ): Promise<JsCommands> {
    // Disclosure-service-first resolution — no ccipOwner visibility required.
    const { tarContract, ccipOwner } = await resolveTar(chain, p.sender, p.tarInstanceAddress)

    // Resolve the TokenConfig if it already exists; first-time registration
    // sends `tokenConfigCid: null` (Daml `None`) and the choice creates it.
    const queryParties = [...new Set([p.sender, chain.ccipParty])]
    const tokenConfigInstanceAddress =
      p.tokenConfigInstanceAddress ??
      (ccipOwner ? deriveTokenConfigInstanceAddress(p.instrumentId, ccipOwner) : undefined)
    let tokenConfigContract: CantonActiveContract | null = null
    if (tokenConfigInstanceAddress) {
      tokenConfigContract = await chain.findActiveContractByInstanceAddress(
        TOKEN_CONFIG_TEMPLATE_ID,
        tokenConfigInstanceAddress,
        queryParties,
      )
    }

    return buildTarExercise({
      choice: 'ProposeAdministrator',
      tarContract,
      tokenConfigContract: tokenConfigContract ? toContractRef(tokenConfigContract) : undefined,
      choiceArgument: {
        tokenConfigCid: tokenConfigContract ? tokenConfigContract.contractId : null,
        instrumentId: p.instrumentId,
        newAdmin: p.newAdmin,
        context: EMPTY_CHOICE_CONTEXT,
        caller: p.sender,
      },
      actAs: [p.sender],
      commandIdPrefix: 'cct-register-admin',
    })
  }
}
