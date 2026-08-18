/**
 * getTokenPoolState — read a token pool's config from the ACS: pool owner,
 * remote-chain configs, rate-limit admin. Implements the
 * `CantonChain.getTokenPoolConfig` stub.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { parseContractCid } from '../../validate.ts'

/** Parameters for `getTokenPoolState`. */
export interface GetTokenPoolStateParams {
  /** Pool contract ID, or instrument ID to resolve the pool from the TAR. */
  poolCid: string
  /** Pool type (determines the template ID for the ACS query). */
  poolType: 'burnMint' | 'lockRelease'
}

/** A remote-chain config entry on the pool. */
export interface PoolRemoteChainConfig {
  /** Remote chain selector. */
  remoteChainSelector: string
  /** Remote pool addresses. */
  remotePools: string[]
  /** Remote token address (encoded instrument ID). */
  remoteTokenAddress: string
}

/** Result of `getTokenPoolState`: the pool's config. */
export interface GetTokenPoolStateResult {
  /** Pool owner party ID. */
  poolOwner: string
  /** Pool instance ID. */
  poolInstanceId: string
  /** Rate-limit admin party (if set). */
  rateLimitAdmin?: string
  /** Per-remote-chain configs. */
  remoteChainConfigs: PoolRemoteChainConfig[]
  /** Instrument ID the pool bridges. */
  instrumentId: { admin: string; id: string }
  /** Token decimals. */
  decimals: number
}

/** Read a token pool's config from the ACS. */
export class GetTokenPoolState extends CantonQuery<
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
  { poolCid: string; templateId: string }
> {
  readonly name = 'getTokenPoolState'

  /** Validates the pool CID and normalizes the pool type into a template ID. */
  protected prepare(p: GetTokenPoolStateParams): { poolCid: string; templateId: string } {
    return {
      poolCid: parseContractCid(this.name, 'poolCid', p.poolCid),
      templateId:
        p.poolType === 'burnMint'
          ? '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
          : '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool',
    }
  }

  /**
   * Reads the pool contract from the ACS. TODO(cct-canton): query
   * `chain.acsDisclosureProvider` for the pool contract and decode its payload
   * into {@link GetTokenPoolStateResult}. Until the read path is wired, throws
   * a not-implemented error.
   */
  protected async read(
    chain: CantonChain,
    p: { poolCid: string; templateId: string },
  ): Promise<GetTokenPoolStateResult> {
    void chain
    void p
    throw new Error(
      'getTokenPoolState: pool contract ACS query + payload decode is not yet wired — ' +
        'implement as part of the CantonChain read-path follow-up',
    )
  }
}
