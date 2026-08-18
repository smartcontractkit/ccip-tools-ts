/**
 * getSupportedTokens — enumerate the instruments registered in the TAR
 * (the tokens CCIP supports on this Canton network).
 *
 * Implements the `CantonChain.getSupportedTokens` stub by enumerating TAR
 * entries via an ACS query on the `TokenConfig` template.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { CantonInstrumentId } from '../../../../canton/types.ts'
import { CantonQuery } from '../../query.ts'

/** Parameters for `getSupportedTokens`. */
export interface GetSupportedTokensParams {
  /** TAR contract ID. When omitted, resolved via ACS. */
  tarCid?: string
  /** Pagination cursor (offset); defaults to the first page. */
  page?: { offset?: number; limit?: number }
}

/** Result of `getSupportedTokens`: a page of instrument IDs. */
export interface GetSupportedTokensResult {
  /** Instrument IDs registered in the TAR (the supported tokens). */
  tokens: CantonInstrumentId[]
  /** Whether more pages are available. */
  hasMore: boolean
  /** Offset for the next page, when `hasMore`. */
  nextOffset?: number
}

/** Enumerate the instruments registered in the TAR. */
export class GetSupportedTokens extends CantonQuery<
  GetSupportedTokensParams,
  GetSupportedTokensResult,
  { tarCid?: string; limit: number; offset: number }
> {
  readonly name = 'getSupportedTokens'

  /** Normalizes pagination defaults. */
  protected prepare(p: GetSupportedTokensParams): {
    tarCid?: string
    limit: number
    offset: number
  } {
    return {
      tarCid: p.tarCid,
      limit: p.page?.limit ?? 100,
      offset: p.page?.offset ?? 0,
    }
  }

  /**
   * Enumerates TAR `TokenConfig` contracts via the ACS. TODO(cct-canton): query
   * the ACS `getActiveContracts` for `TokenConfig` template entries and map
   * each to its `{ admin, id }` instrument ID. Until the read path is wired,
   * this throws a not-implemented error.
   */
  protected async read(
    chain: CantonChain,
    p: { tarCid?: string; limit: number; offset: number },
  ): Promise<GetSupportedTokensResult> {
    void chain
    void p
    throw new Error(
      'getSupportedTokens: TAR entry enumeration via ACS is not yet wired — ' +
        'implement as part of the CantonChain stub resolution follow-up',
    )
  }
}
