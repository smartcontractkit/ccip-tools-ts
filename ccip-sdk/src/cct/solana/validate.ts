import type { Buffer } from 'buffer'

import { type Account, TokenAccountNotFoundError, getAccount } from '@solana/spl-token'
import { type AccountInfo, type Connection, PublicKey } from '@solana/web3.js'

import {
  CCIPAddressInvalidError,
  CCIPTokenAccountNotFoundError,
  CCIPTokenPoolStateNotFoundError,
} from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { resolveATA } from '../../solana/utils.ts'
import {
  CCTParamsInvalidError,
  CCTTokenAccountMintMismatchError,
  CCTTxFailedError,
} from '../errors.ts'
import {
  type TokenPoolConfig,
  type TokenPoolType,
  TOKEN_POOL_PROGRAMS,
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from './programs/token-pool.ts'

/** Largest value representable by an unsigned 64-bit integer. */
export const U64_MAX = 0xffff_ffff_ffff_ffffn

/**
 * Parses `value` as a Solana public key.
 * @throws CCTParamsInvalidError if `value` is not a valid Solana public key string.
 */
export function parsePublicKey(operation: string, param: string, value: unknown): PublicKey {
  if (typeof value !== 'string') {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got "${String(value)}"`,
    )
  }

  try {
    return new PublicKey(value)
  } catch {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got "${String(value)}"`,
      {
        cause: new CCIPAddressInvalidError(value, ChainFamily.Solana),
      },
    )
  }
}

/**
 * Asserts `value` is a valid Solana public key string.
 * @throws CCTParamsInvalidError if `value` is not a valid Solana public key string.
 */
export function validatePublicKey(
  operation: string,
  param: string,
  value: unknown,
): asserts value is string {
  parsePublicKey(operation, param, value)
}

/**
 * Asserts `value` is a valid Solana public key string, or is absent.
 * Only `undefined` counts as absent; `null` and `''` are treated as provided and rejected.
 * @throws {@link CCTParamsInvalidError} if a non-`undefined` `value` is not a valid public key string.
 */
export function validateOptionalPublicKey(
  operation: string,
  param: string,
  value: unknown,
): asserts value is string | undefined {
  if (value !== undefined) validatePublicKey(operation, param, value)
}

/**
 * Parses `value` as a Solana public key, or returns `undefined` when `value` is `undefined`.
 * @throws {@link CCTParamsInvalidError} if a non-`undefined` `value` is not a valid public key string.
 */
export function parseOptionalPublicKey(
  operation: string,
  param: string,
  value: unknown,
): PublicKey | undefined {
  return value === undefined ? undefined : parsePublicKey(operation, param, value)
}

/**
 * Asserts `values` is an array of valid Solana public key strings.
 * @throws CCTParamsInvalidError if `values` is not an array or any item is invalid.
 */
export function validatePublicKeys(operation: string, param: string, values: unknown): void {
  if (!Array.isArray(values)) throw new CCTParamsInvalidError(operation, param, 'must be an array')
  for (const [i, value] of values.entries()) validatePublicKey(operation, `${param}[${i}]`, value)
}

/**
 * Asserts public keys do not contain duplicates.
 * @throws CCTParamsInvalidError if a public key is duplicated.
 */
export function validateUniquePublicKeys(
  operation: string,
  param: string,
  publicKeys: PublicKey[],
): void {
  const seen = new Set<string>()
  for (const [i, publicKey] of publicKeys.entries()) {
    const address = publicKey.toBase58()
    if (seen.has(address)) {
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must not contain duplicate addresses',
      )
    }
    seen.add(address)
  }
}

/**
 * Asserts bigint chain selectors do not contain duplicates.
 * @remarks Silently ignores non-bigint entries; relies on downstream `validateBigInt` for type safety.
 * @throws CCTParamsInvalidError if a chain selector is duplicated.
 */
export function validateUniqueChainSelectors(
  operation: string,
  param: string,
  selectors: unknown[],
): void {
  const seen = new Set<bigint>()
  for (const [i, selector] of selectors.entries()) {
    if (typeof selector === 'bigint' && seen.has(selector)) {
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must not contain duplicate chain selectors',
      )
    }
    if (typeof selector === 'bigint') seen.add(selector)
  }
}

/**
 * Asserts `value` is a non-empty string.
 * @throws CCTParamsInvalidError if `value` is not a non-empty string.
 */
export function validateNonEmptyString(operation: string, param: string, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) return
  throw new CCTParamsInvalidError(operation, param, 'must be a non-empty string')
}

/**
 * Asserts an authority matches the executing wallet.
 * @throws CCTParamsInvalidError if authority does not match wallet.
 */
