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

/** CCVs a 2.0 token pool requires on a remote chain's lane, as stored in its `ChainConfigV2`. */
export type TokenPoolCCVConfigAccount = TokenPoolTypes['CCVConfig']

/** Allowed finality, token transfer fees and CCVs a 2.0 token pool configures per remote chain. */
export type TokenPoolChainConfigV2 = {
  allowedFinalityConfig: TokenPoolTypes['FinalityConfig']
  tokenTransferFeeConfig: TokenPoolTypes['TokenTransferFeeConfig']
  ccvConfig: TokenPoolCCVConfigAccount
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
 * @returns The pool's allowed finality, token transfer fees and CCVs for the account's remote chain.
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

// Anchor discriminator of the CCTP token pool's verifier `Config` account:
// sha256("account:Config")[..8]
const CCTP_VERIFIER_CONFIG_DISCRIMINATOR = Buffer.from([155, 12, 170, 224, 30, 250, 204, 130])
// `Config` layout: discriminator, version u8, bump u8, then the owner, storage_location_admin,
// allowlist_admin, fee_aggregator, proposed_owner and proposed_storage_location_admin pubkeys,
// allowed_finality_config (flags u16, block_depth u16), and fast_finality_bps u16
const CCTP_VERIFIER_FAST_FINALITY_BPS_OFFSET = 8 + 2 + 6 * 32 + 4

/**
 * Derives the `Config` PDA of the verifier (CCV) built into a CCTP token pool program.
 *
 * @param poolProgram - CCTP token pool program.
 * @returns The verifier `Config` PDA, which may not be initialized.
 */
export function deriveCctpVerifierConfigPda(poolProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], poolProgram)[0]
}

/**
 * Decodes the `fast_finality_bps` of a CCTP token pool's verifier `Config`: the basis points of
 * the transferred amount that the verifier lets Circle take as its fee for a fast (non-finalized)
 * CCTP transfer from Solana, deducted from the amount minted on the destination chain. Finalized
 * transfers carry no Circle fee (the verifier sets their `maxFee` to 0).
 *
 * @param data - Raw verifier `Config` account data.
 * @returns The configured fast-finality basis points, or undefined if `data` isn't a verifier
 *   `Config` account.
 */
export function decodeCctpVerifierFastFinalityBps(data: Buffer): number | undefined {
  if (
    data.length < CCTP_VERIFIER_FAST_FINALITY_BPS_OFFSET + 2 ||
    !data.subarray(0, 8).equals(CCTP_VERIFIER_CONFIG_DISCRIMINATOR)
  )
    return
  return data.readUInt16LE(CCTP_VERIFIER_FAST_FINALITY_BPS_OFFSET)
}
