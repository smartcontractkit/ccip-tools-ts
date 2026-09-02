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
 * Asserts `value` is a `bigint` in `[0, 2^128 − 1]` (a Solidity `uint128`), narrowing it to
 * `bigint` for callers — where {@link validateUint256} returns `void`, because callers that
 * default an omitted amount to `0n` hold a `bigint | undefined` this has to resolve.
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
 * Parses an optionally `0x`-prefixed hex string of whole, non-empty bytes into the 0x-prefixed
 * lower-case form ethers encodes as `bytes`.
 * @remarks No byte cap, unlike Solana's counterpart: the values this guards are *remote* addresses
 * carried as `bytes`, and a remote may be Solana or Aptos (32 bytes) as easily as EVM (20), so a
 * length ceiling would only reject valid remotes.
 * @returns The value as `0x`-prefixed lower-case hex.
 * @throws {@link CCTParamsInvalidError} if `value` is not a non-empty whole-byte hex string
 */
export function parseHexBytes(operation: string, param: string, value: unknown): string {
  const hex = typeof value === 'string' ? value.replace(/^0x/i, '').toLowerCase() : ''
  if (typeof value !== 'string' || !/^(?:[\da-f]{2})+$/.test(hex)) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a non-empty hex string of whole bytes, got ${String(value)}`,
    )
  }
  return `0x${hex}`
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

/**
 * Parses a non-empty list of `bytes` values into 0x-prefixed lower-case hex, rejecting duplicates.
 * @remarks Duplicates are compared *after* {@link parseHexBytes} normalisation, so `0xAB` and `ab`
 * collide the way a Solidity `bytes` set would.
 * @returns The values as 0x-prefixed lower-case hex, in input order.
 * @throws {@link CCTParamsInvalidError} if the list is empty, not an array, sparse, or holds an
 * invalid or duplicate value
 */
export function parseUniqueHexBytesArray(
  operation: string,
  param: string,
  value: unknown,
): string[] {
  validateArray(operation, param, value, 1)
  const seen = new Set<string>()
  return value.map((entry, i) => {
    const hex = parseHexBytes(operation, `${param}[${i}]`, entry)
    if (seen.has(hex)) {
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must not duplicate an earlier entry in the same array',
      )
    }
    seen.add(hex)
    return hex
  })
}
