import { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { getTokenAdminRegistryConfig } from '../../../../solana/token-admin-registry.ts'
import { SolanaQuery } from '../../query.ts'
import { parsePublicKey, validatePublicKey } from '../../validate.ts'

/** Parameters for reading a Solana TokenAdminRegistry configuration. */
export type GetTokenAdminRegistryConfigParams = {
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp
   * address works.
   */
  address: string
  /** SPL token mint registered with the Router. */
  tokenAddress: string
}

/** Configuration stored in a Solana TokenAdminRegistry account. */
export type GetTokenAdminRegistryConfigResult = {
  administrator: string
  pendingAdministrator: string
  poolLookupTable: string
  writableIndexes: number[]
}

/** Reads a token's TokenAdminRegistry account. */
export class GetTokenAdminRegistryConfig extends SolanaQuery<
  GetTokenAdminRegistryConfigParams,
  GetTokenAdminRegistryConfigResult
> {
  /** Reads and serializes the TokenAdminRegistry account. */
  async query(
    chain: SolanaChain,
    params: GetTokenAdminRegistryConfigParams,
  ): Promise<GetTokenAdminRegistryConfigResult> {
    validatePublicKey(this.constructor.name, 'address', params.address)

    const tokenAdminRegistryAddress = await chain.getTokenAdminRegistryFor(params.address)
    const tokenAdminRegistry = new PublicKey(tokenAdminRegistryAddress)
    const tokenMint = parsePublicKey(this.constructor.name, 'tokenAddress', params.tokenAddress)
    const config = await getTokenAdminRegistryConfig(
      chain.connection,
      tokenAdminRegistry,
      tokenMint,
    )

    return {
      administrator: config.administrator.toBase58(),
      pendingAdministrator: config.pendingAdministrator.toBase58(),
      poolLookupTable: config.lookupTable.toBase58(),
      writableIndexes: config.writableIndexes,
    }
  }
}
