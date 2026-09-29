/**
 * getAllowlist — reads the sender allowlist a token pool enforces: its own on v1.5.0–v1.6.1, its
 * bound `AdvancedPoolHooks`' on v2.0.0.
 *
 * @remarks An empty list is a normal result: the allowlist may be disabled, enabled but emptied,
 * or (v2.0.0) there may be no hooks bound at all. Pair with `getAllowlistEnabled` to tell a
 * disabled allowlist from one that rejects every sender, and with `getAdvancedPoolHooks` to see
 * which hooks a v2.0.0 pool reads through.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenPoolAllowlist, resolveAllowlistHolder } from '../contracts.ts'

/** Parameters for {@link GetAllowlist}. */
export type GetAllowlistParams = {
  /** Token pool to read. */
  poolAddress: string
}

/** The allowlisted senders, checksummed, in on-chain order. */
export type GetAllowlistResult = string[]

/** Reads the sender allowlist a token pool enforces. */
export class GetAllowlist extends EVMQuery<GetAllowlistParams, GetAllowlistResult> {
  readonly name = 'getAllowlist'

  /** @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address */
  protected prepare(params: GetAllowlistParams): GetAllowlistParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves which contract holds the allowlist, then reads it. No getter call when a v2.0.0 pool
   * has no hooks bound.
   * @throws {@link CCTContractTypeInvalidError} if the pool's reported type is not supported
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetAllowlistParams,
  ): Promise<GetAllowlistResult> {
    const { holder } = await resolveAllowlistHolder(chain, poolAddress)
    // a v2.0.0 pool with no hooks bound enforces no allowlist
    if (holder === ZeroAddress) return []
    return (await readTokenPoolAllowlist(chain, holder)).entries
  }
}
