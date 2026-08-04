import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import {
  type PoolProgramRef,
  type TokenPoolConfig,
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import { parsePublicKey, resolvePoolProgram, validatePublicKey } from '../../validate.ts'

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
  /** Resolved pool program address: canonical for `poolType`, supplied for `poolProgramAddress`. */
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

/**
 * State returned for a canonical or custom token pool program.
 *
 * Reads queried with `poolProgramAddress` use the base config shape and omit lock-release-only
 * fields, even when the supplied address is the lock-release program. The
 * {@link SolanaTokenManager.getTokenPoolState} overloads pick the arm per pool type, so callers
 * only narrow this union when the program is not known statically.
 */
export type GetTokenPoolStateResult =
  BaseGetTokenPoolStateResult | LockReleaseGetTokenPoolStateResult

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
  readonly name = 'getTokenPoolState'

  /**
   * Validates the mint and the pool-program reference before any RPC.
   * @throws {@link CCTParamsInvalidError} if `tokenAddress` is not a public key, or if the pool
   * program is identified by neither or both of `poolType` / `poolProgramAddress`
   */
  protected validate(params: GetTokenPoolStateParams): void {
    validatePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    resolvePoolProgram(this.name, params)
  }

  /** Reads and serializes the token pool config account; the facade's overloads narrow the arm. */
  protected async read(
    chain: SolanaChain,
    params: GetTokenPoolStateParams,
  ): Promise<GetTokenPoolStateResult> {
    const mint = parsePublicKey(this.name, 'tokenAddress', params.tokenAddress)
    const programId = resolvePoolProgram(this.name, params)
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
      accountOwner: account.owner.toBase58(),
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
