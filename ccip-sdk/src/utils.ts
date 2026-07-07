import { Buffer } from 'buffer'

import bs58 from 'bs58'
import {
  type BigNumberish,
  type BytesLike,
  type Numeric,
  decodeBase64,
  getBytes,
  id as keccak256Utf8,
  isBytesLike,
  toBeArray,
  toBigInt,
} from 'ethers'
import yaml from 'yaml'

import type { Chain, ChainStatic } from './chain.ts'
import {
  CCIPBlockBeforeTimestampNotFoundError,
  CCIPChainFamilyUnsupportedError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPTypeVersionInvalidError,
} from './errors/index.ts'
import { getRetryDelay, shouldRetry } from './errors/utils.ts'
import { ChainFamily } from './networks.ts'
import { supportedChains } from './supported-chains.ts'
import type { WithLogger } from './types.ts'

/**
 * Returns *some* block number with timestamp prior to `timestamp`
 *
 * @param getBlockTimestamp - function to get block timestamp
 * @param recentBlockNumber - a block guaranteed to be after `timestamp` (e.g. latest)
 * @param timestamp - target timestamp
 * @param precision - returned blockNumber should be within this many blocks before timestamp
 * @returns blockNumber of a block at provider which is close but before target timestamp
 * @throws {@link CCIPBlockBeforeTimestampNotFoundError} if no block exists before the given timestamp
 */
export async function getSomeBlockNumberBefore(
  getBlockTimestamp: (blockNumber: number) => Promise<number>,
  recentBlockNumber: number,
  timestamp: number,
  { precision = 10, logger = console }: { precision?: number } & WithLogger = {},
): Promise<number> {
  timestamp = Number(timestamp)
  const recentTimestamp = await getBlockTimestamp(recentBlockNumber)
  if (recentTimestamp <= timestamp) return recentBlockNumber

  let beforeBlockNumber = Math.max(1, recentBlockNumber - precision * 1000)
  let beforeTimestamp = await getBlockTimestamp(beforeBlockNumber)

  let estimatedBlockTime =
      (recentTimestamp - beforeTimestamp) / (recentBlockNumber - beforeBlockNumber),
    afterBlockNumber = recentBlockNumber,
    afterTimestamp = recentTimestamp

  // first, go back looking for a block prior to our target timestamp
  for (let iter = 0; beforeBlockNumber > 1 && beforeTimestamp > timestamp; iter++) {
    afterBlockNumber = beforeBlockNumber
    afterTimestamp = beforeTimestamp
    beforeBlockNumber = Math.max(
      1,
      Math.trunc(beforeBlockNumber - (beforeTimestamp - timestamp) / estimatedBlockTime) -
        10 ** iter,
    )
    beforeTimestamp = await getBlockTimestamp(beforeBlockNumber)
    estimatedBlockTime =
      (recentTimestamp - beforeTimestamp) / (recentBlockNumber - beforeBlockNumber)
  }

  if (beforeTimestamp > timestamp) {
    throw new CCIPBlockBeforeTimestampNotFoundError(timestamp)
  }

  // now, bin-search based on timestamp proportions, looking for
  // a block at most N estimated blockTimes from our target timestamp
  while (timestamp - beforeTimestamp >= 1 && afterBlockNumber - beforeBlockNumber > precision) {
    const prop = (timestamp - beforeTimestamp) / (afterTimestamp - beforeTimestamp)
    const delta =
      prop > 0.5
        ? Math.floor(prop * (afterBlockNumber - beforeBlockNumber))
        : Math.ceil(prop * (afterBlockNumber - beforeBlockNumber))
    let pivot = beforeBlockNumber + delta
    if (pivot === afterBlockNumber) {
      pivot--
    }
    const pivotTimestamp = await getBlockTimestamp(pivot)
    if (pivotTimestamp > timestamp) {
      afterBlockNumber = pivot
      afterTimestamp = pivotTimestamp
    } else {
      beforeBlockNumber = pivot
      beforeTimestamp = pivotTimestamp
    }
    logger.debug('getSomeBlockNumberBefore: searching block before', {
      beforeBlockNumber,
      beforeTimestamp,
      pivot,
      pivotTimestamp,
      afterBlockNumber,
      afterTimestamp,
      estimatedBlockTime,
      timestamp,
      diffNumber: afterBlockNumber - beforeBlockNumber,
    })
  }
  return beforeBlockNumber
}

