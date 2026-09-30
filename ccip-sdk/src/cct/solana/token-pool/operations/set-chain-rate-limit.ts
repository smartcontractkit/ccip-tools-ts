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
  U64_MAX,
  parsePublicKey,
  resolvePoolProgram,
  validateAuthorityMatchesWallet,
  validateBigInt,
} from '../../validate.ts'

/**
 * Configuration for one direction of a token pool rate limiter.
 *
 * @remarks For a mint with 6 decimals, pass `1_000_000n` to represent one token.
 */
export type RateLimitConfig =
  | {
      /** Whether this directional rate limit is enforced. */
      enabled: true
      /** Maximum token amount in the bucket (`u64`), at least `rate`. */
      capacity: bigint
      /** Token amount restored to the bucket per second (`u64`), no greater than `capacity`. */
      rate: bigint
    }
  | {
      /** Whether this directional rate limit is enforced. */
      enabled: false
      /** Must be zero when provided; defaults to zero. */
      capacity?: bigint
      /** Must be zero when provided; defaults to zero. */
      rate?: bigint
    }

type ParsedRateLimitConfig = {
  enabled: boolean
  capacity: bigint
  rate: bigint
}

function parseRateLimitConfig(
  operation: string,
  direction: string,
  config: unknown,
): ParsedRateLimitConfig {
  if (typeof config !== 'object' || config === null) {
    throw new CCTParamsInvalidError(operation, direction, 'must be a rate-limit configuration')
  }

  const {
    enabled,
    capacity: inputCapacity,
    rate: inputRate,
  } = config as Partial<ParsedRateLimitConfig>

  if (typeof enabled !== 'boolean') {
    throw new CCTParamsInvalidError(operation, `${direction}.enabled`, 'must be a boolean')
  }

  const capacity = !enabled && inputCapacity === undefined ? 0n : inputCapacity
  const rate = !enabled && inputRate === undefined ? 0n : inputRate

  validateBigInt(operation, `${direction}.capacity`, capacity, 0n, U64_MAX)
  validateBigInt(operation, `${direction}.rate`, rate, 0n, U64_MAX)

  if (enabled && rate > capacity) {
    throw new CCTParamsInvalidError(
      operation,
      `${direction}.rate`,
      'must not exceed capacity when enabled',
    )
  }
  if (!enabled && (capacity !== 0n || rate !== 0n)) {
    throw new CCTParamsInvalidError(
      operation,
      direction,
      'must have zero capacity and rate when disabled',
    )
  }
  return { enabled, capacity, rate }
}

/** Parameters shared by Solana token pool rate-limit generation and execution. */
type SetChainRateLimitParams = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Rate limit for tokens received from the remote chain. Disabled limits default omitted values to zero. */
  inbound: RateLimitConfig
  /** Rate limit for tokens sent to the remote chain. Disabled limits default omitted values to zero. */
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
  inbound: ParsedRateLimitConfig
  outbound: ParsedRateLimitConfig
}

/** Parameters for unsigned Solana token pool rate-limit configuration. */
export type GenerateSetChainRateLimitParams = SolanaGenerateParams<SetChainRateLimitParams>

/** Unsigned Solana token pool rate-limit configuration result. */
export type GenerateSetChainRateLimitResult = UnsignedSolanaTx

/** Parameters for executing Solana token pool rate-limit configuration. */
export type ExecuteSetChainRateLimitParams = SolanaExecuteParams<SetChainRateLimitParams>

/** Result of executing Solana token pool rate-limit configuration. */
export type ExecuteSetChainRateLimitResult = TransactionResult

/**
 * Sets inbound and outbound rate limits for an initialized remote-chain config.
 *
 * @remarks `authority` must be the pool owner or rate-limit admin. The remote-chain config must
 * already exist.
 */
export class SetChainRateLimit extends SolanaOperation<
  SetChainRateLimitParams,
  UnsignedSolanaTx,
  ParsedSetChainRateLimitParams
> {
  readonly name = 'setChainRateLimit'

  /** Parses rate limits and defaults authority to payer without mutating caller params. */
  protected override parse(params: GenerateSetChainRateLimitParams): ParsedSetChainRateLimitParams {
    validateBigInt(this.name, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
    const inbound = parseRateLimitConfig(this.name, 'inbound', params.inbound)
    const outbound = parseRateLimitConfig(this.name, 'outbound', params.outbound)
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
      inbound,
      outbound,
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

  /** Generate, sign, simulate, send, and confirm with the pool owner or rate-limit admin wallet. */
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
