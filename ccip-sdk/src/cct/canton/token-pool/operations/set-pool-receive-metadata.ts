/**
 * setPoolReceiveMetadata — set a lock-release pool's holdings-disclosure labels
 * via the consuming `SetPoolReceiveMetadata` choice (returns the new pool CID).
 * Callable by the pool owner.
 *
 * Lock-release only: the burn-mint template has no such choice. The labels are
 * stamped on pool-owned holdings at lock time (`meta = poolReceiveMetadata`),
 * which is what DA's holdings disclosure API selects on — e.g.
 * `{ "cip-112/receiver.id": "ccip-public" }` makes the lockbox publicly
 * disclosable.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { MetadataArg } from '../../daml-types.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** Parameters shared by `setPoolReceiveMetadata` generation and execution. */
export interface SetPoolReceiveMetadataParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Holdings labels, e.g. `{ "cip-112/receiver.id": "ccip-public" }`. */
  metadata: Record<string, string>
}

/** Parameters for unsigned `setPoolReceiveMetadata` generation. */
export type GenerateSetPoolReceiveMetadataParams =
  CantonGenerateParams<SetPoolReceiveMetadataParams>

/** Unsigned `setPoolReceiveMetadata` result. */
export type GenerateSetPoolReceiveMetadataResult = UnsignedCantonTx

/** Parameters for executing `setPoolReceiveMetadata`. */
export type ExecuteSetPoolReceiveMetadataParams = CantonExecuteParams<SetPoolReceiveMetadataParams>

/** Result of executing `setPoolReceiveMetadata`. */
export type ExecuteSetPoolReceiveMetadataResult = ExecutePoolChoiceResult

/** Lock-release pool `setPoolReceiveMetadata` operation. */
export class SetPoolReceiveMetadata extends PoolChoiceOperation<SetPoolReceiveMetadataParams> {
  readonly name = 'setPoolReceiveMetadata'
  protected readonly poolChoice = 'SetPoolReceiveMetadata'

  protected override prepare(
    p: GenerateSetPoolReceiveMetadataParams,
  ): GenerateSetPoolReceiveMetadataParams {
    super.prepare(p)
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!p.metadata || Object.keys(p.metadata).length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'metadata',
        'at least one metadata label is required',
      )
    }
    for (const [k, v] of Object.entries(p.metadata)) {
      if (!k || typeof v !== 'string') {
        throw new CCTParamsInvalidError(this.name, 'metadata', 'keys and values must be strings')
      }
    }
    return p
  }

  /** Builds the `SetPoolReceiveMetadata` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetPoolReceiveMetadataParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    if (poolType !== 'lockRelease') {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        'SetPoolReceiveMetadata exists only on lock-release pools',
      )
    }
    const choiceArgument: { metadata: MetadataArg } = { metadata: { values: p.metadata } }
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-pool-receive-metadata',
    })
  }
}
