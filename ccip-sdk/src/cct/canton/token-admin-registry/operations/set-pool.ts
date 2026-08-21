/**
 * setPool — registers (or delists) a token pool for an instrument in the
 * Token Admin Registry (TAR) via the `SetPool` choice.
 *
 * Ported from the Go exerciser at
 * `chainlink-canton-fcr/deployment/operations/ccip/token_admin_registry/token_admin_registry.go`.
 * Omit `poolRegistration` to delist (the choice accepts an optional
 * `tokenPool`; `None` delists).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { CantonWallet, UnsignedCantonTx } from '../../../../canton/types.ts'
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

/** Pool registration: the pool owner party + the pool instance ID. */
export interface PoolRegistration {
  /** Pool owner party ID (`hint::1220…`). */
  poolOwner: string
  /** Pool instance ID (the `instanceId` passed to `deployTokenPool`). */
  poolInstanceId: string
}

/** Parameters shared by TAR `setPool` generation and execution. */
export interface SetPoolParams {
  /** Instrument to register/delist (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /**
   * Pool registration. Omit (or pass `undefined`) to delist the token from the
   * TAR — the `SetPool` choice accepts an optional `tokenPool`; `None` delists.
   */
  poolRegistration?: PoolRegistration
  /** TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`). Resolved via ACS. */
  tarInstanceAddress: string
  /**
   * `TokenConfig` `InstanceAddress` — optional; derived offline from the
   * instrument ID + TAR owner (ccipOwner) when omitted.
   */
  tokenConfigInstanceAddress?: string
}

/** Parsed `setPool` params: instrument ID normalized. */
type ParsedSetPoolParams = Omit<CantonGenerateParams<SetPoolParams>, 'instrumentId'> & {
  instrumentId: { admin: string; id: string }
}

/** Parameters for unsigned TAR `setPool` generation. */
export type GenerateSetPoolParams = CantonGenerateParams<SetPoolParams>

/** Unsigned TAR `setPool` result. */
export type GenerateSetPoolResult = UnsignedCantonTx

/** Parameters for executing TAR `setPool`. */
export type ExecuteSetPoolParams = CantonExecuteParams<SetPoolParams>

/** Result of executing TAR `setPool`. */
export type ExecuteSetPoolResult = CantonTarAdminResult

/** TAR `setPool` operation. */
export class SetPool extends CantonOperation<SetPoolParams, ParsedSetPoolParams> {
  readonly name = 'setPool'

  /** Validates party IDs, instrument ID, and pool registration fields. */
  protected override validate(p: GenerateSetPoolParams): void {
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    if (p.poolRegistration) {
      parsePartyId(this.name, 'poolRegistration.poolOwner', p.poolRegistration.poolOwner)
      if (!p.poolRegistration.poolInstanceId) {
        throw new CCTParamsInvalidError(
          this.name,
          'poolRegistration.poolInstanceId',
          'pool instance ID is required when poolRegistration is provided',
        )
      }
    }
  }

  /** Parses the instrument ID into `{ admin, id }`. */
  protected override parse(p: GenerateSetPoolParams): ParsedSetPoolParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
    }
  }

  /** Builds the `SetPool` exercise command against the TAR. */
  protected async buildCommands(chain: CantonChain, p: ParsedSetPoolParams): Promise<JsCommands> {
    // Disclosure-service-first resolution — no ccipOwner visibility required.
    const { tarContract, ccipOwner } = await resolveTar(chain, p.sender, p.tarInstanceAddress)
    const queryParties = [...new Set([p.sender, chain.ccipParty])]
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

    const choiceArgument: Record<string, unknown> = {
      tokenConfigCid: tokenConfigContract.contractId,
      instrumentId: p.instrumentId,
      // tokenPool is a Daml `Optional`; `null` (`None`) delists.
      tokenPool: p.poolRegistration
        ? {
            poolOwner: p.poolRegistration.poolOwner,
            poolInstanceId: p.poolRegistration.poolInstanceId,
          }
        : null,
      context: EMPTY_CHOICE_CONTEXT,
      caller: p.sender,
    }

    return buildTarExercise({
      choice: 'SetPool',
      tarContract,
      tokenConfigContract: toContractRef(tokenConfigContract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-pool',
    })
  }
}
