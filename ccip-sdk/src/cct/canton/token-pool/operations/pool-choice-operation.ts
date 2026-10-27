/**
 * Shared base for one-off pool config operations: a consuming pool choice that
 * returns the new pool contract ID (`SetTransferTimeout`, `SetObservers`,
 * `SetDynamicConfig`, `SetRateLimiterReferences`,
 * `ApplyTokenTransferFeeConfigUpdates`, the pool receive-context choices).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { CantonExecuteParams, CantonGenerateParams } from '../../operation.ts'
import { CantonOperation, extractExerciseResult } from '../../operation.ts'
import type { CantonTransactionResult } from '../../types.ts'

/** Result of executing a consuming pool choice. */
export type ExecutePoolChoiceResult = CantonTransactionResult & {
  /** New pool contract ID (consuming choice → new CID). */
  poolCid: string
}

/** Base for pool config updates: validates the pool target; `execute` returns the new pool CID. */
export abstract class PoolChoiceOperation<
  P extends { poolInstanceAddress: string },
> extends CantonOperation<P> {
  /** The Daml choice name (used for result extraction). */
  protected abstract readonly poolChoice: string

  protected override prepare(p: CantonGenerateParams<P>): CantonGenerateParams<P> {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        'pool InstanceAddress is required',
      )
    }
    return p
  }

  override async execute(
    chain: CantonChain,
    params: CantonExecuteParams<P>,
  ): Promise<ExecutePoolChoiceResult> {
    const base = await super.execute(chain, params)
    const poolCid = extractExerciseResult(base.response, this.poolChoice)
    if (typeof poolCid !== 'string') {
      throw new CCTTxFailedError(
        this.name,
        `${this.poolChoice} exerciseResult was not a contract ID`,
        { context: { updateId: base.hash } },
      )
    }
    return { ...base, poolCid }
  }
}
