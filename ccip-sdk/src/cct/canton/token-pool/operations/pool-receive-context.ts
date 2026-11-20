/**
 * Lock-release pool receive-context ops — pin (`addPoolReceiveContextContractValue`)
 * or unpin (`removePoolReceiveContextValue`) an entry of the pool's receive context
 * via the consuming `AddPoolReceiveContextContractValue` / `RemovePoolReceiveContextValue`
 * choices (owner only; each returns the new pool CID).
 *
 * The main use is the owner's `transfer-preapproval` entry: deploy pins it when a
 * preapproval exists, and these ops pin or re-pin it afterwards.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/clients/ledger-api/client.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type {
  AddPoolReceiveContextContractValueArg,
  RemovePoolReceiveContextValueArg,
} from '../../daml-types.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** Parameters shared by `addPoolReceiveContextContractValue` generation and execution. */
export interface AddPoolReceiveContextContractValueParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`) of a lock-release pool. */
  poolInstanceAddress: string
  /** Receive-context key, e.g. `transfer-preapproval`. */
  contextKey: string
  /** Contract ID to store under the key (added or replaced). */
  referredContract: string
}

/** Parameters shared by `removePoolReceiveContextValue` generation and execution. */
export interface RemovePoolReceiveContextValueParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`) of a lock-release pool. */
  poolInstanceAddress: string
  /** Receive-context key to remove. */
  contextKey: string
}

/** Parameters for unsigned `addPoolReceiveContextContractValue` generation. */
export type GenerateAddPoolReceiveContextContractValueParams =
  CantonGenerateParams<AddPoolReceiveContextContractValueParams>
/** Unsigned `addPoolReceiveContextContractValue` result. */
export type GenerateAddPoolReceiveContextContractValueResult = UnsignedCantonTx
/** Parameters for executing `addPoolReceiveContextContractValue`. */
export type ExecuteAddPoolReceiveContextContractValueParams =
  CantonExecuteParams<AddPoolReceiveContextContractValueParams>
/** Result of executing `addPoolReceiveContextContractValue`. */
export type ExecuteAddPoolReceiveContextContractValueResult = ExecutePoolChoiceResult

/** Parameters for unsigned `removePoolReceiveContextValue` generation. */
export type GenerateRemovePoolReceiveContextValueParams =
  CantonGenerateParams<RemovePoolReceiveContextValueParams>
/** Unsigned `removePoolReceiveContextValue` result. */
export type GenerateRemovePoolReceiveContextValueResult = UnsignedCantonTx
/** Parameters for executing `removePoolReceiveContextValue`. */
export type ExecuteRemovePoolReceiveContextValueParams =
  CantonExecuteParams<RemovePoolReceiveContextValueParams>
/** Result of executing `removePoolReceiveContextValue`. */
export type ExecuteRemovePoolReceiveContextValueResult = ExecutePoolChoiceResult

/** Build the exercise of a receive-context choice; only lock-release pools have these choices. */
async function buildReceiveContextExercise(
  opName: string,
  chain: CantonChain,
  p: { sender: string; poolInstanceAddress: string; commandId?: string },
  choice: string,
  choiceArgument: AddPoolReceiveContextContractValueArg | RemovePoolReceiveContextValueArg,
  commandIdPrefix: string,
): Promise<JsCommands> {
  const { contract, poolType } = await resolvePool(opName, chain, p.sender, p.poolInstanceAddress)
  if (poolType !== 'lockRelease') {
    throw new CCTParamsInvalidError(
      opName,
      'poolInstanceAddress',
      `${p.poolInstanceAddress} is a ${poolType} pool; receive-context choices exist only on lock-release pools`,
    )
  }
  return buildPoolExercise({
    choice,
    templateId: POOL_TEMPLATE_IDS[poolType],
    poolContract: toContractRef(contract),
    choiceArgument,
    actAs: [p.sender],
    commandIdPrefix,
    commandId: p.commandId,
  })
}

/** Lock-release pool `addPoolReceiveContextContractValue` operation. */
export class AddPoolReceiveContextContractValue extends PoolChoiceOperation<AddPoolReceiveContextContractValueParams> {
  readonly name = 'addPoolReceiveContextContractValue'
  protected readonly poolChoice = 'AddPoolReceiveContextContractValue'

  protected override prepare(
    p: GenerateAddPoolReceiveContextContractValueParams,
  ): GenerateAddPoolReceiveContextContractValueParams {
    super.prepare(p)
    if (!p.contextKey) {
      throw new CCTParamsInvalidError(this.name, 'contextKey', 'context key is required')
    }
    if (!p.referredContract) {
      throw new CCTParamsInvalidError(this.name, 'referredContract', 'contract ID is required')
    }
    return p
  }

  /** Builds the `AddPoolReceiveContextContractValue` exercise command against the pool. */
  protected buildCommands(
    chain: CantonChain,
    p: GenerateAddPoolReceiveContextContractValueParams,
  ): Promise<JsCommands> {
    return buildReceiveContextExercise(
      this.name,
      chain,
      p,
      this.poolChoice,
      { contextKey: p.contextKey, referredContract: p.referredContract },
      'cct-add-pool-receive-context-contract',
    )
  }
}

/** Lock-release pool `removePoolReceiveContextValue` operation. */
export class RemovePoolReceiveContextValue extends PoolChoiceOperation<RemovePoolReceiveContextValueParams> {
  readonly name = 'removePoolReceiveContextValue'
  protected readonly poolChoice = 'RemovePoolReceiveContextValue'

  protected override prepare(
    p: GenerateRemovePoolReceiveContextValueParams,
  ): GenerateRemovePoolReceiveContextValueParams {
    super.prepare(p)
    if (!p.contextKey) {
      throw new CCTParamsInvalidError(this.name, 'contextKey', 'context key is required')
    }
    return p
  }

  /** Builds the `RemovePoolReceiveContextValue` exercise command against the pool. */
  protected buildCommands(
    chain: CantonChain,
    p: GenerateRemovePoolReceiveContextValueParams,
  ): Promise<JsCommands> {
    return buildReceiveContextExercise(
      this.name,
      chain,
      p,
      this.poolChoice,
      { contextKey: p.contextKey },
      'cct-remove-pool-receive-context',
    )
  }
}