const BLOCK_RANGE = 10_000
/**
 * Generates block ranges for paginated log queries.
 *
 * @param params - Range parameters:
 *   - `singleBlock` - yields a single `{ fromBlock, toBlock }` for that block.
 *   - `startBlock` + `endBlock` - moves forward from `startBlock` up to `endBlock`.
 *   - `page` - step size per range (default 10 000).
 * @returns Generator of `{ fromBlock, toBlock }` pairs, optionally with a `progress` percentage
 *   string when iterating forward.
 */
export function* blockRangeGenerator(
  params: { page?: number } & ({ endBlock: number; startBlock: number } | { singleBlock: number }),
) {
  const stepSize = params.page ?? BLOCK_RANGE
  if ('singleBlock' in params) {
    yield { fromBlock: params.singleBlock, toBlock: params.singleBlock }
  } else {
    for (let fromBlock = params.startBlock; fromBlock <= params.endBlock; fromBlock += stepSize) {
      yield {
        fromBlock,
        toBlock: Math.min(params.endBlock, fromBlock + stepSize - 1),
        progress: `${Math.trunc(((fromBlock - params.startBlock) / Math.max(params.endBlock - params.startBlock, 1)) * 10000) / 100}%`,
      }
    }
  }
}

function createUncircularReplacer() {
  const holderStack: object[] = []
  const ancestorStack: object[] = []
  const originals = new WeakMap<object, object>()

  const uncircularReplacer = function (this: unknown, _key: string, value: unknown) {
    // bigints pass through untouched; serialization to bare JSON numbers is
    // handled by stringifyExtended below.
    const replaced = value
    if (typeof replaced !== 'object' || replaced === null) return replaced

    while (holderStack.length > 0 && holderStack.at(-1) !== this) {
      holderStack.pop()
      ancestorStack.pop()
    }

    if (ancestorStack.includes(replaced)) return undefined

    let returned = replaced
    if (Array.isArray(replaced)) {
      const filtered = replaced.filter(
        (item) =>
          typeof item !== 'object' ||
          item === null ||
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          (item !== replaced && !ancestorStack.includes(originals.get(item) ?? item)),
      )
      if (filtered.length !== replaced.length) {
        originals.set(filtered, replaced)
        returned = filtered
      }
    }

    holderStack.push(returned)
    ancestorStack.push(replaced)
    return returned
  }
  return uncircularReplacer
}

// Private-use sentinel: JSON.stringify can't emit a bigint, so bigints are first
// tagged as a string, then the quotes+tag are stripped to leave a bare JSON
// number.  is in the Unicode private-use area and is left unescaped by
// JSON.stringify, so it never collides with real (hex/decimal) string data.
const INT_TAG = 'int:'
const INT_TAG_RE = new RegExp(`"${INT_TAG}(-?\\d+(?:.0)?)"`, 'g')

/**
 * JSON.stringify that drops circular references (via createUncircularReplacer)
 * and serializes bigints as bare JSON numbers, preserving full precision so a
 * uint64/uint256 survives the round-trip to Go without becoming a decimal string.
 * plain `number` integers are also tagged with `.0` suffix, to differentiate them from `bigint`s.
 * @example
 * ```typescript
 * jsonStringify({ a: 1n, b: 2, c: { d: 3n } }) // '{"a":1,"b":2.0,"c":{"d":3}}'
 * yaml.parse('{"a":1,"b":2.0,"c":{"d":3}}', { intAsBigInt: true }) // { a: 1n, b: 2, c: { d: 3n } }
 * ```
 */
