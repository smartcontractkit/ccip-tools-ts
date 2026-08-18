/**
 * getRequiredCCVs — read the required committee-verifier instance addresses for
 * a token pool via the `GetRequiredCCVs` read choice. No wallet required.
 *
 * Ported from the Go binding
 * (`burnminttokenpool.BurnMintTokenPool{}.GetRequiredCCVs`). Returns raw
 * instance addresses, normalized via the existing `normalizeCantonCcvList`.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { parseContractCid } from '../../validate.ts'

/** Parameters for `getRequiredCCVs`. */
export interface GetRequiredCCVsParams {
  /** Pool contract ID. */
  poolCid: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
}

/** Result of `getRequiredCCVs`: the required CCV instance addresses. */
export interface GetRequiredCCVsResult {
  /** Raw instance addresses of the required committee verifiers. */
  ccvs: string[]
}

/** Read the required CCVs for a pool. */
export class GetRequiredCCVs extends CantonQuery<
  GetRequiredCCVsParams,
  GetRequiredCCVsResult,
  { poolCid: string; templateId: string }
> {
  readonly name = 'getRequiredCCVs'

  /** Validates the pool CID and normalizes the pool type into a template ID. */
  protected prepare(p: GetRequiredCCVsParams): { poolCid: string; templateId: string } {
    return {
      poolCid: parseContractCid(this.name, 'poolCid', p.poolCid),
      templateId:
        p.poolType === 'burnMint'
          ? '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
          : '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool',
    }
  }

  /**
   * Exercises the `GetRequiredCCVs` read choice via the JSON Ledger API.
   * TODO(cct-canton): wire the read-choice submission (submitAndWait for a
   * non-consuming choice) and parse the returned CCV list. Until then, throws
   * a not-implemented error.
   */
  protected async read(
    chain: CantonChain,
    p: { poolCid: string; templateId: string },
  ): Promise<GetRequiredCCVsResult> {
    void chain
    void p
    throw new Error(
      'getRequiredCCVs: read-choice submission via the JSON Ledger API is not yet wired — ' +
        'implement as part of the CantonChain read-path follow-up',
    )
  }
}
