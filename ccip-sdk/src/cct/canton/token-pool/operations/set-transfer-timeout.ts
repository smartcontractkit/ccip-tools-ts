/**
 * setTransferTimeout — update a pool's transfer timeout via the consuming
 * `SetTransferTimeout` choice (returns the new pool CID). Callable by the
 * pool owner.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { SetTransferTimeoutArg } from '../../daml-types.ts'
import { type TransferTimeout, encodeTransferTimeout } from '../../encoding.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { POOL_TEMPLATE_IDS, buildPoolExercise, resolvePool, toContractRef } from '../shared.ts'
import { type ExecutePoolChoiceResult, PoolChoiceOperation } from './pool-choice-operation.ts'

/** Parameters shared by `setTransferTimeout` generation and execution. */
export interface SetTransferTimeoutParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`), of either pool type. */
  poolInstanceAddress: string
  /** New transfer timeout. */
  transferTimeout: TransferTimeout
}

/** Parameters for unsigned `setTransferTimeout` generation. */
export type GenerateSetTransferTimeoutParams = CantonGenerateParams<SetTransferTimeoutParams>

/** Unsigned `setTransferTimeout` result. */
export type GenerateSetTransferTimeoutResult = UnsignedCantonTx

/** Parameters for executing `setTransferTimeout`. */
export type ExecuteSetTransferTimeoutParams = CantonExecuteParams<SetTransferTimeoutParams>

/** Result of executing `setTransferTimeout`. */
export type ExecuteSetTransferTimeoutResult = ExecutePoolChoiceResult

/** Pool `setTransferTimeout` operation. */
export class SetTransferTimeout extends PoolChoiceOperation<SetTransferTimeoutParams> {
  readonly name = 'setTransferTimeout'
  protected readonly poolChoice = 'SetTransferTimeout'

  protected override prepare(
    p: GenerateSetTransferTimeoutParams,
  ): GenerateSetTransferTimeoutParams {
    super.prepare(p)
    // A negative RelativeHours yields an already-expired transfer window
    // on-ledger, bricking inbound transfers after source-chain lock/burn.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (p.transferTimeout?.type === 'RelativeHours') {
      const { hours } = p.transferTimeout
      const DAML_INT_MAX = 9223372036854775807n // Daml Int is signed 64-bit
      const isInteger = typeof hours === 'bigint' || Number.isInteger(hours)
      if (!isInteger || BigInt(hours) < 0n || BigInt(hours) > DAML_INT_MAX) {
        throw new CCTParamsInvalidError(
          this.name,
          'transferTimeout',
          `RelativeHours must be an integer in 0..2^63-1, got ${hours}`,
        )
      }
    }
    return p
  }

  /** Builds the `SetTransferTimeout` exercise command against the pool. */
  protected async buildCommands(
    chain: CantonChain,
    p: GenerateSetTransferTimeoutParams,
  ): Promise<JsCommands> {
    const { contract, poolType } = await resolvePool(
      this.name,
      chain,
      p.sender,
      p.poolInstanceAddress,
    )
    const choiceArgument: SetTransferTimeoutArg = {
      newTransferTimeout: encodeTransferTimeout(p.transferTimeout),
    }
    return buildPoolExercise({
      choice: this.poolChoice,
      templateId: POOL_TEMPLATE_IDS[poolType],
      poolContract: toContractRef(contract),
      choiceArgument,
      actAs: [p.sender],
      commandIdPrefix: 'cct-set-transfer-timeout',
    })
  }
}
