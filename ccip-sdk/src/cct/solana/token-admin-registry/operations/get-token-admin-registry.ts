import { PublicKey } from '@solana/web3.js'

import type { RegistryTokenConfig } from '../../../../chain.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { getTokenAdminRegistryConfig } from '../../../../solana/token-admin-registry.ts'
import { SolanaQuery } from '../../query.ts'
import { parsePublicKey, validatePublicKey } from '../../validate.ts'

/** Parameters for reading a Solana TokenAdminRegistry configuration. */
export type GetTokenAdminRegistryParams = {
  /**
   * CCIP contract to resolve the TokenAdminRegistry/Router from — a Router or OffRamp
   * address works.
   */
  address: string
  /** SPL token mint registered with the Router. */
  tokenAddress: string
}

/** Configuration stored in a Solana TokenAdminRegistry account. */
export type GetTokenAdminRegistryResult = RegistryTokenConfig & {
  mint: string
  lookupTable?: string
  writableIndexes: number[]
  supportsAutoDerivation: boolean
}

/** {@link GetTokenAdminRegistryParams} with its mint resolved to a public key. */
type ParsedGetTokenAdminRegistryParams = GetTokenAdminRegistryParams & {
  tokenMint: PublicKey
}

/** Reads a token's TokenAdminRegistry account. */
export class GetTokenAdminRegistry extends SolanaQuery<
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  ParsedGetTokenAdminRegistryParams
> {
  readonly name = 'getTokenAdminRegistry'

  /** Converts the mint; `address` stays a string for the Router lookup in {@link read}. */
  protected prepare(params: GetTokenAdminRegistryParams): ParsedGetTokenAdminRegistryParams {
    validatePublicKey(this.name, 'address', params.address)
    return { ...params, tokenMint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress) }
  }

  /** Reads and serializes the TokenAdminRegistry account. */
  protected async read(
    chain: SolanaChain,
    params: ParsedGetTokenAdminRegistryParams,
  ): Promise<GetTokenAdminRegistryResult> {
    const router = new PublicKey(await chain.getTokenAdminRegistryFor(params.address))
    const config = await getTokenAdminRegistryConfig(chain.connection, router, params.tokenMint)

    return {
      mint: config.mint.toBase58(),
      administrator: config.administrator.toBase58(),
      ...(config.pendingAdministrator && {
        pendingAdministrator: config.pendingAdministrator.toBase58(),
      }),
      ...(config.tokenPool && { tokenPool: config.tokenPool.toBase58() }),
      ...(config.lookupTable && { lookupTable: config.lookupTable.toBase58() }),
      writableIndexes: config.writableIndexes,
      supportsAutoDerivation: config.supportsAutoDerivation,
    }
  }
}
