/**
 * getTokenAdminRegistry — reads a token's TokenAdminRegistry entry: its administrator, any
 * pending administrator, and its registered pool. Version-independent (v1.5–v2.0 share one
 * `getTokenConfig` encoding).
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { RegistryTokenConfig } from '../../../../chain.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { readTokenAdminRegistryConfig } from '../contracts.ts'

/** Parameters for {@link GetTokenAdminRegistry}. */
export type GetTokenAdminRegistryParams = {
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a
   * direct lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and
   * need a configured lane.
   */
  address: string
  /** Token to read the registry entry for. */
  tokenAddress: string
}

/**
 * Result of {@link GetTokenAdminRegistry}: the TAR entry for one token.
 * @remarks `administrator` may be {@link ZeroAddress} for a token pending acceptance;
 * test with `=== ZeroAddress`, not truthiness.
 */
export type GetTokenAdminRegistryResult = RegistryTokenConfig

/**
 * Reads a token's TokenAdminRegistry entry directly through `getTokenConfig`, reporting a zero
 * `administrator` rather than throwing.
 * @remarks Deliberately diverges from `EVMChain.getRegistryTokenConfig`, which throws
 * `CCIPTokenNotConfiguredError` whenever `administrator === ZeroAddress` — exactly the
 * post-`registerAdmin`, pre-`acceptAdmin` state, which made a pending registration
 * unobservable through the public read API. This op reads `getTokenConfig` through
 * {@link readTokenAdminRegistryConfig} instead of delegating to that helper, so
 * `{ administrator: ZeroAddress, pendingAdministrator }` is reported faithfully.
 * `pendingAdministrator` and `tokenPool` are still omitted when zero (nothing pending, no pool
 * registered) — only `administrator` survives as the zero address, since that is the one state
 * this op exists to surface.
 */
export class GetTokenAdminRegistry extends EVMQuery<
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult
> {
  readonly name = 'getTokenAdminRegistry'

  /**
   * Validates both addresses; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `address` or `tokenAddress` is not a valid address
   */
  protected prepare(params: GetTokenAdminRegistryParams): GetTokenAdminRegistryParams {
    validateAddress(this.name, 'address', params.address)
    validateAddress(this.name, 'tokenAddress', params.tokenAddress)
    return params
  }

  /** Resolves the TAR from `address`, then reads and normalizes `getTokenConfig(tokenAddress)`. */
  protected async read(
    chain: EVMChain,
    { address, tokenAddress }: GetTokenAdminRegistryParams,
  ): Promise<GetTokenAdminRegistryResult> {
    const registry = await chain.getTokenAdminRegistryFor(address)
    const config = await readTokenAdminRegistryConfig(chain, registry, tokenAddress)

    return {
      // unlike EVMChain.getRegistryTokenConfig, a zero administrator is reported, not thrown —
      // that's the whole point of this op (see the class @remarks). The two optional fields are
      // dropped when zero, so callers can test presence rather than compare against ZeroAddress.
      administrator: config.administrator,
      ...(config.pendingAdministrator !== ZeroAddress && {
        pendingAdministrator: config.pendingAdministrator,
      }),
      ...(config.tokenPool !== ZeroAddress && { tokenPool: config.tokenPool }),
    }
  }
}
