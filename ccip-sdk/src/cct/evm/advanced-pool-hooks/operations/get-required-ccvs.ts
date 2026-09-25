/**
 * Resolves the CCVs `AdvancedPoolHooks` requires for a proposed transfer.
 *
 * @remarks The deployed hooks ignore the interface's `localToken`, finality-config, and extra-data
 * arguments, so this query supplies their neutral values internally.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress, validateUint256, validateUint64 } from '../../validate.ts'
import { assertAdvancedPoolHooksContract, readRequiredCCVs } from '../contracts.ts'

/** Transfer direction accepted by `IPoolV2.MessageDirection`. */
export type CCVMessageDirection = 'outbound' | 'inbound'

/**
 * Parameters for {@link GetRequiredCCVs}.
 *
 * @remarks `IAdvancedPoolHooks.getRequiredCCVs` also accepts local-token, finality-config, and
 * extra-data arguments, but this `AdvancedPoolHooks` implementation does not inspect them. The
 * query supplies their neutral values internally, so callers need only provide the inputs that
 * affect its result: selector, amount, and direction.
 */
export type GetRequiredCCVsParams = {
  /** Hooks contract to read. */
  advancedPoolHooks: string
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
  /** Transfer amount (`uint256`). */
  amount: bigint
  /** Whether this resolves outbound or inbound requirements. */
  direction: CCVMessageDirection
}

/** Required CCV addresses, in the hooks contract's configured order. */
export type GetRequiredCCVsResult = string[]

/** Resolves the CCV set required for a transfer. */
export class GetRequiredCCVs extends EVMQuery<GetRequiredCCVsParams, GetRequiredCCVsResult> {
  readonly name = 'getRequiredCCVs'

  protected prepare(params: GetRequiredCCVsParams): GetRequiredCCVsParams {
    validateNonZeroAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    validateUint256(this.name, 'amount', params.amount)
    const direction: unknown = (params as { direction: unknown }).direction
    if (direction !== 'outbound' && direction !== 'inbound')
      throw new CCTParamsInvalidError(this.name, 'direction', 'must be outbound or inbound')
    return params
  }

  protected async read(
    chain: EVMChain,
    params: GetRequiredCCVsParams,
  ): Promise<GetRequiredCCVsResult> {
    await assertAdvancedPoolHooksContract(chain, params.advancedPoolHooks)
    return readRequiredCCVs(
      chain,
      params.advancedPoolHooks,
      params.remoteChainSelector,
      params.amount,
      params.direction === 'outbound' ? 0n : 1n,
    )
  }
}
