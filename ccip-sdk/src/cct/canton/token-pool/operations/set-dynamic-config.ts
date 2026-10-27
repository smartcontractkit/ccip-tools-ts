/**
 * setDynamicConfig — update a pool's dynamic config (currently just the
 * `rateLimitAdmin`) via the consuming `SetDynamicConfig` choice (returns the
 * new pool CID). Callable by the pool owner; pass `null` to clear the admin.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import type { SetDynamicConfigArg } from '../../daml-types.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { parsePartyId } from '../../validate.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** Parameters shared by `setDynamicConfig` generation and execution. */
export interface SetDynamicConfigParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Rate-limit admin party — may call `SetRateLimitConfig`. `null` clears it. */
  rateLimitAdmin: string | null
}

/** Parameters for unsigned `setDynamicConfig` generation. */
export type GenerateSetDynamicConfigParams = CantonGenerateParams<SetDynamicConfigParams>

/** Unsigned `setDynamicConfig` result. */
export type GenerateSetDynamicConfigResult = UnsignedCantonTx

/** Parameters for executing `setDynamicConfig`. */
export type ExecuteSetDynamicConfigParams = CantonExecuteParams<SetDynamicConfigParams>

/** Result of executing `setDynamicConfig`. */
export type ExecuteSetDynamicConfigResult = ExecutePoolChoiceResult

/** Pool `setDynamicConfig` operation. */
export class SetDynamicConfig extends PoolChoiceOperation<SetDynamicConfigParams> {
  readonly name = 'setDynamicConfig'
  protected readonly poolChoice = 'SetDynamicConfig'

  protected override prepare(p: GenerateSetDynamicConfigParams): GenerateSetDynamicConfigParams {
    super.prepare(p)
    if (p.rateLimitAdmin != null) parsePartyId(this.name, 'rateLimitAdmin', p.rateLimitAdmin)
    return p
  }

  /** Builds the `SetDynamicConfig` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetDynamicConfigParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    const choiceArgument: SetDynamicConfigArg = { rateLimitAdmin: p.rateLimitAdmin ?? null }
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-dynamic-config',
    })
  }
}
