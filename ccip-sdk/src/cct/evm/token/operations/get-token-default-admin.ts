/**
 * getTokenDefaultAdmin — reads a v2.0.0 `CrossChainToken`'s AccessControl default admin: its
 * current `defaultAdmin()` and any scheduled `pendingDefaultAdmin()` transfer, together. Mirrors
 * how {@link GetTokenAdminRegistry} reports current + pending in one result.
 *
 * @packageDocumentation
 */

import { ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { EVMQuery } from '../../query.ts'
import { validateNonZeroAddress } from '../../validate.ts'
import { readPendingTokenDefaultAdmin, readTokenDefaultAdmin } from '../contracts.ts'

/** Parameters for {@link GetTokenDefaultAdmin}. */
export type GetTokenDefaultAdminParams = {
  /** CrossChainToken (v2.0.0) to read the default admin of. */
  tokenAddress: string
}

/** A scheduled default-admin transfer: the proposed admin and its acceptance timestamp. */
export type PendingTokenDefaultAdmin = {
  /** Address proposed as the next default admin. */
  newAdmin: string
  /** Unix timestamp at which {@link PendingTokenDefaultAdmin.newAdmin} may accept the role. */
  schedule: bigint
}

/**
 * Result of {@link GetTokenDefaultAdmin}: the token's current default admin, plus any pending
 * transfer.
 * @remarks `pendingDefaultAdmin` is omitted when no transfer is scheduled (`newAdmin` is the zero
 * address) — test presence with `'pendingDefaultAdmin' in result`, not a zero-address compare,
 * matching {@link GetTokenAdminRegistryResult}'s `pendingAdministrator`. `defaultAdmin` may itself
 * be {@link ZeroAddress} if the role has been renounced.
 */
export type GetTokenDefaultAdminResult = {
  /** Current default admin, checksummed. */
  defaultAdmin: string
  /** Scheduled transfer, present only when one is pending. */
  pendingDefaultAdmin?: PendingTokenDefaultAdmin
}

/**
 * Reads a CrossChainToken's `defaultAdmin()` and `pendingDefaultAdmin()` in parallel.
 * @remarks v2.0.0 `CrossChainToken` only: `FactoryBurnMintERC20` (v1.x) is Ownable2Step and does
 * not declare these getters — read its authority with {@link GetTokenOwner} instead. No version
 * resolution, mirroring {@link GetTokenAdminRegistry}; a non-v2 token reverts on the missing
 * getter rather than mis-decoding.
 */
export class GetTokenDefaultAdmin extends EVMQuery<
  GetTokenDefaultAdminParams,
  GetTokenDefaultAdminResult
> {
  readonly name = 'getTokenDefaultAdmin'

  /**
   * Validates the token address; nothing to convert for {@link read}.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a valid, non-zero address
   */
  protected prepare(params: GetTokenDefaultAdminParams): GetTokenDefaultAdminParams {
    validateNonZeroAddress(this.name, 'tokenAddress', params.tokenAddress)
    return params
  }

  /** Reads the current and pending default admin, dropping the pending field when none is scheduled. */
  protected async read(
    chain: EVMChain,
    { tokenAddress }: GetTokenDefaultAdminParams,
  ): Promise<GetTokenDefaultAdminResult> {
    const [defaultAdmin, pending] = await Promise.all([
      readTokenDefaultAdmin(chain, tokenAddress),
      readPendingTokenDefaultAdmin(chain, tokenAddress),
    ])

    return {
      defaultAdmin,
      // a zero `newAdmin` means nothing is scheduled — drop the field so callers test presence,
      // not a zero-address compare (see the result @remarks)
      ...(pending.newAdmin !== ZeroAddress && { pendingDefaultAdmin: pending }),
    }
  }
}
