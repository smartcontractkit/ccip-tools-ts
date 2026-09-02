import { Buffer } from 'buffer'

import { type Account, TokenAccountNotFoundError, getAccount } from '@solana/spl-token'
import { type Connection, PublicKey } from '@solana/web3.js'

import {
  CCIPAddressInvalidError,
  CCIPTokenAccountNotFoundError,
  CCIPTokenPoolStateNotFoundError,
} from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { resolveATA } from '../../solana/utils.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../errors.ts'
import {
  type PoolProgramRef,
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
 * Asserts `values` is an array of valid Solana public key strings.
 * @throws CCTParamsInvalidError if `values` is not an array or any item is invalid.
 */
export function validatePublicKeys(operation: string, param: string, values: unknown): void {
  if (!Array.isArray(values)) throw new CCTParamsInvalidError(operation, param, 'must be an array')
  for (const [i, value] of values.entries()) validatePublicKey(operation, `${param}[${i}]`, value)
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

/** Resolves a canonical pool type or custom program address. */
export function resolvePoolProgram(operation: string, params: PoolProgramRef): PublicKey {
  // Value semantics: explicit undefined does not count as provided.
  const hasPoolType = params.poolType !== undefined
  const hasPoolProgramAddress = params.poolProgramAddress !== undefined
  if (hasPoolType === hasPoolProgramAddress) {
    throw new CCTParamsInvalidError(
      operation,
      'poolType',
      'provide exactly one of poolType or poolProgramAddress',
    )
  }

  if (hasPoolType) {
    validatePoolType(operation, 'poolType', params.poolType)
    return resolveTokenPoolProgram(params.poolType)
  }

  return parsePublicKey(operation, 'poolProgramAddress', params.poolProgramAddress)
}

/** Resolves a lock-release token pool program and rejects the canonical burn-mint program. */
export function resolveLockReleasePoolProgram(
  operation: string,
  params: PoolProgramRef,
): PublicKey {
  const poolProgram = resolvePoolProgram(operation, params)
  if (poolProgram.equals(resolveTokenPoolProgram('burn-mint'))) {
    throw new CCTParamsInvalidError(
      operation,
      params.poolProgramAddress === undefined ? 'poolType' : 'poolProgramAddress',
      'must be lock-release',
    )
  }
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
 * Parses an optionally `0x`-prefixed hex string into bytes, with an optional maximum size.
 * @throws CCTParamsInvalidError if `value` is not valid hex or exceeds the requested size.
 */
export function parseHexBytes(
  operation: string,
  param: string,
  value: unknown,
  maxBytes?: number,
): Buffer {
  const hex = typeof value === 'string' ? value.replace(/^0x/, '') : ''
  if (
    typeof value !== 'string' ||
    !/^(?:[\da-fA-F]{2})*$/.test(hex) ||
    (maxBytes !== undefined && hex.length / 2 > maxBytes)
  ) {
    const size = maxBytes === undefined ? '' : ` of at most ${maxBytes} bytes`
    throw new CCTParamsInvalidError(operation, param, `must be a hex string${size}`)
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Parses a non-empty optionally `0x`-prefixed hex string into bytes.
 * @throws CCTParamsInvalidError if `value` is not valid non-empty hex or exceeds the requested size.
 */
export function parseNonEmptyHexBytes(
  operation: string,
  param: string,
  value: unknown,
  maxBytes?: number,
): Buffer {
  const bytes = parseHexBytes(operation, param, value, maxBytes)
  if (!bytes.length) throw new CCTParamsInvalidError(operation, param, 'must not be empty')
  return bytes
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
 * @throws {@link CCIPTokenPoolStateNotFoundError} If the token pool state is missing.
 * @throws {@link CCTTxFailedError} If the authority is not the rebalancer or liquidity is disabled.
 */
export async function validatePoolLiquidityConfig(
  operation: string,
  chain: SolanaChain,
  poolProgram: PublicKey,
  mint: PublicKey,
  authority: PublicKey,
): Promise<void> {
  const state = deriveTokenPoolConfigPda(poolProgram, mint)
  const account = await chain.connection.getAccountInfo(state)
  if (!account) throw new CCIPTokenPoolStateNotFoundError(state.toBase58())

  const { config } = decodeTokenPoolState(account.data, {
    tokenPool: state.toBase58(),
    mint: mint.toBase58(),
    poolProgram: poolProgram.toBase58(),
    accountOwner: account.owner.toBase58(),
  })
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
 */
export async function resolveExistingTokenAccount(
  connection: Connection,
  tokenAddress: PublicKey,
  holder: PublicKey,
  tokenAccount?: PublicKey,
): Promise<{ tokenAccount: PublicKey; tokenProgram: PublicKey; account: Account }> {
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

  return { tokenAccount: account, tokenProgram, account: tokenAccountInfo }
}