export function jsonStringify(value: unknown, space?: string | number): string {
  const uncircular = createUncircularReplacer()
  const json = JSON.stringify(
    value,
    function (this: unknown, key: string, val: unknown) {
      const replaced = uncircular.call(this, key, val)
      return typeof replaced === 'bigint'
        ? INT_TAG + replaced.toString()
        : typeof replaced === 'number' && Number.isSafeInteger(replaced)
          ? INT_TAG + replaced.toString() + '.0' // use .0 suffix to distinguish plain numbers
          : replaced
    },
    space,
  )
  // JSON.stringify is typed `string` but returns undefined for undefined input.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return json === undefined ? json : json.replace(INT_TAG_RE, '$1')
}

/**
 * Parses JSON text with BigInt support for large integers.
 * Uses yaml parser which handles integers as BigInt when they exceed safe integer range.
 * @param text - JSON string to parse
 * @returns Parsed object with large integers as BigInt
 */
export function jsonParse<T = unknown>(text: string): T {
  // `.0`-suffixed integers are parsed as numbers; bare integers are parsed as bigints.
  return yaml.parse(text, { intAsBigInt: true }) as T
}

/**
 * Decode address from a 32-byte hex string.
 *
 * @param address - Address bytes to decode (hex string or Uint8Array)
 * @param family - Chain family for address format (defaults to EVM)
 * @returns Decoded address string
 * @throws {@link CCIPChainFamilyUnsupportedError} if chain family is not supported
 *
 * @example
 * ```typescript
 * import { decodeAddress, ChainFamily } from '@chainlink/ccip-sdk'
 *
 * // Decode EVM address from 32-byte hex
 * const evmAddr = decodeAddress('0x000000000000000000000000abc123...', ChainFamily.EVM)
 * console.log(evmAddr) // '0xABC123...'
 *
 * // Decode Solana address
 * const solAddr = decodeAddress(bytes, ChainFamily.Solana)
 * console.log(solAddr) // Base58 encoded address
 * ```
 */
export function decodeAddress(address: BytesLike, family: ChainFamily = ChainFamily.EVM): string {
  const chain = supportedChains[family]
  if (!chain) throw new CCIPChainFamilyUnsupportedError(family)
  return chain.getAddress(address)
}

/**
 * Validate a value is a txHash string in some supported chain family
 * @param txHash - Value to check
 * @param family - Optional chain family to validate against
 * @returns true if value is a valid transaction hash
 * @throws {@link CCIPChainFamilyUnsupportedError} if specified chain family is not supported
 */
export function isSupportedTxHash(txHash: unknown, family?: ChainFamily): txHash is string {
  let chains: ChainStatic[]
  if (!family) chains = Object.values(supportedChains)
  else if (family in supportedChains) chains = [supportedChains[family]!]
  else throw new CCIPChainFamilyUnsupportedError(family)
  for (const C of chains) {
    try {
      if (C.isTxHash(txHash)) return true
    } catch (_) {
      // continue
    }
  }
  return false
}

/**
 * Version of decodeAddress which is aware of custom cross-chain OnRamp formats
 **/
export function decodeOnRampAddress(
  address: BytesLike,
  family: ChainFamily = ChainFamily.EVM,
): string {
  let decoded = decodeAddress(address, family)
  if ((family === ChainFamily.Aptos || family === ChainFamily.Sui) && !decoded.includes('::'))
    decoded += '::onramp'
  return decoded
}

/**
 * Converts little-endian bytes to BigInt.
 * @param data - Little-endian byte data.
 * @returns BigInt value.
 */
export function leToBigInt(data: BytesLike | readonly number[]): bigint {
  if (Array.isArray(data)) data = new Uint8Array(data)
  return toBigInt(getBytes(data as BytesLike).reverse())
}

/**
 * Converts a BigNumber to little-endian byte array.
 * @param value - Numeric value to convert.
 * @param width - Optional byte width for padding.
 * @returns Little-endian Uint8Array.
 */
export function toLeArray(value: BigNumberish, width?: Numeric): Uint8Array {
  return toBeArray(value, width).reverse()
}
/**
 * Checks if the given data is a valid Base64 encoded string.
 * @param data - Data to check.
 * @returns True if valid Base64 string.
 */
