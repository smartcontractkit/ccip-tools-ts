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
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseInstrumentId, parsePartyId } from '../../validate.ts'
import { EMPTY_CHOICE_CONTEXT } from '../../encoding.ts'
import {
  buildTarExercise,
  deriveTokenConfigInstanceAddress,
  TAR_TEMPLATE_ID,
  TOKEN_CONFIG_TEMPLATE_ID,
  toContractRef,
} from '../shared.ts'

/** Parameters shared by TAR `transferAdmin` generation and execution. */
export interface TransferAdminParams {
  /** Instrument to transfer admin for (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Party to transfer the admin role to. */
  newAdmin: string
  /** TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`). Resolved via ACS. */
  tarInstanceAddress: string
  /**
   * `TokenConfig` `InstanceAddress` — optional; derived offline from the
   * instrument ID + TAR owner (ccipOwner) when omitted.
   */
  tokenConfigInstanceAddress?: string
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
        `TokenConfig ${tokenConfigInstanceAddress} is not active or not visible`,
      )
    }

    return buildTarExercise({
      choice: 'TransferAdminRole',
      tarContract: toContractRef(tarContract),
      tokenConfigContract: toContractRef(tokenConfigContract),
      choiceArgument: {
        tokenConfigCid: tokenConfigContract.contractId,
        instrumentId: p.instrumentId,
        newAdmin: p.newAdmin,
        context: EMPTY_CHOICE_CONTEXT,
        caller: p.sender,
      },
      actAs: [p.sender],
      commandIdPrefix: 'cct-transfer-admin',
    })
  }
}
