import { Buffer } from 'buffer'

import bs58 from 'bs58'
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
import { memoize } from 'micro-memoize'
import yaml from 'yaml'

import type { Chain, ChainStatic } from './chain.ts'
import {
  CCIPBlockBeforeTimestampNotFoundError,
  CCIPChainFamilyUnsupportedError,
  CCIPChainNotFoundError,
  CCIPDataFormatUnsupportedError,
  CCIPError,
  CCIPHttpError,
  CCIPTypeVersionInvalidError,
  HttpStatus,
} from './errors/index.ts'
import { getRetryDelay, shouldRetry } from './errors/utils.ts'
import SELECTORS from './selectors.ts'
import { supportedChains } from './supported-chains.ts'
import { type NetworkInfo, type WithLogger, ChainFamily } from './types.ts'

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
  let beforeBlockNumber = Math.max(1, recentBlockNumber - precision * 1000)
  let beforeTimestamp = await getBlockTimestamp(beforeBlockNumber)

  const now = Math.trunc(Date.now() / 1000)
  let estimatedBlockTime = (now - beforeTimestamp) / (recentBlockNumber - beforeBlockNumber),
    afterBlockNumber = recentBlockNumber,
    afterTimestamp = now

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
    estimatedBlockTime = (now - beforeTimestamp) / (recentBlockNumber - beforeBlockNumber)
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

/**
 * Converts a chain ID to complete NetworkInfo.
 * Memoized to return the same object reference for a given chainId.
 */
const networkInfoFromChainId = memoize((chainId: NetworkInfo['chainId']): NetworkInfo => {
  const sel = SELECTORS[chainId]
  if (!sel?.name) throw new CCIPChainNotFoundError(chainId)
  return {
    chainId: isNaN(+chainId) ? chainId : +chainId,
    chainSelector: sel.selector,
    name: sel.name,
    family: sel.family,
    networkType: sel.network_type,
  } as NetworkInfo
})

/**
 * Converts a chain selector, chain ID, or chain name to complete network information
 *
 * @param selectorOrIdOrName - Can be:
 *   - Chain selector as bigint or numeric string
 *   - Chain ID as number, bigint or string (EVM: "1", Aptos: "aptos:1", Solana: genesisHash)
 *   - Chain name as string ("ethereum-mainnet")
 * @returns Complete NetworkInfo object
 * @throws {@link CCIPChainNotFoundError} if chain is not found
 *
 * @example
 * ```typescript
 * import { networkInfo } from '@chainlink/ccip-sdk'
 *
 * // By chain name
 * const sepolia = networkInfo('ethereum-testnet-sepolia')
 * console.log('Selector:', sepolia.chainSelector)
 *
 * // By chain selector
 * const fuji = networkInfo(14767482510784806043n)
 * console.log('Name:', fuji.name) // 'avalanche-testnet-fuji'
 *
 * // By chain ID
 * const mainnet = networkInfo(1)
 * console.log('Family:', mainnet.family) // 'EVM'
 * ```
 */
export const networkInfo = memoize(function networkInfo_(
  selectorOrIdOrName: bigint | number | string,
): NetworkInfo {
  let chainId, match
  if (typeof selectorOrIdOrName === 'number') {
    chainId = selectorOrIdOrName
  } else if (
    typeof selectorOrIdOrName === 'string' &&
    (match = selectorOrIdOrName.match(/^(-?\d+)n?$/))
  ) {
    selectorOrIdOrName = BigInt(match[1]!)
  }
  if (typeof selectorOrIdOrName === 'bigint') {
    // maybe we got a chainId deserialized as bigint
    if (selectorOrIdOrName.toString() in SELECTORS) {
      chainId = Number(selectorOrIdOrName)
    } else {
      for (const id in SELECTORS) {
        if (SELECTORS[id]!.selector === selectorOrIdOrName) {
          chainId = id
          break
        }
      }
      if (!chainId) throw new CCIPChainNotFoundError(selectorOrIdOrName)
    }
  } else if (typeof selectorOrIdOrName === 'string') {
    if (selectorOrIdOrName.includes('-', 1)) {
      for (const id in SELECTORS) {
        if (SELECTORS[id]!.name === selectorOrIdOrName) {
          chainId = id
          break
        }
      }
    }
    chainId ??= selectorOrIdOrName
  }
  return networkInfoFromChainId(chainId as string | number)
})