export function isBase64(data: unknown): data is string {
  return (
    typeof data === 'string' &&
    /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/.test(data)
  )
}

/**
 * Converts various data formats to Uint8Array.
 * @param data - Bytes, number array, or Base64 string.
 * @returns Uint8Array representation.
 * @throws {@link CCIPDataFormatUnsupportedError} if data format is not recognized
 *
 * @example
 * ```typescript
 * import { getDataBytes } from '@chainlink/ccip-sdk'
 *
 * // From hex string
 * const bytes1 = getDataBytes('0x1234abcd')
 *
 * // From number array
 * const bytes2 = getDataBytes([0x12, 0x34, 0xab, 0xcd])
 *
 * // From Base64
 * const bytes3 = getDataBytes('EjSrzQ==')
 * ```
 */
export function getDataBytes(data: BytesLike | readonly number[]): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(data)
  if (data === '') return new Uint8Array(0)
  if (typeof data === 'string' && data.match(/^[0-9a-f]+[a-f][0-9a-f]+$/i)) data = '0x' + data
  else if (typeof data === 'string' && data.match(/^0X[0-9a-fA-F]+$/)) data = data.toLowerCase()
  if (typeof data === 'string' && data.startsWith('0x') && data.length % 2)
    data = '0x0' + data.slice(2)
  if (isBytesLike(data)) {
    return getBytes(data)
  } else if (isBase64(data)) {
    return decodeBase64(data)
  } else {
    throw new CCIPDataFormatUnsupportedError(util.inspect(data))
  }
}

/**
 * Converts bytes to a Node.js Buffer.
 * @param bytes - Bytes to convert (hex string, Uint8Array, Base64, etc).
 * @returns Node.js Buffer.
 */
export function bytesToBuffer(bytes: BytesLike | readonly number[]): Buffer {
  return Buffer.from(getDataBytes(bytes))
}

/**
 * Extracts address bytes, handling both hex and Base58 formats.
 * @param address - Address in hex or Base58 format.
 * @returns Address bytes as Uint8Array.
 */
export function getAddressBytes(address: BytesLike | readonly number[]): Uint8Array {
  let bytes
  if (address instanceof Uint8Array) {
    bytes = address
  } else if (Array.isArray(address)) {
    bytes = new Uint8Array(address)
  } else if (
    typeof address === 'string' &&
    address.match(/^((0x[0-9a-f]*)|[0-9a-f]{40,})(::.*)?$/i)
  ) {
    address = address.split('::')[0]! // discard possible Aptos/Sui module suffix
    // supports with or without (long>=20B) 0x-prefix, odd or even length
    bytes = getBytes(
      address.length % 2
        ? '0x0' + (address.toLowerCase().startsWith('0x') ? address.slice(2) : address)
        : !address.toLowerCase().startsWith('0x')
          ? '0x' + address
          : address,
    )
  } else if (typeof address === 'string' && isCantonPartyId(address)) {
    // Canton CCIP receivers use keccak256(partyId) as a 32-byte address (see HashedPartyFromString in chainlink-canton).
    bytes = getBytes(`0x${hashedUtf8Hex(address)}`)
  } else if (typeof address === 'string' && /^-?\d+:[0-9a-f]{64}$/i.test(address)) {
    // TON raw format: "workchain:hash" → 36-byte CCIP format (4-byte BE workchain + 32-byte hash)
    const [workchain, hash] = address.split(':')
    const buf = new Uint8Array(36)
    const view = new DataView(buf.buffer)
    view.setInt32(0, parseInt(workchain!, 10), false) // big-endian
    buf.set(getBytes('0x' + hash), 4)
    bytes = buf
  } else {
    try {
      const bytes_ = bs58.decode(address as string)
      if (bytes_.length % 32 === 0) bytes = bytes_
    } catch (_) {
      // pass
    }
    if (!bytes) bytes = decodeBase64(address as string)
  }
  return bytes
}

/** Strip optional `0x` prefix and lowercase for stable hex string comparison. */
export function normalizeHex(value: string): string {
  const trimmed = value.trim()
  return (trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed).toLowerCase()
}

