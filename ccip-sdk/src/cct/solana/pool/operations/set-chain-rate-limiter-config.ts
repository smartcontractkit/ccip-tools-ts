import { type TransactionInstruction, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { createTokenPoolProgram, deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { validatePublicKey } from '../../validate.ts'
import {
  type RateLimiterConfig,
  deriveTokenPoolChainConfigPda,
  discoverPoolInfo,
} from './common.ts'

/** Rate limiter update for a single already-configured remote chain. */
export type ChainRateLimiterConfig = {
  /** Remote chain selector (must already be configured on the pool). */
  remoteChainSelector: bigint
  /** Outbound rate limiter (local to remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote to local). */
  inboundRateLimiterConfig: RateLimiterConfig
}

/** Parameters shared by token-pool `setChainRateLimiterConfig` generation and execution. */
type SetChainRateLimiterConfigParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Rate limiter updates, one per remote chain (at least one required). */
  chainConfigs: ChainRateLimiterConfig[]
  /** Pool authority (owner or rate-limit admin). Defaults to `payer`. */
  authority?: string
}

/** Parameters for unsigned token-pool `setChainRateLimiterConfig` generation. */
export type GenerateSetChainRateLimiterConfigParams =
  SolanaGenerateParams<SetChainRateLimiterConfigParams>

/** Unsigned token-pool `setChainRateLimiterConfig` result. */
export type GenerateSetChainRateLimiterConfigResult = UnsignedSolanaTx

/** Parameters for executing token-pool `setChainRateLimiterConfig`. */
export type ExecuteSetChainRateLimiterConfigParams =
  SolanaExecuteParams<SetChainRateLimiterConfigParams>

/** Result of executing token-pool `setChainRateLimiterConfig`. */
export type ExecuteSetChainRateLimiterConfigResult = TransactionHash

/** Updates rate limiter configurations for already-configured remote chains on a token pool. */
export class SetChainRateLimiterConfig extends SolanaOperation<SetChainRateLimiterConfigParams> {
  readonly name = 'setChainRateLimiterConfig'

  /** Validates addresses and rate limiter selectors before any RPC. */
  protected validate(params: GenerateSetChainRateLimiterConfigParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    if (params.chainConfigs.length === 0) {
      throw new CCTParamsInvalidError(this.name, 'chainConfigs', 'must have at least one config')
    }
    for (const [i, config] of params.chainConfigs.entries()) {
      if (config.remoteChainSelector == null || config.remoteChainSelector === 0n) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainConfigs[${i}].remoteChainSelector`,
          'must be non-zero',
        )
      }
    }
  }

  /** Builds one `setChainRateLimit` instruction per remote chain config. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateSetChainRateLimiterConfigParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)
    const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)

    const state = deriveTokenPoolConfigPda(poolProgramId, mint)
    const program = createTokenPoolProgram(chain, poolProgramId, authority)
    const instructions: TransactionInstruction[] = []

    for (const config of opts.chainConfigs) {
      const chainConfig = deriveTokenPoolChainConfigPda(
        poolProgramId,
        config.remoteChainSelector,
        mint,
      )
      instructions.push(
        await program.methods
          .setChainRateLimit(
            new BN(config.remoteChainSelector.toString()),
            mint,
            {
              enabled: config.inboundRateLimiterConfig.isEnabled,
              capacity: new BN(config.inboundRateLimiterConfig.capacity),
              rate: new BN(config.inboundRateLimiterConfig.rate),
            },
            {
              enabled: config.outboundRateLimiterConfig.isEnabled,
              capacity: new BN(config.outboundRateLimiterConfig.capacity),
              rate: new BN(config.outboundRateLimiterConfig.rate),
            },
          )
          .accountsStrict({ state, chainConfig, authority })
          .instruction(),
      )
    }

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, poolProgram = ${poolProgramId.toBase58()}, instructions = ${instructions.length}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }
}
