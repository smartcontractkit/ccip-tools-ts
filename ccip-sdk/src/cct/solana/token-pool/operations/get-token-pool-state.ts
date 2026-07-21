import { PublicKey } from '@solana/web3.js'

import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import {
  type TokenPoolConfig,
  type TokenPoolType,
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import { validatePoolType, validatePublicKey } from '../../validate.ts'

/** Parameters for reading a Solana token pool state. */
export type GetTokenPoolStateParams = {
  poolType: TokenPoolType
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

/** State returned for a burn-mint token pool. */
export type BurnMintGetTokenPoolStateResult = GetTokenPoolStateResultBase & {
  poolType: 'burn-mint'
  config: BaseConfig
}

/** State returned for a lock-release token pool. */
export type LockReleaseGetTokenPoolStateResult = GetTokenPoolStateResultBase & {
  poolType: 'lock-release'
  config: BaseConfig & { rebalancer: string; canAcceptLiquidity: boolean }
}

/** State returned for either supported token pool type. */
export type GetTokenPoolStateResult =
  BurnMintGetTokenPoolStateResult | LockReleaseGetTokenPoolStateResult

/** Reads the complete state of a canonical Solana token pool. */
export class GetTokenPoolState extends SolanaQuery<
  GetTokenPoolStateParams,
  GetTokenPoolStateResult
> {
  /** Reads and serializes the token pool configuration account. */
  async query(
    chain: SolanaChain,
    params: GetTokenPoolStateParams,
  ): Promise<GetTokenPoolStateResult> {
    validatePoolType('getTokenPoolState', 'poolType', params.poolType)
    validatePublicKey('getTokenPoolState', 'tokenAddress', params.tokenAddress)

    const programId = resolveTokenPoolProgram(params.poolType)
    const mint = new PublicKey(params.tokenAddress)
    const state = deriveTokenPoolConfigPda(programId, mint)
    const account = await chain.connection.getAccountInfo(state)
    if (!account) throw new CCIPTokenPoolStateNotFoundError(state.toBase58())

    const { version, config } = decodeTokenPoolState(account.data)
    const result = {
      stateAddress: state.toBase58(),
      programId: programId.toBase58(),
      version,
    }
    const baseConfig = serializeBaseConfig(config)

    if (params.poolType === 'burn-mint') {
      return { ...result, poolType: 'burn-mint', config: baseConfig }
    }

    const lockReleaseConfig = {
      rebalancer: config.rebalancer.toBase58(),
      canAcceptLiquidity: config.canAcceptLiquidity,
    }

    return {
      ...result,
      poolType: 'lock-release',
      config: {
        ...baseConfig,
        ...lockReleaseConfig,
      },
    }
  }
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
