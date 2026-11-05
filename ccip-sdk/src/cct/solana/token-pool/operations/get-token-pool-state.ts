import type { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import type { PoolProgramRef, TokenPoolConfig } from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import {
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolConfig,
  resolvePoolProgramType,
} from '../../validate.ts'

export type { PoolProgramRef } from '../../programs/token-pool.ts'

/** Parameters for reading a Solana token pool state. */
export type GetTokenPoolStateParams = PoolProgramRef & {
  tokenAddress: string
}

type BaseConfig = {
  tokenProgram: string
  mint: string
  decimals: number
  poolSigner: string
  poolTokenAccount: string
  owner: string
  proposedOwner: string
  rateLimitAdmin: string
  routerOnrampAuthority: string
  router: string
  listEnabled: boolean
  allowList: string[]
  rmnRemote: string
}

type GetTokenPoolStateResultBase = {
  stateAddress: string
  /** Pool program owning the state: resolved on-chain, or the supplied `poolProgramAddress`. */
  programId: string
  version: number
}

/** State returned for a burn-mint pool, or a custom pool program not identified as lock-release. */
export type BaseGetTokenPoolStateResult = GetTokenPoolStateResultBase & {
  config: BaseConfig
}

/** State returned for a lock-release token pool program. */
export type LockReleaseGetTokenPoolStateResult = GetTokenPoolStateResultBase & {
  config: BaseConfig & {
    rebalancer: string
    canAcceptLiquidity: boolean
  }
}

/**
 * State returned for a canonical or custom token pool program.
 *
 * Lock-release pools (the canonical program, or a custom one whose `typeAndVersion` names
 * lock-release) add the lock-release-only config fields; narrow on `'rebalancer' in state.config`.
 */
export type GetTokenPoolStateResult =
  | BaseGetTokenPoolStateResult
  | LockReleaseGetTokenPoolStateResult

function serializeBaseConfig(config: TokenPoolConfig): BaseConfig {
  return {
    tokenProgram: config.tokenProgram.toBase58(),
    mint: config.mint.toBase58(),
    decimals: config.decimals,
    poolSigner: config.poolSigner.toBase58(),
    poolTokenAccount: config.poolTokenAccount.toBase58(),
    owner: config.owner.toBase58(),
    proposedOwner: config.proposedOwner.toBase58(),
    rateLimitAdmin: config.rateLimitAdmin.toBase58(),
    routerOnrampAuthority: config.routerOnrampAuthority.toBase58(),
    router: config.router.toBase58(),
    listEnabled: config.listEnabled,
    allowList: config.allowList.map((address) => address.toBase58()),
    rmnRemote: config.rmnRemote.toBase58(),
  }
}

/** {@link GetTokenPoolStateParams} with its mint and optional pool program parsed to public keys. */
type ParsedGetTokenPoolStateParams = {
  mint: PublicKey
  poolProgramAddress?: PublicKey
}

/** Reads the complete state of a Solana token pool. */
export class GetTokenPoolState extends SolanaQuery<
  GetTokenPoolStateParams,
  GetTokenPoolStateResult,
  ParsedGetTokenPoolStateParams
> {
  readonly name = 'getTokenPoolState'

  /**
   * Converts the mint and the optional pool program.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` or `poolProgramAddress` is not a public key
   */
  protected prepare(params: GetTokenPoolStateParams): ParsedGetTokenPoolStateParams {
    return {
      mint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgramAddress: parseOptionalPublicKey(
        this.name,
        'poolProgramAddress',
        params.poolProgramAddress,
      ),
    }
  }

  /** Reads and serializes the token pool config account in the arm of its resolved pool type. */
  protected async read(
    chain: SolanaChain,
    { mint, poolProgramAddress }: ParsedGetTokenPoolStateParams,
  ): Promise<GetTokenPoolStateResult> {
    const { poolProgram, state, version, config } = await resolveExistingPoolConfig(
      this.name,
      chain,
      mint,
      poolProgramAddress,
    )
    const result = {
      stateAddress: state.toBase58(),
      programId: poolProgram.toBase58(),
      version,
    }
    const baseConfig = serializeBaseConfig(config)

    if ((await resolvePoolProgramType(chain, poolProgram)) === 'lock-release') {
      return {
        ...result,
        config: {
          ...baseConfig,
          rebalancer: config.rebalancer.toBase58(),
          canAcceptLiquidity: config.canAcceptLiquidity,
        },
      }
    }

    return { ...result, config: baseConfig }
  }
}
