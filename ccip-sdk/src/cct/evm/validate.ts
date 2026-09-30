/**
 * Generic parameter primitives for EVM CCT ops — one Solidity type or one JS shape each, no domain
 * knowledge and no chain access, so every one of them throws {@link CCTParamsInvalidError} before
 * the first RPC. Op-specific rules (rate limits, lane shapes) live with their op.
 *
 * @packageDocumentation
 */

import { ZeroAddress, getAddress, isAddress } from 'ethers'

import { CCIPAddressInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTParamsInvalidError } from '../errors.ts'

/**
 * Asserts `value` is a valid EVM address, narrowing it to `string` for callers. Links the
 * canonical {@link CCIPAddressInvalidError} as the `cause`, keeping the
 * {@link operation}/{@link param} context on top.
 * @throws {@link CCTParamsInvalidError} if `value` is not a valid address
 */
export function validateAddress(
  operation: string,
  param: string,
  value: unknown,
): asserts value is string {
  if (typeof value === 'string' && isAddress(value)) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be a valid address, got ${String(value)}`,
    {
      cause: new CCIPAddressInvalidError(String(value), ChainFamily.EVM),
    },
  )
}

/**
 * Asserts `value` is a valid, non-zero EVM address.
 * @remarks Normalises with `getAddress` first: a literal `=== ZeroAddress` misses the ICAP
 * spelling, and a tx to `0x0` hits no code, so it mines as a successful no-op.
 * @throws {@link CCTParamsInvalidError} if `value` is not a valid address, or is the zero address
 */
export function validateNonZeroAddress(operation: string, param: string, value: unknown): void {
  validateAddress(operation, param, value)
  if (getAddress(value) === ZeroAddress)
    throw new CCTParamsInvalidError(operation, param, 'must not be the zero address')
}

/**
 * Asserts `value` is a non-empty (non-blank) string.
 * @throws {@link CCTParamsInvalidError} if `value` is not a non-empty string
 */
export function validateNonEmptyString(operation: string, param: string, value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be a non-empty string, got ${String(value)}`,
  )
}

/**
 * Asserts `value` is a boolean, narrowing it for callers.
 * @throws {@link CCTParamsInvalidError} if `value` is not a boolean
 */
export function validateBoolean(
  operation: string,
  param: string,
  value: unknown,
): asserts value is boolean {
  if (typeof value !== 'boolean')
    throw new CCTParamsInvalidError(operation, param, 'must be a boolean')
}

/**
 * Asserts `value` is an integer in `[0, 255]` (a Solidity `uint8`).
 * @throws {@link CCTParamsInvalidError} if `value` is not such an integer
 */
export function validateUint8(operation: string, param: string, value: unknown): void {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be an integer in [0, 255], got ${String(value)}`,
  )
}

/**
 * Asserts `value` is an integer in `[0, 2^32 − 1]` (a Solidity `uint32`).
 * @throws {@link CCTParamsInvalidError} if `value` is not such an integer
 */
export function validateUint32(operation: string, param: string, value: unknown): void {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
    return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be an integer in [0, 2^32 − 1], got ${String(value)}`,
  )
}

/**
 * Shared `uintN` range check: the three widths below differ only in their bound and their message,
 * so the comparison itself lives here once.
 * @throws {@link CCTParamsInvalidError} if `value` is not a `bigint` in `[0, 2^bits − 1]`
 */
function assertUintBits(operation: string, param: string, value: unknown, bits: number): void {
  if (typeof value === 'bigint' && value >= 0n && value <= (1n << BigInt(bits)) - 1n) return
  throw new CCTParamsInvalidError(
    operation,
    param,
    `must be a bigint in [0, 2^${bits} − 1], got ${String(value)}`,
  )
}

/**
 * Asserts `value` is a `bigint` in `[0, 2^256 − 1]` (a Solidity `uint256`).
 * @throws {@link CCTParamsInvalidError} if `value` is not such a bigint
 */
export function validateUint256(operation: string, param: string, value: unknown): void {
  assertUintBits(operation, param, value, 256)
}

/**
 * Asserts `value` is a `bigint` in `[1, 2^256 − 1]` — a Solidity `uint256` that must move
 * something. The amount guard for the liquidity ops, whose zero case is either a revert
 * (`LiquidityAmountCannotBeZero` on a siloed pool) or a transfer of nothing. Mirrors Solana's
 * `validateBigInt(..., 1n, U64_MAX)`.
 * @throws {@link CCTParamsInvalidError} if `value` is not such a bigint
 */
export function validatePositiveUint256(operation: string, param: string, value: unknown): void {
  validateUint256(operation, param, value)
  if (value === 0n) throw new CCTParamsInvalidError(operation, param, 'must be greater than zero')
}

/**
 * Asserts `value` is a `bigint` in `[0, 2^128 − 1]` (a Solidity `uint128`), narrowing it to
 * `bigint` for callers.
 * @throws {@link CCTParamsInvalidError} if `value` is not such a bigint
 */
export function validateUint128(
  operation: string,
  param: string,
  value: unknown,
): asserts value is bigint {
  assertUintBits(operation, param, value, 128)
}

/**
 * Asserts `value` is a `bigint` in `[0, 2^64 − 1]` (a Solidity `uint64`), narrowing it to `bigint`
 * for callers. The width of a CCIP chain selector, so every `remoteChainSelector` goes through it.
 * @throws {@link CCTParamsInvalidError} if `value` is not such a bigint
 */
export function validateUint64(
  operation: string,
  param: string,
  value: unknown,
): asserts value is bigint {
  assertUintBits(operation, param, value, 64)
}

/**
 * Parses `value` as a plain object, returned as an indexable record so a caller can validate
 * fields one by one before the value has a type. `kind` names the shape in the failure message,
 * e.g. `'chain update'` → `must be a chain update`.
 * @remarks Arrays and class instances (`Date`, `Map`, …) are objects too, but are not valid
 * here: an array would pass field checks only by accident of key naming, and an instance's
 * fields live on the prototype, not the record.
 * @throws {@link CCTParamsInvalidError} if `value` is not a non-null, non-array plain object
 */
export function parseRecord(
  operation: string,
  param: string,
  value: unknown,
  kind: string,
): { [k: string]: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CCTParamsInvalidError(operation, param, `must be a ${kind}`)
  }
  return value as { [k: string]: unknown }
}

/**
 * Asserts `value` is a dense array of at least `minLength` entries, narrowing it for callers.
 * @remarks Holes are rejected explicitly: `forEach`/`map` skip them, so a sparse array would walk
 * past every element check and reach ABI encoding as `null` (blamed as e.g. `chainsToAdd[1]`).
 * @throws {@link CCTParamsInvalidError} if `value` is not an array, is shorter than `minLength`,
 * or is sparse
 */
export function validateArray(
  operation: string,
  param: string,
  value: unknown,
  minLength = 0,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < minLength)
    throw new CCTParamsInvalidError(
      operation,
      param,
      minLength > 0 ? `must be a non-empty array` : 'must be an array',
    )
  for (let i = 0; i < value.length; i++)
    if (!(i in value))
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must not be a hole — the array is sparse, and a missing element cannot be encoded',
      )
}