const BLOCK_RANGE = 10_000
/**
 * Generates exclusive block ranges [fromBlock, toBlock]
 * If startBlock is given, moves forward from there (up to latestBlock),
 * Otherwise, moves backwards down to genesis (you probably want to break/return before that)
 **/
export function* blockRangeGenerator(
  params: { page?: number } & ({ endBlock: number; startBlock?: number } | { singleBlock: number }),
) {
  const stepSize = params.page ?? BLOCK_RANGE
  if ('singleBlock' in params) {
    yield { fromBlock: params.singleBlock, toBlock: params.singleBlock }
  } else if ('startBlock' in params && params.startBlock) {
    for (let fromBlock = params.startBlock; fromBlock < params.endBlock; fromBlock += stepSize) {
      yield {
        fromBlock,
        toBlock: Math.min(params.endBlock, fromBlock + stepSize - 1),
        progress: `${Math.trunc(((fromBlock - params.startBlock) / (params.endBlock - params.startBlock)) * 10000) / 100}%`,
      }
    }
  } else {
    for (let toBlock = params.endBlock; toBlock > 1; toBlock -= stepSize) {
      yield {
        fromBlock: Math.max(1, toBlock - stepSize + 1),
        toBlock,
      }
    }
  }
}

/**
 * JSON replacer function that converts BigInt values to strings.
 * @param _key - Property key (unused).
 * @param value - Value to transform.
 * @returns String representation if BigInt, otherwise unchanged value.
 * @example
 * ```typescript
 * import { bigIntReplacer } from '@chainlink/ccip-sdk'
 *
 * const data = { amount: 1000000000000000000n }
 * const json = JSON.stringify(data, bigIntReplacer)
 * console.log(json) // '{"amount":"1000000000000000000"}'
 * ```
 * @see {@link bigIntReviver} - Revive BigInt values when parsing
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

/**
 * JSON reviver function that converts numeric strings back to BigInt.
 * @param _key - Property key (unused).
 * @param value - Value to transform.
 * @returns BigInt if numeric string, otherwise unchanged value.
 * @example
 * ```typescript
 * import { bigIntReviver } from '@chainlink/ccip-sdk'
 *
 * const json = '{"amount":"1000000000000000000"}'
 * const data = JSON.parse(json, bigIntReviver)
 * console.log(typeof data.amount) // 'bigint'
 * ```
 * @see {@link bigIntReplacer} - Stringify BigInt values
 */
export function bigIntReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }
  return value
}

/**
 * Parses JSON text with BigInt support for large integers.
 * Uses yaml parser which handles integers as BigInt when they exceed safe integer range.
 * @param text - JSON string to parse
 * @returns Parsed object with large integers as BigInt
 */
