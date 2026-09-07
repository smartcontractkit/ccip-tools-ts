import { unpackMint } from '@solana/spl-token'
import type { PublicKey } from '@solana/web3.js'

import type { TokenInfo } from '../../../../chain.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { resolveTokenMint } from '../../../../solana/utils.ts'
import { SolanaQuery } from '../../query.ts'
import { parsePublicKey } from '../../validate.ts'

/** Parameters for reading an SPL token mint's metadata. */
export type GetTokenInfoParams = {
  /** SPL token mint address. */
  tokenAddress: string
}

/** SPL token metadata and mint state. */
export type GetTokenInfoResult = TokenInfo & {
  /** SPL Token or Token-2022 program that owns the mint. */
  tokenProgram: string
  /** Total minted supply in base units. */
  supply: bigint
  /** Authority allowed to mint new tokens, or null for fixed-supply tokens. */
  mintAuthority: string | null
  /** Authority allowed to freeze token accounts, or null when freezing is disabled. */
  freezeAuthority: string | null
}

type ParsedGetTokenInfoParams = GetTokenInfoParams & { mint: PublicKey }

/** Reads an SPL token mint's metadata and state. */
export class GetTokenInfo extends SolanaQuery<
  GetTokenInfoParams,
  GetTokenInfoResult,
  ParsedGetTokenInfoParams
> {
  readonly name = 'getTokenInfo'

  /** Converts and validates the mint address. */
  protected prepare(params: GetTokenInfoParams): ParsedGetTokenInfoParams {
    return { ...params, mint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress) }
  }

  /** Delegates metadata lookup and reads the mint's SPL state. */
  protected async read(
    chain: SolanaChain,
    { mint, tokenAddress }: ParsedGetTokenInfoParams,
  ): Promise<GetTokenInfoResult> {
    const [info, account] = await Promise.all([
      chain.getTokenInfo(tokenAddress),
      resolveTokenMint(chain.connection, mint),
    ])
    const state = unpackMint(mint, account, account.owner)

    return {
      ...info,
      tokenProgram: account.owner.toBase58(),
      supply: state.supply,
      mintAuthority: state.mintAuthority?.toBase58() ?? null,
      freezeAuthority: state.freezeAuthority?.toBase58() ?? null,
    }
  }
}