export function validateAuthorityMatchesWallet(
  operation: string,
  authority: PublicKey,
  wallet: PublicKey,
  errorMessage = 'must match the executing wallet',
): void {
  if (!authority.equals(wallet)) {
    throw new CCTParamsInvalidError(operation, 'authority', errorMessage)
  }
}

/**
 * Asserts `value` is a supported token pool type.
 * @throws CCTParamsInvalidError if `value` is not `burn-mint` or `lock-release`.
 */
export function validatePoolType(
  operation: string,
  param: string,
  value: unknown,
): asserts value is TokenPoolType {
  if (typeof value !== 'string' || !Object.hasOwn(TOKEN_POOL_PROGRAMS, value)) {
    throw new CCTParamsInvalidError(operation, param, 'must be burn-mint or lock-release')
  }
}

/** State account of an existing token pool, with the program that owns it. */
export type ExistingPoolState = {
  /** Pool program that owns the state account. */
  poolProgram: PublicKey
  /** Pool state (config) PDA for the mint under `poolProgram`. */
  state: PublicKey
  /** The state account as read. */
  account: AccountInfo<Buffer>
}

/** Positive pool program resolutions per chain, keyed by mint or `mint:program`; misses are not cached. */
const resolvedPoolPrograms = new WeakMap<SolanaChain, Map<string, PublicKey>>()

function poolProgramCacheKey(mint: PublicKey, poolProgram?: PublicKey): string {
  return poolProgram ? `${mint.toBase58()}:${poolProgram.toBase58()}` : mint.toBase58()
}

function poolProgramCache(chain: SolanaChain): Map<string, PublicKey> {
  let cache = resolvedPoolPrograms.get(chain)
  if (!cache) resolvedPoolPrograms.set(chain, (cache = new Map()))
  return cache
}

/**
 * Reads the state account of an existing token pool for a mint, resolving its program on-chain.
 *
 * @remarks Without `poolProgramAddress`, reads both canonical state PDAs in one
 * `getMultipleAccountsInfo`. Resolutions are cached per chain instance and mint.
 * @throws {@link CCTParamsInvalidError} if `poolProgramAddress` is omitted and the mint has no
 * canonical pool, or both.
 * @throws {@link CCIPTokenPoolStateNotFoundError} if the state PDA under the given or cached
 * program does not exist.
 */
export async function resolveExistingPoolState(
  operation: string,
  chain: SolanaChain,
  mint: PublicKey,
  poolProgramAddress?: PublicKey,
): Promise<ExistingPoolState> {
  const cache = poolProgramCache(chain)
  const known = poolProgramAddress ?? cache.get(poolProgramCacheKey(mint))
  if (known) {
    const state = deriveTokenPoolConfigPda(known, mint)
    const account = await chain.connection.getAccountInfo(state)
    if (!account) {
      // Never serve a stale resolution again.
      cache.delete(poolProgramCacheKey(mint, known))
      if (cache.get(poolProgramCacheKey(mint))?.equals(known))
        cache.delete(poolProgramCacheKey(mint))
      throw new CCIPTokenPoolStateNotFoundError(state.toBase58(), {
        context: { mint: mint.toBase58(), poolProgram: known.toBase58() },
      })
    }
    cache.set(poolProgramCacheKey(mint, known), known)
    return { poolProgram: known, state, account }
  }

  const candidates = Object.values(TOKEN_POOL_PROGRAMS).map((address) => {
    const poolProgram = new PublicKey(address)
    return { poolProgram, state: deriveTokenPoolConfigPda(poolProgram, mint) }
  })
  const accounts = await chain.connection.getMultipleAccountsInfo(
    candidates.map(({ state }) => state),
  )
  const found = candidates.flatMap((candidate, i) => {
    const account = accounts[i]
    return account ? [{ ...candidate, account }] : []
  })
  const [resolved] = found
  if (!resolved) {
    throw new CCTParamsInvalidError(
      operation,
      'tokenAddress',
      `no canonical burn-mint or lock-release token pool exists for mint ${mint.toBase58()}; deploy one first, or pass poolProgramAddress for a custom pool program`,
    )
  }
  if (found.length > 1) {
    throw new CCTParamsInvalidError(
      operation,
      'poolProgramAddress',
      `required: mint ${mint.toBase58()} has both canonical burn-mint and lock-release token pools; pass the program of the pool to use`,
    )
  }

  cache.set(poolProgramCacheKey(mint), resolved.poolProgram)
  cache.set(poolProgramCacheKey(mint, resolved.poolProgram), resolved.poolProgram)
  return resolved
}

