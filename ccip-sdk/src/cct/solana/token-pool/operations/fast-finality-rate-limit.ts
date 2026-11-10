/**
 * Parameters, parsing, and accounts shared by the operations on a CCIP 2.0 token pool's
 * faster-than-finality (FTF) rate limits: the pool's FTF `ChainConfigOverride` for a remote chain.
 * `PoolChainConfigOverrideType` has the single variant `FTF`, so these are the only overrides.
 *
 * @packageDocumentation
 */

import type { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { deriveTokenPoolChainConfigOverridePda } from '../../../../solana/token-pool.ts'
import type { SolanaGenerateParams } from '../../operation.ts'
import {
  type PoolProgramRef,
  deriveEventAuthorityPda,
  deriveTokenPoolConfigPda,
} from '../../programs/token-pool.ts'
import { U64_MAX, parseOptionalPublicKey, parsePublicKey, validateBigInt } from '../../validate.ts'
import {
  type ParsedRateLimitConfig,
  type RateLimitConfig,
  parseRateLimitConfig,
} from './set-chain-rate-limit.ts'

/** Parameters naming a pool's FTF rate limits for one remote chain. */
export type FastFinalityRateLimitRef = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
}

/** Parameters setting a pool's FTF rate limits for one remote chain. */
export type FastFinalityRateLimitParams = FastFinalityRateLimitRef & {
  /**
   * Rate limit for FTF transfers from the remote chain. Disabled limits default omitted values to
   * zero.
   */
  inbound: RateLimitConfig
  /**
   * Rate limit for FTF transfers to the remote chain. Disabled limits default omitted values to
   * zero.
   */
  outbound: RateLimitConfig
}

/** Parsed {@link FastFinalityRateLimitRef}. */
export type ParsedFastFinalityRateLimitRef = {
  tokenAddress: PublicKey
  poolProgramAddress?: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
}

/** Parsed {@link FastFinalityRateLimitParams}. */
export type ParsedFastFinalityRateLimitParams = ParsedFastFinalityRateLimitRef & {
  inbound: ParsedRateLimitConfig
  outbound: ParsedRateLimitConfig
}

/**
 * Parses the pool, remote chain, and authority, defaulting `authority` to `payer`.
 * @throws {@link CCTParamsInvalidError} if a public key or the selector is invalid.
 */
export function parseFastFinalityRateLimitRef(
  operation: string,
  params: SolanaGenerateParams<FastFinalityRateLimitRef & { authority?: string }>,
): ParsedFastFinalityRateLimitRef {
  validateBigInt(operation, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
  const payer = parsePublicKey(operation, 'payer', params.payer)
  return {
    tokenAddress: parsePublicKey(operation, 'tokenAddress', params.tokenAddress),
    poolProgramAddress: parseOptionalPublicKey(
      operation,
      'poolProgramAddress',
      params.poolProgramAddress,
    ),
    payer,
    authority:
      params.authority === undefined
        ? payer
        : parsePublicKey(operation, 'authority', params.authority),
    remoteChainSelector: params.remoteChainSelector,
  }
}

/**
 * Parses {@link FastFinalityRateLimitParams} as the pool program validates them.
 * @throws {@link CCTParamsInvalidError} if a public key, the selector, or a rate limit is invalid.
 */
export function parseFastFinalityRateLimitParams(
  operation: string,
  params: SolanaGenerateParams<FastFinalityRateLimitParams & { authority?: string }>,
): ParsedFastFinalityRateLimitParams {
  return {
    ...parseFastFinalityRateLimitRef(operation, params),
    inbound: parseRateLimitConfig(operation, 'inbound', params.inbound),
    outbound: parseRateLimitConfig(operation, 'outbound', params.outbound),
  }
}

const toRateLimitArg = ({ enabled, capacity, rate }: ParsedRateLimitConfig) => ({
  enabled,
  capacity: new BN(capacity.toString()),
  rate: new BN(rate.toString()),
})

/**
 * The `FTF` variant of `PoolChainConfigOverrideType`. Anchor 0.29 keys enum variants by
 * `camelcase(name)` at runtime (`ftf`), but its types by `Uncapitalize<name>` (`fTF`), which fails
 * to encode.
 */
const FTF_OVERRIDE = { ftf: {} } as unknown as { fTF: Record<string, never> }

/** The instruction argument naming the FTF override of a remote chain. */
export function toOverrideRefArg(opts: ParsedFastFinalityRateLimitRef) {
  return {
    remoteChainSelector: new BN(opts.remoteChainSelector.toString()),
    mint: opts.tokenAddress,
    overrideType: FTF_OVERRIDE,
  }
}

/** The instruction argument setting the FTF rate limits of a remote chain. */
export function toOverrideRateLimitArg(opts: ParsedFastFinalityRateLimitParams) {
  return {
    ...toOverrideRefArg(opts),
    inbound: toRateLimitArg(opts.inbound),
    outbound: toRateLimitArg(opts.outbound),
  }
}

/** Accounts every FTF override instruction takes, besides the system program on init. */
export function overrideAccounts(poolProgram: PublicKey, opts: ParsedFastFinalityRateLimitRef) {
  return {
    state: deriveTokenPoolConfigPda(poolProgram, opts.tokenAddress),
    chainConfigOverride: deriveTokenPoolChainConfigOverridePda(
      poolProgram,
      opts.remoteChainSelector,
      opts.tokenAddress,
    ),
    authority: opts.authority,
    eventAuthority: deriveEventAuthorityPda(poolProgram),
    program: poolProgram,
  }
}
