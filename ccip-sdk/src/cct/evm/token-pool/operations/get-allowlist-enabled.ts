/**
 * getAllowlistEnabled — reads whether a token pool enforces a sender allowlist: its own flag on
 * v1.5.0–v1.6.1, its bound `AdvancedPoolHooks`' flag on v2.0.0.
 *
 * @remarks Fixed for the holder's lifetime: `allowlistEnabled` is `immutable`, set to
 * `allowlist.length > 0` at deploy. A v2.0.0 pool with no hooks bound reads `false`, which is what
 * it enforces; binding hooks deployed with an allowlist is the only way to turn it on.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenPoolAllowlist, resolveAllowlistHolder } from '../contracts.ts'

/** Parameters for {@link GetAllowlistEnabled}. */
export type GetAllowlistEnabledParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** Whether the pool enforces a sender allowlist. */
export type GetAllowlistEnabledResult = boolean

/** Reads whether a token pool enforces a sender allowlist. */
export class GetAllowlistEnabled extends EVMQuery<
  GetAllowlistEnabledParams,
  GetAllowlistEnabledResult
> {
  readonly name = 'getAllowlistEnabled'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetAllowlistEnabledParams): GetAllowlistEnabledParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves which contract holds the allowlist, then reads its flag. No getter call when a v2.0.0
   * pool has no hooks bound.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAllowlistEnabledParams,
  ): Promise<GetAllowlistEnabledResult> {
    const { holder } = await resolveAllowlistHolder(chain, poolAddress)
    // a v2.0.0 pool with no hooks bound enforces no allowlist
    if (holder === ZeroAddress) return false
    return (await readTokenPoolAllowlist(chain, holder)).enabled
  }
}