/**
 * Reads and decodes the state of an existing token pool for a mint.
 * @see {@link resolveExistingPoolState}
 * @throws {@link CCTDataDecodeError} if the state account cannot be decoded.
 */
export async function resolveExistingPoolConfig(
  operation: string,
  chain: SolanaChain,
  mint: PublicKey,
  poolProgramAddress?: PublicKey,
): Promise<ExistingPoolState & { version: number; config: TokenPoolConfig }> {
  const existing = await resolveExistingPoolState(operation, chain, mint, poolProgramAddress)
  return {
    ...existing,
    ...decodeTokenPoolState(existing.account.data, {
      tokenPool: existing.state.toBase58(),
      mint: mint.toBase58(),
      poolProgram: existing.poolProgram.toBase58(),
      accountOwner: existing.account.owner.toBase58(),
    }),
  }
}

/**
 * Resolves the program of an existing token pool for a mint; a cached resolution costs no RPC.
 * @see {@link resolveExistingPoolState}
 */
export async function resolveExistingPoolProgram(
  operation: string,
  chain: SolanaChain,
  mint: PublicKey,
  poolProgramAddress?: PublicKey,
): Promise<PublicKey> {
  return (
    resolvedPoolPrograms.get(chain)?.get(poolProgramCacheKey(mint, poolProgramAddress)) ??
    (await resolveExistingPoolState(operation, chain, mint, poolProgramAddress)).poolProgram
  )
}

/**
 * Identifies a token pool program's type: canonical programs by address, custom programs by their
 * `typeAndVersion`.
 * @returns `undefined` for a custom program without `typeVersion`, or whose type names neither.
 */
export async function resolvePoolProgramType(
  chain: SolanaChain,
  poolProgram: PublicKey,
): Promise<TokenPoolType | undefined> {
  if (poolProgram.equals(resolveTokenPoolProgram('burn-mint'))) return 'burn-mint'
  if (poolProgram.equals(resolveTokenPoolProgram('lock-release'))) return 'lock-release'

  let type: string
  try {
    ;[type] = await chain.typeAndVersion(poolProgram.toBase58())
  } catch {
    // Custom pool programs may not implement `typeVersion`.
    return undefined
  }
  if (/LockRelease/i.test(type)) return 'lock-release'
  if (/BurnMint/i.test(type)) return 'burn-mint'
  return undefined
}

/**
 * Rejects a resolved pool program known to be burn-mint. A custom program of unknown type is
 * accepted; it must have the canonical lock-release instructions and account layout.
 * @throws {@link CCTParamsInvalidError} if the pool program is burn-mint.
 */
export async function validateLockReleasePoolProgram(
  operation: string,
  chain: SolanaChain,
  poolProgram: PublicKey,
  poolProgramAddress?: PublicKey,
): Promise<void> {
  if ((await resolvePoolProgramType(chain, poolProgram)) !== 'burn-mint') return
  throw poolProgramAddress
    ? new CCTParamsInvalidError(
        operation,
        'poolProgramAddress',
        'must be a lock-release token pool program, got burn-mint',
      )
    : new CCTParamsInvalidError(
        operation,
        'tokenAddress',
        `token pool is burn-mint; ${operation} requires a lock-release pool`,
      )
}

/**
 * Resolves the program of an existing lock-release token pool for a mint.
 * @see {@link resolveExistingPoolProgram}
 * @throws {@link CCTParamsInvalidError} if the resolved pool program is burn-mint.
 */
export async function resolveExistingLockReleasePoolProgram(
  operation: string,
  chain: SolanaChain,
  mint: PublicKey,
  poolProgramAddress?: PublicKey,
): Promise<PublicKey> {
  const poolProgram = await resolveExistingPoolProgram(operation, chain, mint, poolProgramAddress)
  await validateLockReleasePoolProgram(operation, chain, poolProgram, poolProgramAddress)
  return poolProgram
}

/**
 * Asserts `value` is an integer, optionally inside inclusive bounds.
 * @throws CCTParamsInvalidError if `value` is not an integer or is outside bounds.
 */
export function validateInteger(
  operation: string,
  param: string,
  value: unknown,
  min?: number,
  max?: number,
): void {
  const validInteger = Number.isInteger(value)
  const validMin = min === undefined || (validInteger && Number(value) >= min)
  const validMax = max === undefined || (validInteger && Number(value) <= max)

  if (!validInteger || !validMin || !validMax) {
    const range =
      min !== undefined && max !== undefined
        ? ` between ${min} and ${max}`
        : min !== undefined
          ? ` >= ${min}`
          : max !== undefined
            ? ` <= ${max}`
            : ''
    throw new CCTParamsInvalidError(operation, param, `must be an integer${range}`)
  }
}

