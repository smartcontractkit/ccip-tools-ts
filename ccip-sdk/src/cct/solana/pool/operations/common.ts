/**
 * Shared helpers for Solana token-pool CCT operations (applyChainUpdates,
 * deleteChainConfig, appendRemotePoolAddresses, removeRemotePoolAddresses).
 *
 * Targets the token POOL program (burn-mint / lock-release), not the router:
 * derives pool state/chain-config PDAs and builds pool-program instructions.
 *
 * @packageDocumentation
 */

import { Buffer } from 'buffer'

import { type TransactionInstruction, PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'
import { hexlify, zeroPadValue } from 'ethers'

import type { SolanaChain } from '../../../../solana/index.ts'
import { getAddressBytes } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram, deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'

/** Anchor seed prefix for a token pool per-chain config PDA. */
const CCIP_TOKENPOOL_CHAINCONFIG_SEED = 'ccip_tokenpool_chainconfig'

/** Rate limiter configuration for one direction of a remote chain lane. */
export type RateLimiterConfig = {
  /** Whether the rate limiter is enabled. */
  isEnabled: boolean
  /** Maximum token bucket capacity (bigint as string). */
  capacity: string
  /** Token refill rate per second (bigint as string). */
  rate: string
}

/** Configuration for a single remote chain on a token pool. */
export type RemoteChainConfig = {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /** Remote pool address(es) in native format. At least one required. */
  remotePoolAddresses: string[]
  /** Remote token address in native format. */
  remoteTokenAddress: string
  /** Remote token decimals (used in init_chain_remote_config). Defaults to 0. */
  remoteTokenDecimals?: number
  /** Outbound rate limiter (local to remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote to local). */
  inboundRateLimiterConfig: RateLimiterConfig
}

/**
 * Encodes a remote address to a 32-byte left-padded hex string.
 *
 * Handles hex (EVM/Aptos), base58 (Solana) and base64 (Sui/TON) via
 * {@link getAddressBytes}. Matches on-chain `LeftPadBytes(addr, 32)`.
 *
 * @param address - Address in native format
 * @returns 32-byte left-padded hex string (0x-prefixed)
 */
export function encodeRemoteAddress(address: string): string {
  return zeroPadValue(hexlify(getAddressBytes(address)), 32)
}

/**
 * Encodes a remote address to a 32-byte left-padded byte array.
 *
 * @param address - Address in native format
 * @returns 32-byte left-padded bytes
 */
export function encodeRemoteAddressBytes(address: string): Uint8Array {
  const hex = zeroPadValue(hexlify(getAddressBytes(address)), 32)
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'))
}

/**
 * Encodes a remote pool address to raw bytes (no padding).
 *
 * Pool addresses preserve their native byte length (20 bytes EVM, 32 bytes Solana)
 * so the on-chain program can compare them during ReleaseOrMintTokens.
 *
 * @param address - Address in native format
 * @returns Raw bytes (original length, no padding)
 */
export function encodeRemotePoolAddressBytes(address: string): Uint8Array {
  return getAddressBytes(address)
}

/** Little-endian 8-byte buffer for a u64 chain selector. */
function selectorLeBuffer(selector: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(selector)
  return buf
}

/** Derives a token pool per-chain config PDA for a mint and remote selector. */
export function deriveTokenPoolChainConfigPda(
  poolProgram: PublicKey,
  selector: bigint,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), selectorLeBuffer(selector), mint.toBuffer()],
    poolProgram,
  )[0]
}

/**
 * Discovers the pool program id (owner of the pool state account) and the mint
 * it manages from a pool state address.
 *
 * @param chain - Solana chain used for RPC + decoding
 * @param poolAddress - Pool state (config PDA) address
 * @returns The owning pool program id and managed mint
 * @throws {@link CCTParamsInvalidError} if the pool account does not exist
 */
export async function discoverPoolInfo(
  chain: SolanaChain,
  poolAddress: string,
): Promise<{ poolProgramId: PublicKey; mint: PublicKey }> {
  const poolPubkey = new PublicKey(poolAddress)
  const accountInfo = await chain.connection.getAccountInfo(poolPubkey)
  if (!accountInfo) {
    throw new CCTParamsInvalidError(
      'poolAddress',
      'poolAddress',
      `pool account not found: ${poolAddress}`,
    )
  }
  const mint = new PublicKey(await chain.getTokenForTokenPool(poolAddress))
  return { poolProgramId: accountInfo.owner, mint }
}

/** Inputs for {@link buildApplyChainUpdatesInstructions}. */
export type ApplyChainUpdatesBuild = {
  operation: string
  poolAddress: string
  authority: PublicKey
  remoteChainSelectorsToRemove: bigint[]
  chainsToAdd: RemoteChainConfig[]
}

/**
 * Builds the burn-mint/lock-release pool instruction set for applying chain updates:
 * a `deleteChainConfig` per removed selector, then per added chain an
 * `initChainRemoteConfig` (skipped if the PDA already exists and is not being
 * deleted), an `appendRemotePoolAddresses`, and a `setChainRateLimit`.
 *
 * @param chain - Solana chain used for RPC + program client construction
 * @param opts - Discovery + update inputs
 * @returns The ordered instruction list and discovered pool metadata
 */
