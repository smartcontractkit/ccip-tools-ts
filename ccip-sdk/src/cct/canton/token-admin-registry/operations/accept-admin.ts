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
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseInstrumentId } from '../../validate.ts'
import { EMPTY_CHOICE_CONTEXT } from '../../encoding.ts'
import {
  buildTarExercise,
  deriveTokenConfigInstanceAddress,
  TAR_TEMPLATE_ID,
  TOKEN_CONFIG_TEMPLATE_ID,
  toContractRef,
} from '../shared.ts'

/** Parameters shared by TAR `acceptAdmin` generation and execution. */
export interface AcceptAdminParams {
  /** Instrument to accept admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`). Resolved via ACS. */
  tarInstanceAddress: string
  /**
   * `TokenConfig` `InstanceAddress` — optional; derived offline from the
   * instrument ID + TAR owner (ccipOwner) when omitted.
   */
  tokenConfigInstanceAddress?: string
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
    // Resolve with the full active contract — the TAR's signatory (ccipOwner)
    // is needed to derive the TokenConfig address when it isn't passed in.
    // The TAR has no observer for token admins, so the query includes
    // chain.ccipParty (the ledger JWT needs readAs over it).
    const queryParties = [...new Set([p.sender, chain.ccipParty])]
    const tarContract = await chain.findActiveContractByInstanceAddress(
      TAR_TEMPLATE_ID,
      p.tarInstanceAddress,
      queryParties,
    )
    if (!tarContract) {
      throw new CCTParamsInvalidError(
        this.name,
        'tarInstanceAddress',
        `TokenAdminRegistry ${p.tarInstanceAddress} is not active or not visible to ${p.sender}`,
      )
    }
    const ccipOwner = tarContract.signatories[0]
    const tokenConfigInstanceAddress =
      p.tokenConfigInstanceAddress ??
      (ccipOwner ? deriveTokenConfigInstanceAddress(p.instrumentId, ccipOwner) : undefined)
    if (!tokenConfigInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenConfigInstanceAddress',
        'could not derive the TokenConfig address (TAR has no signatory) — pass it explicitly',
      )
    }
    const tokenConfigContract = await chain.findActiveContractByInstanceAddress(
      TOKEN_CONFIG_TEMPLATE_ID,
      tokenConfigInstanceAddress,
      queryParties,
    )
    if (!tokenConfigContract) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenConfigInstanceAddress',
        `TokenConfig ${tokenConfigInstanceAddress} is not active or not visible — run registerAdmin first`,
      )
    }

    return buildTarExercise({
      choice: 'AcceptAdminRole',
      tarContract: toContractRef(tarContract),
      tokenConfigContract: toContractRef(tokenConfigContract),
      choiceArgument: {
        tokenConfigCid: tokenConfigContract.contractId,
        instrumentId: p.instrumentId,
        context: EMPTY_CHOICE_CONTEXT,
        caller: p.sender,
      },
      actAs: [p.sender],
      commandIdPrefix: 'cct-accept-admin',
    })
  }
}
