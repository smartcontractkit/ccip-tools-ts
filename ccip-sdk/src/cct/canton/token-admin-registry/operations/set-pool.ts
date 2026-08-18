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
import { type CantonExecuteParams, CantonOperation } from '../../operation.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseContractCid, parseInstrumentId, parsePartyId } from '../../validate.ts'
import { buildTarExercise, resolveTarCid, resolveTokenConfigCid } from '../shared.ts'

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
  /** TAR contract ID. When omitted, the operation resolves it via ACS. */
  tarCid?: string
  /** `TokenConfig` contract ID for the instrument. When omitted, resolved via ACS. */
  tokenConfigCid?: string
}

/** Parsed `setPool` params: instrument ID normalized, CIDs validated. */
type ParsedSetPoolParams = Omit<CantonExecuteParams<SetPoolParams>, 'instrumentId' | 'tarCid' | 'tokenConfigCid'> & {
  instrumentId: { admin: string; id: string }
  tarCid?: string
  tokenConfigCid?: string
}

/** Parameters for unsigned TAR `setPool` generation. */
export type GenerateSetPoolParams = CantonExecuteParams<SetPoolParams>

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

  /** Parses the instrument ID into `{ admin, id }` and validates CIDs. */
  protected override parse(p: GenerateSetPoolParams): ParsedSetPoolParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      tarCid: p.tarCid ? parseContractCid(this.name, 'tarCid', p.tarCid) : undefined,
      tokenConfigCid: p.tokenConfigCid
        ? parseContractCid(this.name, 'tokenConfigCid', p.tokenConfigCid)
        : undefined,
    }
  }

  /** Builds the `SetPool` exercise command against the TAR. */
  protected async buildCommands(chain: CantonChain, p: ParsedSetPoolParams): Promise<JsCommands> {
    const tarCid = p.tarCid ?? (await resolveTarCid(chain, p.wallet))
    const tokenConfigCid = p.tokenConfigCid ?? (await resolveTokenConfigCid(chain, p.instrumentId))

    const choiceArgument: Record<string, unknown> = {
      instrumentId: p.instrumentId,
      // tokenPool is optional; omit the key entirely to delist (Daml `None`).
      ...(p.poolRegistration && {
        tokenPool: {
          poolOwner: p.poolRegistration.poolOwner,
          poolInstanceId: p.poolRegistration.poolInstanceId,
        },
      }),
    }

    return buildTarExercise({
      choice: 'SetPool',
      tarCid,
      tokenConfigCid,
      choiceArgument,
      actAs: [p.wallet.party],
      commandIdPrefix: 'cct-set-pool',
    })
  }
}
