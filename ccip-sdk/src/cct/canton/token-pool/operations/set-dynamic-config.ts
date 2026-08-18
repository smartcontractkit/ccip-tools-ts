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
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parsePartyId } from '../../validate.ts'
import { buildPoolExercise, resolvePoolRef, type PoolContractRef } from '../shared.ts'

/** Parameters shared by `setDynamicConfig` generation and execution. */
export interface SetDynamicConfigParams {
  /**
   * Pool `InstanceAddress` — the canonical target identifier (mirrors Go
   * `ChoiceInput.InstanceAddress`). Either the `0x<64-hex>` keccak256 hash, or
   * the `RawInstanceAddress` `"instanceId@poolOwner"` form. The SDK resolves the
   * pool CID + disclosure blob from the ACS via
   * {@link CantonChain.findActiveContractByInstanceAddress}.
   */
  poolInstanceAddress: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
  /** New rate-limit admin party. Omit to clear. */
  rateLimitAdmin?: string
  /**
   * Pre-resolved pool contract reference (CID + `createdEventBlob` +
   * `synchronizerId`). When provided, {@link generate} skips the ACS fetch and
   * builds the unsigned tx offline (no participant connection needed). Omit to
   * let the op resolve it from the ACS (requires a connected {@link CantonChain}).
   */
  poolContract?: PoolContractRef
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

  /** Validates the pool target + rate-limit admin party. */
  protected override validate(p: GenerateSetDynamicConfigParams): void {
    if (!p.poolInstanceAddress && !p.poolContract) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        'poolInstanceAddress (or poolContract for offline generate) is required',
      )
    }
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

    // Offline-generate: caller-supplied ref (no ACS fetch). Otherwise resolve
    // by InstanceAddress from the ACS.
    const poolContract =
      p.poolContract ??
      (await resolvePoolRef(chain, p.poolType, p.sender, p.poolInstanceAddress))

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
