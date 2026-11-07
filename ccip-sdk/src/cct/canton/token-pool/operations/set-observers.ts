/**
 * setObservers — update a pool's EDS observer parties via the consuming
 * `SetObservers` choice (returns the new pool CID). Callable by the pool owner.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { SetObserversArg } from '../../daml-types.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { parsePartyId } from '../../validate.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** Parameters shared by `setObservers` generation and execution. */
export interface SetObserversParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Observer party IDs (used by EDS to auto-detect this pool). */
  observers: string[]
}

/** Parameters for unsigned `setObservers` generation. */
export type GenerateSetObserversParams = CantonGenerateParams<SetObserversParams>

/** Unsigned `setObservers` result. */
export type GenerateSetObserversResult = UnsignedCantonTx

/** Parameters for executing `setObservers`. */
export type ExecuteSetObserversParams = CantonExecuteParams<SetObserversParams>

/** Result of executing `setObservers`. */
export type ExecuteSetObserversResult = ExecutePoolChoiceResult

/** Pool `setObservers` operation. */
export class SetObservers extends PoolChoiceOperation<SetObserversParams> {
  readonly name = 'setObservers'
  protected readonly poolChoice = 'SetObservers'

  protected override prepare(p: GenerateSetObserversParams): GenerateSetObserversParams {
    super.prepare(p)
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!p.observers || p.observers.length === 0) {
      throw new CCTParamsInvalidError(this.name, 'observers', 'at least one observer is required')
    }
    p.observers.forEach((o, i) => parsePartyId(this.name, `observers[${i}]`, o))
    return p
  }

  /** Builds the `SetObservers` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetObserversParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    const choiceArgument: SetObserversArg = { observers: p.observers }
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-observers',
    })
  }
}