/**
 * Asserts `value` is a bigint, optionally inside inclusive bounds.
 * @throws CCTParamsInvalidError if `value` is not a bigint or is outside bounds.
 */
export function validateBigInt(
  operation: string,
  param: string,
  value: unknown,
  min?: bigint,
  max?: bigint,
): asserts value is bigint {
  const validBigInt = typeof value === 'bigint'
  const validMin = min === undefined || (validBigInt && value >= min)
  const validMax = max === undefined || (validBigInt && value <= max)

  if (!validBigInt || !validMin || !validMax) {
    const range =
      min !== undefined && max !== undefined
        ? ` between ${min} and ${max}`
        : min !== undefined
          ? ` >= ${min}`
          : max !== undefined
            ? ` <= ${max}`
            : ''
    throw new CCTParamsInvalidError(operation, param, `must be a bigint${range}`)
  }
}

/**
 * Asserts ALT writable indexes are a non-empty list of byte values when provided.
 * @throws CCTParamsInvalidError if indexes are empty or outside byte range.
 */
export function validateWritableIndexes(
  operation: string,
  param: string,
  writableIndexes: unknown,
): void {
  if (writableIndexes === undefined) return
  if (!Array.isArray(writableIndexes) || writableIndexes.length === 0) {
    throw new CCTParamsInvalidError(operation, param, 'must be a non-empty array')
  }

  for (const [i, index] of writableIndexes.entries()) {
    validateInteger(operation, `${param}[${i}]`, index, 0, 255)
  }
}

/**
 * Validates that a token account delegates at least an amount to the expected delegate.
 * @throws {@link CCTTxFailedError} If the delegate is missing, differs, or has insufficient allowance.
 */
export function validateDelegation(
  operation: string,
  tokenAccount: PublicKey,
  account: Account,
  delegate: PublicKey,
  amount: bigint,
): void {
  if (account.delegate?.equals(delegate) && account.delegatedAmount >= amount) return

  const delegation = !account.delegate
    ? 'has no delegate'
    : !account.delegate.equals(delegate)
      ? `delegates to ${account.delegate.toBase58()}`
      : `delegates only ${account.delegatedAmount}`
  throw new CCTTxFailedError(
    operation,
    `token account ${tokenAccount.toBase58()} ${delegation}; delegate at least ${amount} to ${delegate.toBase58()} with approveToken first`,
    {
      context: {
        tokenAccount: tokenAccount.toBase58(),
        delegate: account.delegate?.toBase58(),
        expectedDelegate: delegate.toBase58(),
        delegatedAmount: account.delegatedAmount.toString(),
      },
    },
  )
}

/**
 * Verifies that a rebalancer may move liquidity for a lock-release pool.
 * @throws {@link CCTTxFailedError} If the authority is not the rebalancer or liquidity is disabled.
 */
export function validatePoolLiquidityConfig(
  operation: string,
  config: TokenPoolConfig,
  authority: PublicKey,
): void {
  if (!config.rebalancer.equals(authority))
    throw new CCTTxFailedError(
      operation,
      `pool rebalancer is ${config.rebalancer.toBase58()}, not ${authority.toBase58()}; set it with setRebalancer first`,
    )
  if (!config.canAcceptLiquidity)
    throw new CCTTxFailedError(
      operation,
      'pool does not accept liquidity; enable it with setCanAcceptLiquidity(true) first',
    )
}

/**
 * Resolves an existing token account, defaulting to the holder's associated token account.
 * @throws {@link CCIPTokenAccountNotFoundError} If the token account does not exist.
 * @throws {@link CCTTokenAccountMintMismatchError} If an explicitly supplied token account belongs to a different mint.
 */
export async function resolveExistingTokenAccount(
  connection: Connection,
  tokenAddress: PublicKey,
  holder: PublicKey,
  tokenAccount?: PublicKey,
): Promise<{
  tokenAccount: PublicKey
  tokenProgram: PublicKey
  account: Account
}> {
  const { ata, tokenProgram } = await resolveATA(connection, tokenAddress, holder)
  const account = tokenAccount ?? ata
  let tokenAccountInfo: Account

  try {
    tokenAccountInfo = await getAccount(connection, account, undefined, tokenProgram)
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      throw new CCIPTokenAccountNotFoundError(tokenAddress.toBase58(), holder.toBase58())
    }
    throw error
  }

  if (tokenAccount && !tokenAccountInfo.mint.equals(tokenAddress)) {
    throw new CCTTokenAccountMintMismatchError(
      account.toBase58(),
      tokenAddress.toBase58(),
      tokenAccountInfo.mint.toBase58(),
    )
  }

  return { tokenAccount: account, tokenProgram, account: tokenAccountInfo }
}
