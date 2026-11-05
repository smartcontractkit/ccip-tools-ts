/**
 * getCurrentRateLimiterState: reads the raw inbound and outbound token buckets of one lane of a
 * token pool, at every supported version. The write side is `set-chain-rate-limiter-configs.ts`.
 *
 * @remarks Unlike core `EVMChain.getTokenPoolRemotes`, whose `RateLimiterState` maps a disabled
 * limiter to `null` and drops `lastUpdated` / `isEnabled`, this returns every bucket field as the
 * pool reports it.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress, validateBoolean, validateUint64 } from '../../validate.ts'
import {
  type TokenPoolRateLimiterState,
  TokenPoolVersion,
  readTokenPoolCurrentRateLimiterStateV1_5_0,
  readTokenPoolCurrentRateLimiterStateV2_0_0,
  readTokenPoolIsSupportedChain,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link GetCurrentRateLimiterState}. */
export type GetCurrentRateLimiterStateParams = {
  /** Token pool to read. */
  poolAddress: string
  /** CCIP selector of a lane the pool supports (`uint64`). */
  remoteChainSelector: bigint
  /**
   * Read the lane's fast-finality buckets instead of its finalized ones. v2.0.0 only: the older
   * pools have no fast-finality buckets, so setting it (to either value) on one is rejected.
   * Defaults to `false` on v2.0.0.
   */
  fastFinality?: boolean
}

/**
 * Result of {@link GetCurrentRateLimiterState}: the lane's two raw buckets. Each bucket's `tokens`
 * is the value the contract returns, already refilled to the read block on-chain, not a stored
 * balance.
 */
export type GetCurrentRateLimiterStateResult = TokenPoolRateLimiterState

/** One version's getter, and whether it takes the `fastFinality` flag. */
type StateReader = {
  /** Whether the getter takes `fastFinality`; when `false`, setting it is rejected. */
  hasFastFinality: boolean
  /** The getter; versions without `fastFinality` ignore the flag. */
  read: (
    chain: EVMChain,
    poolAddress: string,
    remoteChainSelector: bigint,
    fastFinality: boolean,
  ) => Promise<TokenPoolRateLimiterState>
}

/** Reads the raw inbound and outbound token buckets of one lane of a token pool. */
export class GetCurrentRateLimiterState extends EVMQuery<
  GetCurrentRateLimiterStateParams,
  GetCurrentRateLimiterStateResult
> {
  readonly name = 'getCurrentRateLimiterState'

  /**
   * v1.5.0 to v1.6.1 read one getter per direction; v2.0.0 replaced both with one
   * `getCurrentRateLimiterState(uint64, bool)`, hence its own entry.
   */
  private readonly readers: Partial<Record<TokenPoolVersion, StateReader>> = {
    [TokenPoolVersion.V1_5_0]: {
      hasFastFinality: false,
      read: readTokenPoolCurrentRateLimiterStateV1_5_0,
    },
    [TokenPoolVersion.V2_0_0]: {
      hasFastFinality: true,
      read: readTokenPoolCurrentRateLimiterStateV2_0_0,
    },
  }

  /**
   * Validates every param; whether `fastFinality` is allowed is only known once the pool version
   * is resolved, so {@link read} rejects it there.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address,
   * `remoteChainSelector` is not a `uint64`, or `fastFinality` is set and not a boolean
   */
  protected prepare(params: GetCurrentRateLimiterStateParams): GetCurrentRateLimiterStateParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    validateUint64(this.name, 'remoteChainSelector', params.remoteChainSelector)
    if (params.fastFinality !== undefined)
      validateBoolean(this.name, 'fastFinality', params.fastFinality)
    return params
  }

  /**
   * Resolves the pool's version to pick the getter, then checks the lane: the getters do not check
   * it, so an unsupported lane would read as a zeroed, disabled bucket instead of failing.
   * @remarks The `fastFinality` check runs before any getter, so a bad flag costs only the
   * `typeAndVersion` probe. `isSupportedChain` runs in parallel with the bucket read, which cannot
   * revert on an unknown lane, so the check costs no extra round trip.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   * @throws {@link CCTParamsInvalidError} if `fastFinality` is set on a pre-v2.0.0 pool, or the
   * pool does not support `remoteChainSelector`
   */
  protected async read(
    chain: EVMChain,
    { poolAddress, remoteChainSelector, fastFinality }: GetCurrentRateLimiterStateParams,
  ): Promise<GetCurrentRateLimiterStateResult> {
    const { version } = await resolveTokenPool(chain, poolAddress)
    const reader = resolveEncoder(this.readers, version, this.name)
    if (!reader.hasFastFinality && fastFinality !== undefined)
      throw new CCTParamsInvalidError(
        this.name,
        'fastFinality',
        `is only supported from pool version 2.0.0 (this pool is ${version}); omit it`,
      )
    const [isSupported, state] = await Promise.all([
      readTokenPoolIsSupportedChain(chain, poolAddress, remoteChainSelector),
      reader.read(chain, poolAddress, remoteChainSelector, fastFinality ?? false),
    ])
    if (!isSupported)
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        `is not a lane this pool supports (${remoteChainSelector}); add it with applyChainUpdates first`,
      )
    return state
  }
}
