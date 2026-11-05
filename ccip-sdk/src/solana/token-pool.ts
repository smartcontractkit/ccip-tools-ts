import { Buffer } from 'buffer'

import type { IdlTypes } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { type FinalityAllowed, decodeFinalityAllowed } from '../extra-args.ts'
import { toLeArray } from '../utils.ts'
import { sizedCoder } from './coder.ts'
import { IDL as BASE_TOKEN_POOL } from './idl/2.0.0/BASE_TOKEN_POOL.ts'

type TokenPoolTypes = IdlTypes<typeof BASE_TOKEN_POOL>

/** Leading fields of a token pool's `State.config`, shared by 1.6 and 2.0 pools. */
export type TokenPoolStateConfig = TokenPoolTypes['BaseConfig']

/** Remote token, pools and rate limits a token pool stores per remote chain. */
export type TokenPoolChainConfig = TokenPoolTypes['BaseChain']

/** Allowed finality and token transfer fees a 2.0 token pool configures per remote chain. */
export type TokenPoolChainConfigV2 = {
  allowedFinalityConfig: TokenPoolTypes['FinalityConfig']
  tokenTransferFeeConfig: TokenPoolTypes['TokenTransferFeeConfig']
}

/** Rate limits a 2.0 token pool applies to faster-than-finality transfers on a remote chain. */
export type TokenPoolChainConfigOverride = TokenPoolTypes['BaseOverrideConfig']

const tokenPoolCoder = sizedCoder(BASE_TOKEN_POOL)

// CCTP and Lombard pools prefix `ChainConfig` with a schema version byte, under the same account
// discriminator.
const versionedChainConfigCoder = sizedCoder({
  ...BASE_TOKEN_POOL,
  accounts: [
    {
      name: 'chainConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'version', type: 'u8' },
          { name: 'base', type: { defined: 'BaseChain' } },
        ],
      },
    },
  ],
})

/**
 * Decodes the config of a token pool `State` account.
 *
 * @param data - Raw `State` account data.
 * @returns The pool config's leading fields, through `router`.
 */
export function decodeTokenPoolStateConfig(data: Buffer): TokenPoolStateConfig {
  return tokenPoolCoder.accounts.decode<{ config: TokenPoolStateConfig }>('state', data).config
}

/**
 * Decodes a token pool `ChainConfig` account.
 *
 * @param data - Raw `ChainConfig` account data.
 * @param poolType - The pool program's `typeAndVersion` type, which selects the layout of canonical
 *   pools; for other pools (custom ones may not implement `typeVersion`), each layout is tried in
 *   turn.
 * @returns The pool's config for the account's remote chain.
 */
export function decodeTokenPoolChainConfig(data: Buffer, poolType?: string): TokenPoolChainConfig {
  const coders = /cctp|lombard/i.test(poolType ?? '')
    ? [versionedChainConfigCoder]
    : /burn-?mint|lock-?release/i.test(poolType ?? '')
      ? [tokenPoolCoder]
      : [tokenPoolCoder, versionedChainConfigCoder]
  let error
  for (const coder of coders) {
    try {
      return coder.accounts.decode<{ base: TokenPoolChainConfig }>('chainConfig', data).base
    } catch (err) {
      error ??= err
    }
  }
  throw error
}

/**
 * Decodes a 2.0 token pool's `ChainConfigV2` account.
 *
 * @param data - Raw `ChainConfigV2` account data.
 * @returns The pool's allowed finality and token transfer fees for the account's remote chain.
 */
export function decodeTokenPoolChainConfigV2(data: Buffer): TokenPoolChainConfigV2 {
  return tokenPoolCoder.accounts.decode<TokenPoolChainConfigV2>('chainConfigV2', data)
}

/**
 * Decodes a 2.0 token pool's allowed finality for a remote chain.
 *
 * @param config - The `allowedFinalityConfig` of a `ChainConfigV2`.
 * @returns The allowed `finalityDepth`, and `finalitySafe` if set.
 */
export function decodeTokenPoolFinality({
  flags,
  blockDepth,
}: TokenPoolChainConfigV2['allowedFinalityConfig']): FinalityAllowed {
  // same encoding as EVM's allowed finality: flags in the high 16 bits, block depth in the low
  return decodeFinalityAllowed(flags * 2 ** 16 + blockDepth)
}

/**
 * Derives a 2.0 token pool's `ChainConfigV2` PDA for a remote chain.
 *
 * @param poolProgram - Token pool program.
 * @param remoteChainSelector - Remote chain selector.
 * @param mint - Token mint the pool manages.
 * @returns The `ChainConfigV2` PDA, which may not be initialized.
 */
export function deriveTokenPoolChainConfigV2Pda(
  poolProgram: PublicKey,
  remoteChainSelector: bigint,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('ccip_tokenpool_chainconfig_2_0'),
      toLeArray(remoteChainSelector, 8),
      mint.toBuffer(),
    ],
    poolProgram,
  )[0]
}

/**
 * Decodes a token pool's faster-than-finality `ChainConfigOverride` account.
 *
 * @param data - Raw `ChainConfigOverride` account data.
 * @returns The override's remote chain and rate limits.
 */
export function decodeTokenPoolChainConfigOverride(data: Buffer): TokenPoolChainConfigOverride {
  return tokenPoolCoder.accounts.decode<{ base: TokenPoolChainConfigOverride }>(
    'chainConfigOverride',
    data,
  ).base
}

/**
 * Derives a token pool's faster-than-finality `ChainConfigOverride` PDA for a remote chain.
 *
 * @param poolProgram - Token pool program.
 * @param remoteChainSelector - Remote chain selector.
 * @param mint - Token mint the pool manages.
 * @returns The override PDA, which may not be initialized.
 */
export function deriveTokenPoolChainConfigOverridePda(
  poolProgram: PublicKey,
  remoteChainSelector: bigint,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('chainconfig_override'),
      toLeArray(remoteChainSelector, 8),
      mint.toBuffer(),
      Buffer.from('ftf'),
    ],
    poolProgram,
  )[0]
}
