import type { SolanaChain } from '../../../../solana/index.ts'
import { SolanaQuery } from '../../query.ts'
import { validatePublicKey } from '../../validate.ts'

/** Parameters for listing tokens configured in a Solana TokenAdminRegistry. */
export type GetSupportedTokensParams = {
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp
   * address works.
   */
  address: string
}

/** Lists the SPL token mints configured in a TokenAdminRegistry. */
export class GetSupportedTokens extends SolanaQuery<GetSupportedTokensParams, string[]> {
  /** Resolves the Router and lists its configured token mints. */
  async query(chain: SolanaChain, params: GetSupportedTokensParams): Promise<string[]> {
    validatePublicKey(this.constructor.name, 'address', params.address)

    const router = await chain.getTokenAdminRegistryFor(params.address)
    return chain.getSupportedTokens(router)
  }
}
