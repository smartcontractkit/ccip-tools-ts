import type { PublicKey } from '@solana/web3.js'

import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type TokenPoolConfig,
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import { parsePublicKey, validatePoolType } from '../../validate.ts'

/** Identifies a canonical burn-mint token pool program. */
export type BurnMintPoolProgramRef = {
  poolType: 'burn-mint'
  poolProgramAddress?: never
}

/** Identifies a canonical lock-release token pool program. */
export type LockReleasePoolProgramRef = {
  poolType: 'lock-release'
  poolProgramAddress?: never
}

/** Identifies a custom token pool program. */
export type CustomPoolProgramRef = {
  poolProgramAddress: string
  poolType?: never
}

/** Identifies a canonical token pool or a custom pool program. */
export type PoolProgramRef =
  BurnMintPoolProgramRef | LockReleasePoolProgramRef | CustomPoolProgramRef

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

/** State returned for a canonical or custom token pool program. */
export type GetTokenPoolStateResult<P extends PoolProgramRef = PoolProgramRef> =
  P extends LockReleasePoolProgramRef
    ? LockReleaseGetTokenPoolStateResult
    : BaseGetTokenPoolStateResult

function resolvePoolProgram(params: PoolProgramRef): PublicKey {
  const hasPoolType = Object.hasOwn(params, 'poolType')
  const hasPoolProgramAddress = Object.hasOwn(params, 'poolProgramAddress')
  if (hasPoolType === hasPoolProgramAddress) {
    throw new CCTParamsInvalidError(
      'getTokenPoolState',
      'poolType',
      'provide exactly one of poolType or poolProgramAddress',
    )
  }

  if (hasPoolType) {
    validatePoolType('getTokenPoolState', 'poolType', params.poolType)
    return resolveTokenPoolProgram(params.poolType)
  }

  return parsePublicKey('getTokenPoolState', 'poolProgramAddress', params.poolProgramAddress)
}

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
    const mint = parsePublicKey('getTokenPoolState', 'tokenAddress', params.tokenAddress)
    const programId = resolvePoolProgram(params)
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
      } as GetTokenPoolStateResult<P>
    }

    return { ...result, config: baseConfig } as GetTokenPoolStateResult<P>
  }
}
