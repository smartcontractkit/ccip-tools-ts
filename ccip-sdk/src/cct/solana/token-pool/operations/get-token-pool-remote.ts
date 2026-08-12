import type { PublicKey } from '@solana/web3.js'
import { hexlify } from 'ethers'

import { CCIPTokenPoolChainConfigNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import {
  type PoolProgramRef,
  decodeTokenPoolChainConfig,
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import { U64_MAX, parsePublicKey, resolvePoolProgram, validateBigInt } from '../../validate.ts'

/** Parameters for reading a Solana token pool remote-chain configuration. */
export type GetTokenPoolRemoteParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the destination chain whose config to read (`u64`). */
  remoteChainSelector: bigint
}

/** Current state of one token pool rate limiter. */
type RateLimitState = {
  tokens: bigint
  lastUpdated: bigint
  config: {
    enabled: boolean
    capacity: bigint
    rate: bigint
  }
}

/** Remote-chain configuration stored by a Solana token pool. */
export type GetTokenPoolRemoteResult = {
  chainConfigAddress: string
  /** Resolved pool program address: canonical for `poolType`, supplied for `poolProgramAddress`. */
  programId: string
  config: {
    remoteTokenAddress: string
    remotePoolAddresses: string[]
    remoteTokenDecimals: number
    inboundRateLimit: RateLimitState
    outboundRateLimit: RateLimitState
  }
}

/** {@link GetTokenPoolRemoteParams} with its mint and pool program resolved to public keys. */
type ParsedGetTokenPoolRemoteParams = GetTokenPoolRemoteParams & {
  mint: PublicKey
  programId: PublicKey
}

function serializeRateLimit({
  tokens,
  lastUpdated,
  cfg,
}: {
  tokens: { toString(): string }
  lastUpdated: { toString(): string }
  cfg: { enabled: boolean; capacity: { toString(): string }; rate: { toString(): string } }
}): RateLimitState {
  return {
    tokens: BigInt(tokens.toString()),
    lastUpdated: BigInt(lastUpdated.toString()),
    config: {
      enabled: cfg.enabled,
      capacity: BigInt(cfg.capacity.toString()),
      rate: BigInt(cfg.rate.toString()),
    },
  }
}

/** Reads the derived ChainConfig account for one Solana token pool remote chain. */
export class GetTokenPoolRemote extends SolanaQuery<
  GetTokenPoolRemoteParams,
  GetTokenPoolRemoteResult,
  ParsedGetTokenPoolRemoteParams
> {
  readonly name = 'getTokenPoolRemote'

  /** Converts the mint and pool program, and validates the remote-chain selector. */
  protected prepare(params: GetTokenPoolRemoteParams): ParsedGetTokenPoolRemoteParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
    return {
      ...params,
      mint: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      programId: resolvePoolProgram(this.name, params),
    }
  }

  /** Reads and serializes the remote-chain config account. */
  protected async read(
    chain: SolanaChain,
    params: ParsedGetTokenPoolRemoteParams,
  ): Promise<GetTokenPoolRemoteResult> {
    const { mint, programId, remoteChainSelector } = params
    const chainConfig = deriveTokenPoolChainConfigPda(programId, remoteChainSelector, mint)
    const account = await chain.connection.getAccountInfo(chainConfig)

    if (!account) {
      const state = deriveTokenPoolConfigPda(programId, mint)

      throw new CCIPTokenPoolChainConfigNotFoundError(
        chainConfig.toBase58(),
        state.toBase58(),
        remoteChainSelector.toString(),
        { context: { mint: params.tokenAddress, poolProgram: programId.toBase58() } },
      )
    }

    const { base } = decodeTokenPoolChainConfig(account.data, {
      chainConfig: chainConfig.toBase58(),
      mint: params.tokenAddress,
      poolProgram: programId.toBase58(),
      accountOwner: account.owner.toBase58(),
    })

    return {
      chainConfigAddress: chainConfig.toBase58(),
      programId: programId.toBase58(),
      config: {
        remoteTokenAddress: hexlify(base.remote.tokenAddress.address),
        remotePoolAddresses: base.remote.poolAddresses.map(({ address }) => hexlify(address)),
        remoteTokenDecimals: base.remote.decimals,
        inboundRateLimit: serializeRateLimit(base.inboundRateLimit),
        outboundRateLimit: serializeRateLimit(base.outboundRateLimit),
      },
    }
  }
}
