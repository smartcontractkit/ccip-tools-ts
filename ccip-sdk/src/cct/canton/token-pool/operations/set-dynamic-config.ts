/**
 * setDynamicConfig — set the pool's dynamic config (rate-limit admin) via the
 * `SetDynamicConfig` choice.
 *
 * Ported from the Go exerciser (`burn_mint_token_pool.go` `SetDynamicConfig`).
 * The Go choice arg is `SetDynamicConfig { rateLimitAdmin? }`.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonTransactionResult } from '../../types.ts'
import { type CantonExecuteParams, type CantonGenerateParams, CantonOperation } from '../../operation.ts'
import { parseContractCid, parsePartyId } from '../../validate.ts'
import { buildPoolExercise, resolvePoolRef } from '../shared.ts'

/** Parameters shared by `setDynamicConfig` generation and execution. */
export interface SetDynamicConfigParams {
  /** Pool contract ID. */
  poolCid: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
  /** New rate-limit admin party. Omit to clear. */
  rateLimitAdmin?: string
}

/** Parameters for unsigned `setDynamicConfig` generation. */
export type GenerateSetDynamicConfigParams = CantonGenerateParams<SetDynamicConfigParams>

/** Unsigned `setDynamicConfig` result. */
export type GenerateSetDynamicConfigResult = UnsignedCantonTx

/** Parameters for executing `setDynamicConfig`. */
export type ExecuteSetDynamicConfigParams = CantonExecuteParams<SetDynamicConfigParams>

/** Result of executing `setDynamicConfig`. */
export type ExecuteSetDynamicConfigResult = CantonTransactionResult & {
  /** Pool contract ID (unchanged for this non-consuming choice). */
  poolCid: string
}

/** Pool `setDynamicConfig` operation. */
export class SetDynamicConfig extends CantonOperation<SetDynamicConfigParams> {
  readonly name = 'setDynamicConfig'

  /** Validates the pool CID and rate-limit admin party. */
  protected override validate(p: GenerateSetDynamicConfigParams): void {
    parseContractCid(this.name, 'poolCid', p.poolCid)
    if (p.rateLimitAdmin) parsePartyId(this.name, 'rateLimitAdmin', p.rateLimitAdmin)
  }

  /** Builds the `SetDynamicConfig` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<SetDynamicConfigParams>,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint'
        ? '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
        : '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool'

    const poolContract = await resolvePoolRef(chain, p.poolCid, p.poolType, p.sender)

    return buildPoolExercise({
      choice: 'SetDynamicConfig',
      templateId,
      poolContract,
      choiceArgument: {
        // rateLimitAdmin is optional; omit the key to clear (Daml `None`).
        ...(p.rateLimitAdmin && { rateLimitAdmin: p.rateLimitAdmin }),
      },
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-dynamic-config',
    })
  }
}
