import { getTokenAdminRegistry } from './registry.ts'
import type { GenerateSetPoolParams, SetPoolParams } from './v1_6_2/set-pool.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import { resolveSolanaCCTVersion } from '../versions.ts'

/** TokenAdminRegistry CCT operations for a Solana Router program. */
export class SolanaTokenAdminRegistryClient {
  readonly chain: SolanaChain

  /** Creates a TokenAdminRegistry client for an existing Solana chain. */
  constructor(chain: SolanaChain) {
    this.chain = chain
  }

  /** Builds unsigned Solana `setPool` instructions. */
  async generateUnsignedSetPool(opts: GenerateSetPoolParams) {
    return getTokenAdminRegistry(resolveSolanaCCTVersion(opts.version)).setPool.generate(
      this.chain,
      opts,
    )
  }

  /** Registers a token pool. */
  async setPool(opts: SetPoolParams & { wallet: unknown }) {
    return getTokenAdminRegistry(resolveSolanaCCTVersion(opts.version)).setPool.execute(
      this.chain,
      opts,
    )
  }
}

export type { GenerateSetPoolParams, SetPoolParams } from './v1_6_2/set-pool.ts'
export { TOKEN_ADMIN_REGISTRY_IMPLEMENTATIONS, getTokenAdminRegistry } from './registry.ts'
