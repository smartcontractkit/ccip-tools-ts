/**
 * getAdvancedPoolHooks — reads the `AdvancedPoolHooks` contract a v2.0.0+ TokenPool is bound to.
 *
 * @remarks The zero address is a normal result, not an error: it means no hooks are bound, so
 * the pool enforces no sender allowlist and no CCV requirements. Callers that need a bound
 * contract should treat that case explicitly.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  readTokenPoolAdvancedPoolHooks,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetAdvancedPoolHooks}. */
export type GetAdvancedPoolHooksParams = {
  /** Token pool to read. */
  poolAddress: string
}

/**
 * The bound `AdvancedPoolHooks` contract, checksummed; the zero address when none is bound.
 */
export type GetAdvancedPoolHooksResult = string

/** Reads the hooks contract bound to a v2.0.0 pool. */
export class GetAdvancedPoolHooks extends EVMQuery<
  GetAdvancedPoolHooksParams,
  GetAdvancedPoolHooksResult
> {
  readonly name = 'getAdvancedPoolHooks'

  /** The v2.0.0 getter is inherited until a later pool ABI changes its result shape. */
  private readonly readers: Partial<
    Record<TokenPoolVersion, typeof readTokenPoolAdvancedPoolHooks>
  > = {
    [TokenPoolVersion.V2_0_0]: readTokenPoolAdvancedPoolHooks,
  }

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetAdvancedPoolHooksParams): GetAdvancedPoolHooksParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the compatible getter through the same floor-match as pool writes, so a newer pool
   * inherits v2.0.0's read until its ABI changes.
   *
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTOperationUnsupportedError} on a pre-v2.0.0 pool
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAdvancedPoolHooksParams,
  ): Promise<GetAdvancedPoolHooksResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    const read = resolveEncoder(this.readers, version, this.name)
    return read(chain, poolAddress)
  }
}
