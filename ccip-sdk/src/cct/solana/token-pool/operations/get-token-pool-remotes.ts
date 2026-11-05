import type { PublicKey } from '@solana/web3.js'

import type { TokenPoolRemote } from '../../../../chain.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { type PoolProgramRef, deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolProgram,
  validateBigInt,
} from '../../validate.ts'

/** Parameters for reading Solana token pool remote-chain configurations. */
export type GetTokenPoolRemotesParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** Optional CCIP selector of the destination chain to read (`u64`). */
  remoteChainSelector?: bigint
}

/** Remote-chain configurations keyed by network name. */
export type GetTokenPoolRemotesResult = Record<string, TokenPoolRemote>

/** {@link GetTokenPoolRemotesParams} with its mint and optional pool program parsed to public keys. */
type ParsedGetTokenPoolRemotesParams = {
  mint: PublicKey
  poolProgramAddress?: PublicKey
  remoteChainSelector?: bigint
}

/** Reads all, or one selected, remote-chain configurations of a Solana token pool. */
export class GetTokenPoolRemotes extends SolanaQuery<
  GetTokenPoolRemotesParams,
  GetTokenPoolRemotesResult,
  ParsedGetTokenPoolRemotesParams
> {
  readonly name = 'getTokenPoolRemotes'

  /**
   * Converts the mint and pool program, and validates the optional remote-chain selector.
   * @throws {@link CCTParamsInvalidError} if a pool parameter or selector is invalid.
   */
  protected prepare(params: GetTokenPoolRemotesParams): ParsedGetTokenPoolRemotesParams {
    if (params.remoteChainSelector !== undefined) {
      validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
    }
    return {
      mint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgramAddress: parseOptionalPublicKey(
        this.name,
        'poolProgramAddress',
        params.poolProgramAddress,
      ),
      remoteChainSelector: params.remoteChainSelector,
    }
  }

  /** Derives the pool state PDA and delegates remote config decoding to the shared chain reader. */
  protected async read(
    chain: SolanaChain,
    { mint, poolProgramAddress, remoteChainSelector }: ParsedGetTokenPoolRemotesParams,
  ): Promise<GetTokenPoolRemotesResult> {
    const poolProgram = await resolveExistingPoolProgram(this.name, chain, mint, poolProgramAddress)
    const state = deriveTokenPoolConfigPda(poolProgram, mint).toBase58()
    return chain.getTokenPoolRemotes(state, remoteChainSelector)
  }
}