export function parseJson<T = unknown>(text: string): T {
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
  if (family === ChainFamily.Aptos || family === ChainFamily.Sui) decoded += '::onramp'
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
  if (Array.isArray(obj) && obj.every((v) => typeof v === 'number')) {
    return mapValues ? mapValues(obj, key) : obj
  } else if (Array.isArray(obj)) {
    return obj.map((v) => convertKeysToCamelCase(v, mapValues, key))
  }

  if (obj == null || typeof obj !== 'object') return mapValues ? mapValues(obj, key) : obj

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
  maxRetries: number
  /** Initial delay in milliseconds before the first retry */
  initialDelayMs: number
  /** Multiplier applied to delay after each retry */
  backoffMultiplier: number
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number
  /** Whether to respect the error's retryAfterMs hint */
  respectRetryAfterHint: boolean
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
    maxRetries,
    initialDelayMs,
    backoffMultiplier,
    maxDelayMs,
    respectRetryAfterHint,
    logger,
  } = config

  let lastError: CCIPError | undefined
  let delay = initialDelayMs

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (err) {
      lastError = CCIPError.isCCIPError(err) ? err : CCIPError.from(err, 'UNKNOWN')

      // Only retry on transient errors
      if (!shouldRetry(lastError)) {
        throw lastError
      }

      // Don't sleep after the last attempt
      if (attempt >= maxRetries) {
        logger?.warn(`All ${maxRetries} retries exhausted:`, lastError.message)
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

      logger?.debug(
        `Retry attempt ${attempt + 1}/${maxRetries} after ${nextDelay}ms:`,
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
 * @returns Tuple of [type, version, original, suffix?].
 * @throws {@link CCIPTypeVersionInvalidError} if string format is invalid
 */
export function parseTypeAndVersion(
  typeAndVersion: string,
): Awaited<ReturnType<Chain['typeAndVersion']>> {
  const match = typeAndVersion.match(/^(\w.+\S)\s+v?(\d+\.\d+(?:\.\d+)?)([^\d.].*)?$/)
  if (!match) throw new CCIPTypeVersionInvalidError(typeAndVersion)
  const [, typeRaw, version] = match
  // some string normalization
  const type = typeRaw!
    .replaceAll(/-(\w)/g, (_, w: string) => w.toUpperCase()) // kebabToPascal
    .replace(/ccip/gi, 'CCIP')
    .replace(
      /(o)(n|ff)(ramp)\b/gi,
      (_, o: string, n: string, ramp: string) =>
        `${o.toUpperCase()}${n.toLowerCase()}${ramp.charAt(0).toUpperCase()}${ramp.slice(1).toLowerCase()}`,
    ) // ccipOfframp -> CCIPOffRamp
  if (!match[3]) return [type, version!, typeAndVersion]
  else return [type, version!, typeAndVersion, match[3]]
}

/* eslint-disable jsdoc/require-jsdoc */
type RateLimitOpts = { maxRequests: number; windowMs: number; maxRetries: number }

class RateLimit {
  readonly requestQueue: Array<{ timestamp: number }>
  readonly methodRateLimits: Record<
    string,
    { limit: number; remaining: number; queue: Array<{ timestamp: number }> }
  >
  constructor() {
    this.requestQueue = []
    this.methodRateLimits = {}
  }

  isRateLimited({ windowMs, maxRequests }: RateLimitOpts): boolean {
    const now = Date.now()
    // Remove old requests outside the window
    while (this.requestQueue.length > 0 && now - this.requestQueue[0]!.timestamp > windowMs) {
      this.requestQueue.shift()
    }
    return this.requestQueue.length >= maxRequests
  }

  isMethodRateLimited({ windowMs }: RateLimitOpts, method: string): boolean {
    const methodLimit = this.methodRateLimits[method]
    if (!methodLimit) return false

    const now = Date.now()
    // Remove old requests outside the window
    while (methodLimit.queue.length > 0 && now - methodLimit.queue[0]!.timestamp > windowMs) {
      methodLimit.queue.shift()
    }
    return methodLimit.queue.length >= methodLimit.limit
  }

  async waitForRateLimit(opts: RateLimitOpts, method?: string): Promise<void> {
    // Wait for method-specific rate limit if applicable
    if (method && this.methodRateLimits[method]) {
      while (this.isMethodRateLimited(opts, method)) {
        const oldestRequest = this.methodRateLimits[method].queue[0]
        if (!oldestRequest) break // Queue was cleaned, no longer rate limited
        const waitTime = opts.windowMs - (Date.now() - oldestRequest.timestamp)
        if (waitTime > 0) {
          await sleep(waitTime + 100) // Add small buffer
        }
      }
    }

    // Wait for global rate limit
    while (this.isRateLimited(opts)) {
      const oldestRequest = this.requestQueue[0]
      if (!oldestRequest) break // Queue was cleaned, no longer rate limited
      const waitTime = opts.windowMs - (Date.now() - oldestRequest.timestamp)
      if (waitTime > 0) {
        await sleep(waitTime + 100) // Add small buffer
      }
    }
  }

  recordRequest(method?: string): void {
    const timestamp = Date.now()
    this.requestQueue.push({ timestamp })
    if (method && this.methodRateLimits[method]) {
      this.methodRateLimits[method].queue.push({ timestamp })
    }
  }

  updateMethodRateLimits(response: Response, method?: string): void {
    if (!method) return

    const limit = Number(response.headers.get('x-ratelimit-method-limit'))
    const remaining = Number(response.headers.get('x-ratelimit-method-remaining'))

    if (isNaN(limit) || isNaN(remaining)) return
    if (!this.methodRateLimits[method]) {
      this.methodRateLimits[method] = { limit, remaining, queue: [] }
    } else {
      this.methodRateLimits[method].limit = limit
      this.methodRateLimits[method].remaining = remaining
    }
  }
}
/* eslint-enable jsdoc/require-jsdoc */

// global map per hostname
const perHostnameRateLimits: Record<string, RateLimit> = {}

/**
 * Creates a rate-limited fetch function with retry logic.
 * Configurable via maxRequests, windowMs, and maxRetries options.
 * @returns Rate-limited fetch function.
 */
export function createRateLimitedFetch(
  opts: Partial<RateLimitOpts> = {},
  { logger = console }: WithLogger = {},
): typeof fetch {
  opts.maxRequests ??= 40
  opts.maxRetries ??= 5
  opts.windowMs ??= 11e3
  const opts_ = opts as RateLimitOpts

  const extractMethod = (init?: RequestInit): string | undefined => {
    if (!init?.body || (typeof init.body !== 'string' && typeof init.body !== 'object')) return
    try {
      const parsed = (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) as
        | { method?: string }
        | undefined
      if (parsed && typeof parsed.method === 'string') return parsed.method
    } catch {
      // Not JSON or no method field
    }
  }

  const extractHostname = (input: Parameters<typeof fetch>[0]): string => {
    if (typeof input === 'string') {
      input = new URL(input)
    } else if (input instanceof Request) {
      input = new URL(input.url)
    }
    return input.hostname
  }

  const isRateLimitError = (error: unknown): boolean => {
    if (error instanceof Error) {
      return !!error.message.match(/\b(429\b|rate.?limit)/i)
    }
    return false
  }

  return async (input, init?) => {
    let lastError: Error | null = null
    const method = extractMethod(init)
    const hostname = extractHostname(input)
    const rl = (perHostnameRateLimits[hostname] ??= new RateLimit())

    const body = init?.body ?? (input instanceof Request ? await input.clone().json() : undefined)
    for (let attempt = 0; attempt <= opts_.maxRetries; attempt++) {
      try {
        // Wait for rate limit before making request
        await rl.waitForRateLimit(opts_, method)
        rl.recordRequest(method)

        const response = await globalThis.fetch(
          input instanceof Request ? input.clone() : input,
          init,
        )

        // Update method rate limits from response headers
        rl.updateMethodRateLimits(response, method)

        // If response is successful, return it
        if (response.ok) {
          logger.debug(
            'fetched',
            response.status,
            body,
            // ((await response.clone().json()) as { result: unknown })?.result,
          )
          return response
        }

        // For rate limit responses, throw an error to trigger retry
        if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
          throw new CCIPHttpError(response.status, response.statusText)
        }

        // For other non-2xx responses, don't retry
        logger.debug('fetch non-retryable error', input, response.status, init?.body)
        throw new CCIPHttpError(response.status, response.statusText)
      } catch (error) {
        logger.debug('fetch errored', attempt, error, input, init?.body)
        lastError = error instanceof Error ? error : CCIPError.from(error, 'HTTP_ERROR')

        // Only retry on rate limit errors
        if (!isRateLimitError(lastError)) {
          throw lastError
        }

        // Don't retry on the last attempt
        if (attempt >= opts_.maxRetries) break
      }
    }

    throw lastError || CCIPError.from('Request failed after all retries', 'HTTP_ERROR')
  }
}

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
          defaultOptions: {
            depth: 2,
          } as Record<string, unknown>,
        }),
      }
export { util }
