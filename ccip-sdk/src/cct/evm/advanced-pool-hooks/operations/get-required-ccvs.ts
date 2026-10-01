/**
 * Resolves the CCVs the `AdvancedPoolHooks` bound to a v2.0.0 pool require for a proposed
 * transfer.
 *
 * @remarks The deployed hooks ignore the interface's `localToken`, finality-config, and extra-data
 * arguments, so this query supplies their neutral values internally.
 *
 * @remarks This asks the hooks directly, with `amount` exactly as given. The pool's own
 * `getRequiredCCVs` first deducts an enabled outbound transfer fee, and rescales an inbound amount
 * to local decimals, before consulting the same hooks — pass the amount the hooks will see.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress, validateUint256, validateUint64 } from '../../validate.ts'
import { readRequiredCCVs, resolveAdvancedPoolHooks } from '../contracts.ts'

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
  /** v2.0.0 token pool whose bound hooks are asked. */
  poolAddress: string
  /** Remote CCIP chain selector (`uint64`). */
  remoteChainSelector: bigint
  /** Transfer amount (`uint256`), passed to the hooks unchanged. */
  amount: bigint
  /** Whether this resolves outbound or inbound requirements. */
  direction: CCVMessageDirection
}

/** Required CCV addresses, in the hooks contract's configured order. */
export type GetRequiredCCVsResult = string[]

/** Resolves the CCV set required for a transfer. */
export class GetRequiredCCVs extends EVMQuery<GetRequiredCCVsParams, GetRequiredCCVsResult> {
  readonly name = 'getRequiredCCVs'

  /** @throws {@link CCTParamsInvalidError} if a param is invalid */
  protected prepare(params: GetRequiredCCVsParams): GetRequiredCCVsParams {
    validateNonZeroAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    validateUint256(this.name, 'amount', params.amount)
    const direction: unknown = (params as { direction: unknown }).direction
    if (direction !== 'outbound' && direction !== 'inbound')
      throw new CCTParamsInvalidError(this.name, 'direction', 'must be outbound or inbound')
    return params
  }

  /**
   * Resolves the pool's bound hooks, then asks them for the transfer's CCVs.
   * @throws {@link CCTContractTypeInvalidError} if the pool's type is not supported, or the bound
   * address is not `AdvancedPoolHooks`
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if the pool has no hooks bound
   */
  protected async read(
    chain: EVMChain,
    params: GetRequiredCCVsParams,
  ): Promise<GetRequiredCCVsResult> {
    const hooks = await resolveAdvancedPoolHooks(this.name, chain, params.poolAddress)
    return readRequiredCCVs(
      chain,
      hooks,
      params.remoteChainSelector,
      params.amount,
      params.direction === 'outbound' ? 0n : 1n,
    )
  }
}
