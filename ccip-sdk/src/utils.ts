import { Buffer } from 'buffer'

import {
  type BigNumberish,
  type BytesLike,
  type Numeric,
  decodeBase64,
  getBytes,
  isBytesLike,
  toBeArray,
  toBigInt,
} from 'ethers'
import yaml from 'yaml'

// Re-export the codec helpers moved to ./shared/codec.ts (kept here for back-compat;
// they are pure leaf utilities used by the errors/ tree without creating a cycle).
export {
  encodeAddressToAny,
  getAddressBytes,
  hashedUtf8Hex,
  isCantonPartyId,
  jsonStringify,
  normalizeHex,
  util,
} from './shared/codec.ts'
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
import { util } from './shared/codec.ts'
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
 * Reads the source decimals a source pool declares in its `destPoolData`/`extraData`.
 * Deliberately narrower than `TokenPool._parseRemoteDecimals`, which reverts on a non-empty
 * non-32-byte payload and accepts any `uint8`: pools that override it (USDC/CCTP, Lombard) put
 * their own payloads here, so only a 32-byte word in the plausible `0..36` range is read as a
 * declaration.
 * @param extraData - The transfer's `extraData`/`destPoolData`.
 * @returns Declared source decimals, or `undefined` when the amount is already in local decimals.
 */
export function getSourceDecimalsFromExtraData(extraData?: string): number | undefined {
  if (!extraData) return undefined
  try {
    const bytes = getDataBytes(extraData)
    if (bytes.length !== 32) return undefined
    const decimals = toBigInt(bytes)
    // 0 is a legal declaration — 0-decimal tokens exist
    return 0n <= decimals && decimals <= 36n ? Number(decimals) : undefined
  } catch {
    return undefined
  }
}

/**
 * Rescales `amount` from one token's decimals to another's, truncating like the pools do.
 * @param amount - Amount in `fromDecimals` units.
 * @param fromDecimals - Decimals `amount` is denominated in.
 * @param toDecimals - Decimals to convert to.
 * @returns `amount` in `toDecimals` units.
 */
export function scaleDecimals(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return amount
  return (amount * BigInt(10) ** BigInt(toDecimals)) / BigInt(10) ** BigInt(fromDecimals)
}

/**
 * Whether a `typeAndVersion` string's version is below `minVersion`.
 * @param typeAndVersion - E.g. `'LockReleaseTokenPool 1.6.0'`; an unparseable one reads as not-below.
 * @param minVersion - Exclusive lower bound, e.g. `'1.6.1'`.
 * @returns True only when the parsed version is strictly below `minVersion`.
 */
export function isVersionBelow(typeAndVersion: string | undefined, minVersion: string): boolean {
  const found = typeAndVersion?.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!found) return false
  const bounds = minVersion.split('.')
  for (const [i, bound] of bounds.entries()) {
    const part = Number(found[i + 1])
    if (part !== Number(bound)) return part < Number(bound)
  }
  return false
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
  if (mapValues) {
    const res = mapValues(obj, key)
    if (res !== obj) return res
  }
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
export const sleep = (ms: number, abort?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (abort?.aborted || !ms) return resolve()
    let timeout = AbortSignal.timeout(Math.ceil(ms))
    if (abort) timeout = AbortSignal.any([abort, timeout])
    const onAbort = () => {
      timeout.removeEventListener('abort', onAbort)
      resolve()
    }
    timeout.addEventListener('abort', onAbort, { once: true })
  })

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
export async function signalToPromise(signal: AbortSignal): Promise<never> {
  signal.throwIfAborted()
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
  })
}