/** keccak256(utf8 string) as normalized hex (no `0x`). Used for Canton party / InstanceAddress hashes. */
export function hashedUtf8Hex(value: string): string {
  return normalizeHex(keccak256Utf8(value))
}

/** Daml party ID: `hint::1220<64-hex-fingerprint>` (not a 3-part instrument id). */
export function isCantonPartyId(address: string): boolean {
  return /^[\w.-]+::1220[0-9a-fA-F]{64}$/.test(address)
}

/**
 * Encodes remote/alien addresses for Any SRC
 *
 * Addresses less than 32 bytes (EVM 20B, Aptos/Solana/Sui 32B) are zero-padded to 32 bytes
 * Addresses greater than 32 bytes (e.g., TON 4+32=36B) are used as raw bytes without padding
 */
export function encodeAddressToAny(address: BytesLike): Buffer {
  const bytes = getAddressBytes(address)
  return bytes.length < 32
    ? Buffer.concat([Buffer.alloc(32 - bytes.length), Buffer.from(bytes)]) // pad to 32 bytes
    : Buffer.from(bytes)
}

/**
 * Converts snake_case strings to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase())
}

/**
 * Recursively converts all snake_case keys in an object to camelCase
 * Only converts keys that actually have snake_case format
 */
export function convertKeysToCamelCase(
  obj: unknown,
  mapValues?: (value: unknown, key?: string) => unknown,
  key?: string,
): unknown {
  if (Array.isArray(obj) && obj.length && obj.every((v) => typeof v === 'number')) {
    return mapValues ? mapValues(obj, key) : obj
  } else if (Array.isArray(obj)) {
    return obj.map((v) => convertKeysToCamelCase(v, mapValues, key))
  }

  if (obj == null) return obj
  if (
    typeof obj !== 'object' ||
    !(Object.getPrototypeOf(obj) == null || Object.getPrototypeOf(obj) === Object.prototype)
  )
    return mapValues ? mapValues(obj, key) : obj

  const record = obj as Record<string, unknown>
  const converted: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(record)) {
    const camelKey = snakeToCamel(name)
    converted[camelKey] = convertKeysToCamelCase(value, mapValues, camelKey)
  }
  return converted
}

/**
 * Promise-based sleep utility.
 * @param ms - Duration in milliseconds.
 * @returns Promise that resolves after the specified duration.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unref is Node.js-only; browsers return number
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref?.())

/**
 * Configuration for the withRetry utility.
 */
export type WithRetryConfig = {
  /** Maximum number of retry attempts */
  maxAttempts?: number
  /** Initial delay in milliseconds before the first retry */
  initialDelayMs?: number
  /** Multiplier applied to delay after each retry */
  backoffMultiplier?: number
  /** Maximum delay in milliseconds between retries */
  maxDelayMs?: number
  /** Whether to respect the error's retryAfterMs hint */
  respectRetryAfterHint?: boolean
  /** Optional logger for retry attempts */
  logger?: { debug: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }
}

