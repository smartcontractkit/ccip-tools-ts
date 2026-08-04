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

/** Lists all SPL token mints configured in a TokenAdminRegistry in a single scan; pagination is not supported. */
export class GetSupportedTokens extends SolanaQuery<GetSupportedTokensParams, string[]> {
  readonly name = 'getSupportedTokens'

  /** Validates the resolution address before any RPC; the base runs this ahead of {@link read}. */
  protected validate(params: GetSupportedTokensParams): void {
    validatePublicKey(this.name, 'address', params.address)
  }

  /** Resolves the Router and lists its configured token mints. */
  protected async read(chain: SolanaChain, params: GetSupportedTokensParams): Promise<string[]> {
    const router = await chain.getTokenAdminRegistryFor(params.address)
    return chain.getSupportedTokens(router)
  }
}
