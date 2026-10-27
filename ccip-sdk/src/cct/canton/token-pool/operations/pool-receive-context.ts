/**
 * Pool receive-context operations — manage the choice-context entries merged
 * into `extraArgs` for inbound transfers (e.g. preapproval CIDs in Splice
 * token patterns). All four choices consume the pool and return the new pool
 * CID; all are callable by the pool owner.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { AnyValueArg } from '../../daml-types.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** Shared base: resolves the pool and builds the given choice against it. */
abstract class PoolReceiveContextOperation<
  P extends { poolInstanceAddress: string },
> extends PoolChoiceOperation<P> {
  /** The choice argument record for this operation. */
  protected abstract choiceArgument(p: CantonGenerateParams<P>): Record<string, unknown>

  protected validateKey(p: CantonGenerateParams<P> & { contextKey?: string }): void {
    super.prepare(p)
    if (!p.contextKey) {
      throw new CCTParamsInvalidError(this.name, 'contextKey', 'context key is required')
    }
  }

  protected async buildCommands(
    chain: CantonChain,
    p: CantonGenerateParams<P>,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument: this.choiceArgument(p),
      actAs: [p.sender],
      commandIdPrefix: 'cct-pool-receive-context',
    })
  }
}

/** Scalar receive-context value (contract IDs use {@link AddPoolReceiveContextContractValue}). */
export type PoolReceiveContextValue = string | number | bigint | boolean

/** Encode a scalar as a Daml `AnyValue` variant (integers → `AV_Int`, non-integer numbers → `AV_Decimal`). */
function encodeAnyValue(v: PoolReceiveContextValue): AnyValueArg {
  switch (typeof v) {
    case 'string':
      return { tag: 'AV_Text', value: v }
    case 'boolean':
      return { tag: 'AV_Bool', value: v }
    case 'bigint':
      return { tag: 'AV_Int', value: v.toString() }
    default:
      return Number.isInteger(v)
        ? { tag: 'AV_Int', value: v.toString() }
        : { tag: 'AV_Decimal', value: v.toString() }
  }
}

/** Parameters shared by `addPoolReceiveContextValue` generation and execution. */
export interface AddPoolReceiveContextValueParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Context entry key. */
  contextKey: string
  /** Scalar value (`string`/`number`/`bigint`/`boolean`). */
  value: PoolReceiveContextValue
}

/** Parameters for unsigned `addPoolReceiveContextValue` generation. */
export type GenerateAddPoolReceiveContextValueParams =
  CantonGenerateParams<AddPoolReceiveContextValueParams>

/** Unsigned `addPoolReceiveContextValue` result. */
export type GenerateAddPoolReceiveContextValueResult = UnsignedCantonTx

/** Parameters for executing `addPoolReceiveContextValue`. */
export type ExecuteAddPoolReceiveContextValueParams =
  CantonExecuteParams<AddPoolReceiveContextValueParams>

/** Result of executing `addPoolReceiveContextValue`. */
export type ExecuteAddPoolReceiveContextValueResult = ExecutePoolChoiceResult

/** Pool `addPoolReceiveContextValue` operation (non-contract `AnyValue` entry). */
export class AddPoolReceiveContextValue extends PoolReceiveContextOperation<AddPoolReceiveContextValueParams> {
  readonly name = 'addPoolReceiveContextValue'
  protected readonly poolChoice = 'AddPoolReceiveContextNonContractValue'

  protected override prepare(
    p: GenerateAddPoolReceiveContextValueParams,
  ): GenerateAddPoolReceiveContextValueParams {
    this.validateKey(p)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard for untyped callers
    if (p.value === undefined || p.value === null || Number.isNaN(p.value)) {
      throw new CCTParamsInvalidError(this.name, 'value', 'a scalar value is required')
    }
    return p
  }

  protected choiceArgument(p: GenerateAddPoolReceiveContextValueParams): Record<string, unknown> {
    return { contextKey: p.contextKey, value: encodeAnyValue(p.value) }
  }
}

/** Parameters shared by `addPoolReceiveContextContractValue` generation and execution. */
export interface AddPoolReceiveContextContractValueParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Context entry key. */
  contextKey: string
  /** Already-resolved contract ID to store as `AV_ContractId` (e.g. a preapproval CID). */
  referredContract: string
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

/** Pool `addPoolReceiveContextContractValue` operation (`AV_ContractId` entry). */
export class AddPoolReceiveContextContractValue extends PoolReceiveContextOperation<AddPoolReceiveContextContractValueParams> {
  readonly name = 'addPoolReceiveContextContractValue'
  protected readonly poolChoice = 'AddPoolReceiveContextContractValue'

  protected override prepare(
    p: GenerateAddPoolReceiveContextContractValueParams,
  ): GenerateAddPoolReceiveContextContractValueParams {
    this.validateKey(p)
    if (!p.referredContract) {
      throw new CCTParamsInvalidError(this.name, 'referredContract', 'contract ID is required')
    }
    return p
  }

  protected choiceArgument(
    p: GenerateAddPoolReceiveContextContractValueParams,
  ): Record<string, unknown> {
    return { contextKey: p.contextKey, referredContract: p.referredContract }
  }
}

/** Parameters shared by `removePoolReceiveContextValue` generation and execution. */
export interface RemovePoolReceiveContextValueParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** Context entry key to remove. */
  contextKey: string
}

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

/** Pool `removePoolReceiveContextValue` operation. */
export class RemovePoolReceiveContextValue extends PoolReceiveContextOperation<RemovePoolReceiveContextValueParams> {
  readonly name = 'removePoolReceiveContextValue'
  protected readonly poolChoice = 'RemovePoolReceiveContextValue'

  protected override prepare(
    p: GenerateRemovePoolReceiveContextValueParams,
  ): GenerateRemovePoolReceiveContextValueParams {
    this.validateKey(p)
    return p
  }

  protected choiceArgument(
    p: GenerateRemovePoolReceiveContextValueParams,
  ): Record<string, unknown> {
    return { contextKey: p.contextKey }
  }
}

/** Parameters shared by `clearPoolReceiveContext` generation and execution. */
export interface ClearPoolReceiveContextParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
}

/** Parameters for unsigned `clearPoolReceiveContext` generation. */
export type GenerateClearPoolReceiveContextParams =
  CantonGenerateParams<ClearPoolReceiveContextParams>

/** Unsigned `clearPoolReceiveContext` result. */
export type GenerateClearPoolReceiveContextResult = UnsignedCantonTx

/** Parameters for executing `clearPoolReceiveContext`. */
export type ExecuteClearPoolReceiveContextParams =
  CantonExecuteParams<ClearPoolReceiveContextParams>

/** Result of executing `clearPoolReceiveContext`. */
export type ExecuteClearPoolReceiveContextResult = ExecutePoolChoiceResult

/** Pool `clearPoolReceiveContext` operation (drops all context entries). */
export class ClearPoolReceiveContext extends PoolChoiceOperation<ClearPoolReceiveContextParams> {
  readonly name = 'clearPoolReceiveContext'
  protected readonly poolChoice = 'ClearPoolReceiveContext'

  /** Builds the `ClearPoolReceiveContext` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateClearPoolReceiveContextParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument: {},
      actAs: [p.sender],
      commandIdPrefix: 'cct-clear-pool-receive-context',
    })
  }
}
