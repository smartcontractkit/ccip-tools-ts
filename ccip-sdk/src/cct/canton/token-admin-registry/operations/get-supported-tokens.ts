/**
 * getSupportedTokens — enumerate the instruments registered in the TAR
 * (the tokens CCIP supports on this Canton network).
 *
 * Enumerates active `TokenConfig` contracts via the ACS (each `TokenConfig`
 * corresponds to one registered instrument) and maps each to its `{ admin, id }`
 * instrument ID. Paginated via `offset`/`limit`.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { CantonInstrumentId } from '../../../../canton/types.ts'
import { decodeDamlRecord, extractRecordField } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { parsePartyId } from '../../validate.ts'
import { TOKEN_CONFIG_TEMPLATE_ID } from '../shared.ts'

/** Parameters for `getSupportedTokens`. */
export interface GetSupportedTokensParams {
  /**
   * Party whose ACS visibility to enumerate (a registry stakeholder — typically
   * the CCIP owner / registry owner). Required: the ACS query is per-party.
   */
  party: string
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

/** Parsed params for {@link GetSupportedTokens.read}. */
interface ParsedGetSupportedTokens {
  party: string
  limit: number
  offset: number
}

/** Enumerate the instruments registered in the TAR. */
export class GetSupportedTokens extends CantonQuery<
  GetSupportedTokensParams,
  GetSupportedTokensResult,
  ParsedGetSupportedTokens
> {
  readonly name = 'getSupportedTokens'

  /** Normalizes pagination defaults and validates the query party. */
  protected prepare(p: GetSupportedTokensParams): ParsedGetSupportedTokens {
    return {
      party: parsePartyId(this.name, 'party', p.party),
      limit: p.page?.limit ?? 100,
      offset: p.page?.offset ?? 0,
    }
  }

  /**
   * Enumerates active `TokenConfig` contracts visible to `party` and maps each
   * to its `instrumentId`. Pagination is applied client-side over the ACS
   * response (the ledger API does not natively paginate ACS queries).
   */
  protected async read(
    chain: CantonChain,
    p: ParsedGetSupportedTokens,
  ): Promise<GetSupportedTokensResult> {
    const contracts = await chain.findActiveContractsByTemplate(
      TOKEN_CONFIG_TEMPLATE_ID,
      [p.party],
    )

    const all: CantonInstrumentId[] = []
    for (const contract of contracts) {
      const fields = decodeDamlRecord(contract.createArgument)
      const inst = extractRecordField(fields, 'instrumentId')
      if (!inst) continue
      const admin = inst['admin']
      const id = inst['id']
      if (typeof admin === 'string' && typeof id === 'string') {
        all.push({ admin, id })
      }
    }

    const page = all.slice(p.offset, p.offset + p.limit)
    const hasMore = p.offset + p.limit < all.length
    return {
      tokens: page,
      hasMore,
      nextOffset: hasMore ? p.offset + p.limit : undefined,
    }
  }
}
