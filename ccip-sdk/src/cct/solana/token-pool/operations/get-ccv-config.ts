import type { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import type { PoolProgramRef } from '../../programs/token-pool.ts'
import { SolanaQuery } from '../../query.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingPoolProgram,
  validateBigInt,
  validatePoolProgramAtLeast2,
} from '../../validate.ts'
import { type TokenPoolCCVConfig, readTokenPoolChainConfigV2 } from './chain-config-v2.ts'

/** Parameters for reading the CCVs a Solana CCIP 2.0 token pool requires on a lane. */
export type GetCCVConfigParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
}

/**
 * The CCVs a 2.0 token pool requires on a lane, in the shape `initChainConfigV2` and
 * `editChainConfigV2` take as `ccvConfig`. All lists empty and `thresholdAmount` `0n` mean the pool
 * requires no CCVs of its own on the lane.
 */
export type GetCCVConfigResult = Required<TokenPoolCCVConfig>

/** {@link GetCCVConfigParams} with its mint and optional pool program parsed to public keys. */
type ParsedGetCCVConfigParams = {
  mint: PublicKey
  poolProgramAddress?: PublicKey
  remoteChainSelector: bigint
}

/** Reads the CCVs a Solana CCIP 2.0 token pool requires on one remote chain's lane. */
export class GetCCVConfig extends SolanaQuery<
  GetCCVConfigParams,
  GetCCVConfigResult,
  ParsedGetCCVConfigParams
> {
  readonly name = 'getCCVConfig'

  /**
   * Converts the mint and pool program, and validates the remote-chain selector.
   * @throws {@link CCTParamsInvalidError} if a parameter is invalid.
   */
  protected prepare(params: GetCCVConfigParams): ParsedGetCCVConfigParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
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

  /** Decodes the lane's `ChainConfigV2`; a lane without one requires no pool CCVs. */
  protected async read(
    chain: SolanaChain,
    { mint, poolProgramAddress, remoteChainSelector }: ParsedGetCCVConfigParams,
  ): Promise<GetCCVConfigResult> {
    const poolProgram = await resolveExistingPoolProgram(this.name, chain, mint, poolProgramAddress)
    await validatePoolProgramAtLeast2(this.name, chain, poolProgram)
    const config = (await readTokenPoolChainConfigV2(chain, poolProgram, mint, remoteChainSelector))
      ?.ccvConfig
    const toBase58 = (ccvs: PublicKey[] = []) => ccvs.map((ccv) => ccv.toBase58())
    return {
      outboundCCVs: toBase58(config?.outboundCCVs),
      thresholdOutboundCCVs: toBase58(config?.thresholdOutboundCCVs),
      inboundCCVs: toBase58(config?.inboundCCVs),
      thresholdInboundCCVs: toBase58(config?.thresholdInboundCCVs),
      thresholdAmount: config?.thresholdAmount ?? 0n,
    }
  }
}
