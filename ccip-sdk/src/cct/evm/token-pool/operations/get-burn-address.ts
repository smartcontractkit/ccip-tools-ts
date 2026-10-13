/**
 * getBurnAddress: reads the address a BurnToAddress pool sends every outbound amount to
 * (v1.5.1, v1.6.1, v2.0.0).
 * Mirrors `get-rebalancer.ts`.
 *
 * @packageDocumentation
 */

import type { EVMChain } from '../../../../evm/index.ts'
import { CCTContractTypeInvalidError, CCTOperationUnsupportedError } from '../../../errors.ts'
import { EVMQuery } from '../../query.ts'
import { validateAddress } from '../../validate.ts'
import { TokenPoolVersion, readTokenPoolBurnAddress, resolveTokenPool } from '../contracts.ts'

/** Parameters for {@link GetBurnAddress}. */
export type GetBurnAddressParams = {
  /** BurnToAddress pool to read. */
  poolAddress: string
}

/** Versions BurnToAddress shipped at; `getBurnAddress()` is the same view on each. */
const BURN_TO_ADDRESS_VERSIONS: readonly TokenPoolVersion[] = [
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
  TokenPoolVersion.V2_0_0,
]

/** Result of {@link GetBurnAddress}: the burn address, checksummed. */
export type GetBurnAddressResult = string

/**
 * Reads a BurnToAddress pool's burn address, for audit and UX: it is immutable, so this is the
 * way to confirm a deployed pool sends to the address intended.
 */
export class GetBurnAddress extends EVMQuery<GetBurnAddressParams, GetBurnAddressResult> {
  readonly name = 'getBurnAddress'

  /**
   * Validates the pool address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is not a valid address
   */
  protected prepare(params: GetBurnAddressParams): GetBurnAddressParams {
    validateAddress(this.name, 'poolAddress', params.poolAddress)
    return params
  }

  /**
   * Resolves the pool's type/version before the read, so any other pool reports why instead of a
   * bare call failure on a getter it does not declare.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `BurnToAddressTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a version BurnToAddress never shipped at (1.5.0)
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async read(
    chain: EVMChain,
    { poolAddress }: GetBurnAddressParams,
  ): Promise<GetBurnAddressResult> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    if (type !== 'BurnToAddressTokenPool')
      throw new CCTContractTypeInvalidError(
        poolAddress,
        'BurnToAddressTokenPool',
        type,
        `${this.name} reads getBurnAddress(), which only BurnToAddress pools declare`,
        { context: { operation: this.name } },
      )
    if (!BURN_TO_ADDRESS_VERSIONS.includes(version))
      throw new CCTOperationUnsupportedError(this.name, version)
    return readTokenPoolBurnAddress(chain, poolAddress)
  }
}