export async function buildApplyChainUpdatesInstructions(
  chain: SolanaChain,
  opts: ApplyChainUpdatesBuild,
): Promise<{ instructions: TransactionInstruction[]; poolProgramId: PublicKey; mint: PublicKey }> {
  const { poolProgramId, mint } = await discoverPoolInfo(chain, opts.poolAddress)
  const state = deriveTokenPoolConfigPda(poolProgramId, mint)
  const program = createTokenPoolProgram(chain, poolProgramId, opts.authority)
  const instructions: TransactionInstruction[] = []

  for (const selector of opts.remoteChainSelectorsToRemove) {
    const chainConfig = deriveTokenPoolChainConfigPda(poolProgramId, selector, mint)
    instructions.push(
      await program.methods
        .deleteChainConfig(new BN(selector.toString()), mint)
        .accountsStrict({ state, chainConfig, authority: opts.authority })
        .instruction(),
    )
  }

  const selectorsBeingRemoved = new Set(opts.remoteChainSelectorsToRemove)

  for (const remote of opts.chainsToAdd) {
    const chainConfig = deriveTokenPoolChainConfigPda(
      poolProgramId,
      remote.remoteChainSelector,
      mint,
    )

    const existingConfig = await chain.connection.getAccountInfo(chainConfig)
    const beingDeleted = selectorsBeingRemoved.has(remote.remoteChainSelector)
    const alreadyInitialized = existingConfig !== null && !beingDeleted

    if (!alreadyInitialized) {
      instructions.push(
        await program.methods
          .initChainRemoteConfig(new BN(remote.remoteChainSelector.toString()), mint, {
            poolAddresses: [],
            tokenAddress: {
              address: Buffer.from(encodeRemoteAddressBytes(remote.remoteTokenAddress)),
            },
            decimals: remote.remoteTokenDecimals ?? 0,
          })
          .accountsStrict({
            state,
            chainConfig,
            authority: opts.authority,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      )
    }

    if (remote.remotePoolAddresses.length > 0) {
      const addresses = remote.remotePoolAddresses.map((addr) => ({
        address: Buffer.from(encodeRemotePoolAddressBytes(addr)),
      }))
      instructions.push(
        await program.methods
          .appendRemotePoolAddresses(new BN(remote.remoteChainSelector.toString()), mint, addresses)
          .accountsStrict({
            state,
            chainConfig,
            authority: opts.authority,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      )
    }

    instructions.push(
      await program.methods
        .setChainRateLimit(
          new BN(remote.remoteChainSelector.toString()),
          mint,
          {
            enabled: remote.inboundRateLimiterConfig.isEnabled,
            capacity: new BN(remote.inboundRateLimiterConfig.capacity),
            rate: new BN(remote.inboundRateLimiterConfig.rate),
          },
          {
            enabled: remote.outboundRateLimiterConfig.isEnabled,
            capacity: new BN(remote.outboundRateLimiterConfig.capacity),
            rate: new BN(remote.outboundRateLimiterConfig.rate),
          },
        )
        .accountsStrict({ state, chainConfig, authority: opts.authority })
        .instruction(),
    )
  }

  return { instructions, poolProgramId, mint }
}

// ── Validators (all throw CCTParamsInvalidError) ─────────────────────────────

/** Asserts a string param is present and non-blank. */
function assertNonEmpty(operation: string, param: string, value: string): void {
  if (!value || value.trim().length === 0) {
    throw new CCTParamsInvalidError(operation, param, 'must be non-empty')
  }
}

/** Asserts a chain selector is present and non-zero. */
function assertNonZeroSelector(operation: string, param: string, selector: bigint): void {
  if (selector == null || selector === 0n) {
    throw new CCTParamsInvalidError(operation, param, 'must be non-zero')
  }
}

/** Validates applyChainUpdates params. */
export function validateApplyChainUpdates(
  operation: string,
  poolAddress: string,
  chainsToAdd: RemoteChainConfig[],
): void {
  assertNonEmpty(operation, 'poolAddress', poolAddress)
  for (const [i, remote] of chainsToAdd.entries()) {
    assertNonZeroSelector(
      operation,
      `chainsToAdd[${i}].remoteChainSelector`,
      remote.remoteChainSelector,
    )
    if (remote.remotePoolAddresses.length === 0) {
      throw new CCTParamsInvalidError(
        operation,
        `chainsToAdd[${i}].remotePoolAddresses`,
        'must have at least one address',
      )
    }
    assertNonEmpty(operation, `chainsToAdd[${i}].remoteTokenAddress`, remote.remoteTokenAddress)
  }
}

/** Validates params that reference a single chain selector with pool addresses. */
export function validateSelectorWithAddresses(
  operation: string,
  poolAddress: string,
  remoteChainSelector: bigint,
  remotePoolAddresses: string[],
): void {
  assertNonEmpty(operation, 'poolAddress', poolAddress)
  assertNonZeroSelector(operation, 'remoteChainSelector', remoteChainSelector)
  if (remotePoolAddresses.length === 0) {
    throw new CCTParamsInvalidError(
      operation,
      'remotePoolAddresses',
      'must have at least one address',
    )
  }
  for (const [i, addr] of remotePoolAddresses.entries()) {
    assertNonEmpty(operation, `remotePoolAddresses[${i}]`, addr)
  }
}

/** Validates deleteChainConfig params. */
export function validateDeleteChainConfig(
  operation: string,
  poolAddress: string,
  remoteChainSelector: bigint,
): void {
  assertNonEmpty(operation, 'poolAddress', poolAddress)
  assertNonZeroSelector(operation, 'remoteChainSelector', remoteChainSelector)
}
