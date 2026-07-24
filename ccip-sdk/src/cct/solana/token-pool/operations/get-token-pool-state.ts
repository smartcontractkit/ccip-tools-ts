import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import {
  type PoolProgramRef,
  type TokenPoolConfig,
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import { parsePublicKey, resolvePoolProgram } from '../../validate.ts'

export type {
  BurnMintPoolProgramRef,
  CustomPoolProgramRef,
  LockReleasePoolProgramRef,
  PoolProgramRef,
} from '../../programs/token-pool.ts'

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
  programId: string
  version: number
}

/** State returned for a burn-mint or custom token pool program. */
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

type TokenPoolStateResultByType = {
  'burn-mint': BaseGetTokenPoolStateResult
  'lock-release': LockReleaseGetTokenPoolStateResult
}

/** State returned for a canonical or custom token pool program. */
export type GetTokenPoolStateResult<P extends PoolProgramRef = PoolProgramRef> = P extends {
  poolType: infer T
}
  ? T extends keyof TokenPoolStateResultByType
    ? TokenPoolStateResultByType[T]
    : BaseGetTokenPoolStateResult
  : BaseGetTokenPoolStateResult

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

/** Reads the complete state of a Solana token pool. */
export class GetTokenPoolState extends SolanaQuery<
  GetTokenPoolStateParams,
  GetTokenPoolStateResult
> {
  /** Reads and serializes the token pool configuration account. */
  async query<P extends GetTokenPoolStateParams>(
    chain: SolanaChain,
    params: P,
  ): Promise<GetTokenPoolStateResult<P>> {
    return this.fetchPoolState(chain, params) as Promise<GetTokenPoolStateResult<P>>
  }

  /** Fetches and serializes the token pool configuration account. */
  private async fetchPoolState(
    chain: SolanaChain,
    params: GetTokenPoolStateParams,
  ): Promise<GetTokenPoolStateResult> {
    const mint = parsePublicKey('getTokenPoolState', 'tokenAddress', params.tokenAddress)
    const programId = resolvePoolProgram('getTokenPoolState', params)
    const state = deriveTokenPoolConfigPda(programId, mint)

    const account = await chain.connection.getAccountInfo(state)
    if (!account) {
      throw new CCIPTokenPoolStateNotFoundError(state.toBase58(), {
        context: {
          mint: params.tokenAddress,
          poolProgram: programId.toBase58(),
        },
      })
    }

    const { version, config } = decodeTokenPoolState(account.data, {
      tokenPool: state.toBase58(),
      mint: params.tokenAddress,
      poolProgram: programId.toBase58(),
    })
    const result = {
      stateAddress: state.toBase58(),
      programId: programId.toBase58(),
      version,
    }
    const baseConfig = serializeBaseConfig(config)

    if (params.poolType === 'lock-release') {
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