/**
 * Executes an async operation with retry logic and exponential backoff.
 * Only retries on transient errors (as determined by shouldRetry from errors/utils).
 *
 * @param operation - Async function to execute
 * @param config - Retry configuration
 * @returns Promise resolving to the operation result
 * @throws The last error encountered after all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => apiClient.getMessageById(id),
 *   {
 *     maxRetries: 3,
 *     initialDelayMs: 1000,
 *     backoffMultiplier: 2,
 *     maxDelayMs: 30000,
 *     respectRetryAfterHint: true,
 *   }
 * )
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: WithRetryConfig,
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelayMs = 1e3,
    backoffMultiplier = 2,
    maxDelayMs = 30e3,
    respectRetryAfterHint = true,
    logger = console,
  } = config

  let lastError: CCIPError | undefined
  let delay = initialDelayMs

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (err) {
      lastError = CCIPError.isCCIPError(err) ? err : CCIPError.from(err, 'UNKNOWN')

      // Only retry on transient errors
      if (!shouldRetry(lastError)) {
        throw lastError
      }

      // Don't sleep after the last attempt
      if (attempt >= maxAttempts) {
        logger.warn(`All ${maxAttempts} retries exhausted:`, lastError.message)
        break
      }

      // Calculate delay for next retry
      let nextDelay = delay

      // Respect error's retryAfterMs hint if configured
      if (respectRetryAfterHint) {
        const hintDelay = getRetryDelay(lastError)
        if (hintDelay !== null) {
          nextDelay = Math.max(delay, hintDelay)
        }
      }

      // Cap at maxDelayMs
      nextDelay = Math.min(nextDelay, maxDelayMs)

      logger.debug(
        `Retry attempt ${attempt + 1}/${maxAttempts} after ${nextDelay}ms:`,
        lastError.message,
      )

      await sleep(nextDelay)

      // Apply exponential backoff for next iteration
      delay = Math.min(delay * backoffMultiplier, maxDelayMs)
    }
  }

  throw lastError!
}

/**
 * Parses a typeAndVersion string into its components.
 * @param typeAndVersion - String in format "TypeName vX.Y.Z".
 * @returns Tuple of `[normalizedType, normalizedVersion, original, suffix?]` where
 *   `normalizedType` has kebab-to-PascalCase, `CCIP` uppercasing, and ramp casing applied
 *   (e.g., `"ccip-offramp"` becomes `"CCIPOffRamp"`), and `normalizedVersion` has the patch
 *   component forced to `.0` for core contracts (OnRamp, OffRamp, Router).
 * @throws {@link CCIPTypeVersionInvalidError} if string format is invalid
 */
export function parseTypeAndVersion(
  typeAndVersion: string,
): Awaited<ReturnType<Chain['typeAndVersion']>> {
  const match = typeAndVersion.match(/^(\w.+\S)\s+v?(\d+\.\d+(?:\.[x\d]+)?)([^\d.].*)?$/)
  if (!match) throw new CCIPTypeVersionInvalidError(typeAndVersion)
  // some string normalization
  const type = match[1]!
    .replaceAll(/-(\w)/g, (_, w: string) => w.toUpperCase()) // kebabToPascal
    .replace(/ccip/gi, 'CCIP')
    .replace(
      /(o)(n|ff)(ramp)\b/gi,
      (_, o: string, n: string, ramp: string) =>
        `${o.toUpperCase()}${n.toLowerCase()}${ramp.charAt(0).toUpperCase()}${ramp.slice(1).toLowerCase()}`,
    ) // ccipOfframp -> CCIPOffRamp
    .replace('router', 'Router') // ccip-router -> CCIPRouter

  let version = match[2]!
  // for core contracts, always use patch `.0`, to match CCIPVersion
  if (type.match(/((o(n|ff)ramp)|router)\b/gi))
    version = version.replace(/^(\d+\.\d+)(?:\.\d+)?$/, '$1.0')

  if (!match[3]) return [type, version, typeAndVersion]
  else return [type, version, typeAndVersion, match[3]]
}

// Re-export for backward compatibility (symbols moved to fetch.ts)
export { createRateLimitedFetch, fetchWithTimeout } from './fetch.ts'

// barebones `node:util` backfill, if needed
const util =
  'util' in globalThis
    ? (
        globalThis as unknown as {
          util: {
            inspect: ((v: unknown) => string) & {
              custom: symbol
              defaultOptions: Record<string, unknown>
            }
          }
        }
      ).util
    : {
        inspect: Object.assign((v: unknown) => JSON.stringify(v), {
          custom: Symbol('custom'),
          defaultOptions: { depth: 2 },
        }),
      }
export { util }

/**
 * Converts an AbortSignal into a Promise that rejects when the signal is aborted.
 *
 * The listener closure captures `reject` strongly and is held alive by the
 * signal, so the promise cannot be GC'd while the signal is alive. The
 * `once` option ensures the listener (and its reference to `reject`) is
 * released as soon as the signal fires.
 *
 * @param signal - AbortSignal to convert
 * @returns Promise that rejects with the signal's reason when aborted
 */
export function signalToPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason as Error)

  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
  })
}
