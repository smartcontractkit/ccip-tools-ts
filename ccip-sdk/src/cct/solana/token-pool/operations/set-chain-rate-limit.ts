import type { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import {
  type PoolProgramRef,
  createTokenPoolProgram,
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { submit } from '../../submit.ts'
import {
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'

const U64_MAX = 0xffff_ffff_ffff_ffffn

/** Configuration for one direction of a token pool rate limiter. */
export type RateLimitConfig = {
  /** Whether this directional rate limit is enforced. Disabled limits require zero capacity and rate. */
  enabled: boolean
  /** Maximum tokens available in the rate-limit bucket (`u64`). Must be at least `rate` when enabled. */
  capacity: bigint
  /** Tokens replenished per second (`u64`). Must not exceed `capacity` when enabled. */
  rate: bigint
}

/** Parameters shared by Solana token pool rate-limit generation and execution. */
type SetChainRateLimitParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Rate limit for tokens received from the remote chain. */
  inbound: RateLimitConfig
  /** Rate limit for tokens sent to the remote chain. */
  outbound: RateLimitConfig
  /** Pool owner or rate-limit admin. Defaults to `payer` for single-signer transactions. */
  authority?: string
}

type ParsedSetChainRateLimitParams = {
  tokenAddress: PublicKey
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
  inbound: RateLimitConfig
  outbound: RateLimitConfig
}

/** Parameters for unsigned Solana token pool rate-limit configuration. */
export type GenerateSetChainRateLimitParams = SolanaGenerateParams<SetChainRateLimitParams>

/** Unsigned Solana token pool rate-limit configuration result. */
export type GenerateSetChainRateLimitResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool rate-limit configuration. */
export type ExecuteSetChainRateLimitParams = SolanaExecuteParams<SetChainRateLimitParams>

/** Result of executing Solana token pool rate-limit configuration. */
export type ExecuteSetChainRateLimitResult = TransactionResult

/** Sets inbound and outbound rate limits for an initialized remote-chain config. */
export class SetChainRateLimit extends SolanaOperation<
  SetChainRateLimitParams,
  UnsignedSolanaTx,
  ParsedSetChainRateLimitParams
> {
  readonly name = 'setChainRateLimit'

  /** Parses rate limits and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateSetChainRateLimitParams): ParsedSetChainRateLimitParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
    for (const [direction, config] of Object.entries({
      inbound: params.inbound,
      outbound: params.outbound,
    })) {
      if (typeof config.enabled !== 'boolean') {
        throw new CCTParamsInvalidError(this.name, `${direction}.enabled`, 'must be a boolean')
      }

      validateBigInt(this.name, `${direction}.capacity`, config.capacity, 0n, U64_MAX)
      validateBigInt(this.name, `${direction}.rate`, config.rate, 0n, U64_MAX)

      if (config.enabled && config.rate > config.capacity) {
        throw new CCTParamsInvalidError(
          this.name,
          `${direction}.rate`,
          'must not exceed capacity when enabled',
        )
      }
      if (!config.enabled && (config.capacity !== 0n || config.rate !== 0n)) {
        throw new CCTParamsInvalidError(
          this.name,
          direction,
          'must have zero capacity and rate when disabled',
        )
      }
    }

    const payer = parsePublicKey(this.name, 'payer', params.payer)
    return {
      tokenAddress: parsePublicKey(this.name, 'tokenAddress', params.tokenAddress),
      poolProgram: resolvePoolProgram(this.name, params),
      payer,
      authority:
        params.authority === undefined
          ? payer
          : parsePublicKey(this.name, 'authority', params.authority),
      remoteChainSelector: params.remoteChainSelector,
      inbound: params.inbound,
      outbound: params.outbound,
    }
  }

  /** Builds the unsigned Solana `setChainRateLimit` instruction. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: ParsedSetChainRateLimitParams,
  ): Promise<UnsignedSolanaTx> {
    const program = createTokenPoolProgram(chain, opts.poolProgram, opts.payer)
    const instruction = await program.methods
      .setChainRateLimit(
        new BN(opts.remoteChainSelector.toString()),
        opts.tokenAddress,
        {
          ...opts.inbound,
          capacity: new BN(opts.inbound.capacity.toString()),
          rate: new BN(opts.inbound.rate.toString()),
        },
        {
          ...opts.outbound,
          capacity: new BN(opts.outbound.capacity.toString()),
          rate: new BN(opts.outbound.rate.toString()),
        },
      )
      .accountsStrict({
        state: deriveTokenPoolConfigPda(opts.poolProgram, opts.tokenAddress),
        chainConfig: deriveTokenPoolChainConfigPda(
          opts.poolProgram,
          opts.remoteChainSelector,
          opts.tokenAddress,
        ),
        authority: opts.authority,
      })
      .instruction()

    chain.logger.debug(
      `${this.name}: token = ${opts.tokenAddress.toBase58()}, poolProgram = ${opts.poolProgram.toBase58()}, remoteChainSelector = ${opts.remoteChainSelector}`,
    )
    return { family: ChainFamily.Solana, instructions: [instruction], mainIndex: 0 }
  }

  /** Generate, sign, simulate, send, and confirm with the rate-limit admin wallet. */
  override async execute(
    chain: SolanaChain,
    params: ExecuteSetChainRateLimitParams,
  ): Promise<ExecuteSetChainRateLimitResult> {
    const { wallet, computeUnits, parsed } = this.prepareWalletExecution(params)

    if (params.authority !== undefined) {
      validateAuthorityMatchesWallet(
        this.name,
        parsed.authority,
        wallet.publicKey,
        'setChainRateLimit requires authority to be the executing wallet. Use generateUnsignedSetChainRateLimit for externally signed transactions.',
      )
    }

    return submit(chain, wallet, await this.buildUnsigned(chain, parsed), this.name, computeUnits)
  }
}
