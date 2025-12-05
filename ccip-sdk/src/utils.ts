import util from 'util'

import bs58 from 'bs58'
import {
  type BigNumberish,
  type BytesLike,
  type Numeric,
  decodeBase64,
  getBytes,
  isBytesLike,
  toBeHex,
  toBigInt,
} from 'ethers'
import { memoize } from 'micro-memoize'

import type { Chain } from './chain.ts'
import SELECTORS from './selectors.ts'
import { supportedChains } from './supported-chains.ts'
import { type NetworkInfo, ChainFamily } from './types.ts'

/**
 * Returns *some* block number with timestamp prior to `timestamp`
 *
 * @param getBlockTimestamp - function to get block timestamp
 * @param recentBlockNumber - a block guaranteed to be after `timestamp` (e.g. latest)
 * @param timestamp - target timestamp
 * @param precision - returned blockNumber should be within this many blocks before timestamp
 * @returns blockNumber of a block at provider which is close but before target timestamp
 **/
export async function getSomeBlockNumberBefore(
  getBlockTimestamp: (blockNumber: number) => Promise<number>,
  recentBlockNumber: number,
  timestamp: number,
  precision = 10,
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
    throw new Error(`Could not find a block prior to timestamp=${timestamp}`)
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
    console.debug('getSomeBlockNumberBefore: searching block before', {
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

// memoized so we always output the same object for a given chainId
const networkInfoFromChainId = memoize((chainId: NetworkInfo['chainId']): NetworkInfo => {
  const sel = SELECTORS[chainId]
  if (!sel?.name) throw new Error(`Chain not found: ${chainId}`)
  return {
    chainId: isNaN(+chainId) ? chainId : +chainId,
    chainSelector: sel.selector,
    name: sel.name,
    family: sel.family,
    isTestnet: !sel.name.includes('-mainnet'),
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
 */
export const networkInfo = memoize(function networkInfo_(
  selectorOrIdOrName: bigint | number | string,
): NetworkInfo {
  let chainId
  if (typeof selectorOrIdOrName === 'number') {
    chainId = selectorOrIdOrName
  } else if (typeof selectorOrIdOrName === 'string' && selectorOrIdOrName.match(/^\d+$/)) {
    selectorOrIdOrName = BigInt(selectorOrIdOrName)
  }
  if (typeof selectorOrIdOrName === 'bigint') {
    // maybe we got a number deserialized as bigint
    if (selectorOrIdOrName.toString() in SELECTORS) {
      chainId = Number(selectorOrIdOrName)
    } else {
      for (const id in SELECTORS) {
        if (SELECTORS[id].selector === selectorOrIdOrName) {
          chainId = id
          break
        }
      }
      if (!chainId) throw new Error(`Selector not found: ${selectorOrIdOrName}`)
    }
  } else if (typeof selectorOrIdOrName === 'string') {
    if (selectorOrIdOrName.includes('-')) {
      for (const id in SELECTORS) {
        if (SELECTORS[id].name === selectorOrIdOrName) {
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
 */
export function bigIntReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }
  return value
}

/**
 * Decode address from a 32-byte hex string
 **/
export function decodeAddress(address: BytesLike, family: ChainFamily = ChainFamily.EVM): string {
  const chain = supportedChains[family]
  if (!chain) throw new Error(`Unsupported chain family: ${family}`)
  return chain.getAddress(getAddressBytes(address))
}

/**
 * Version of decodeAddress which is aware of custom cross-chain OnRamp formats
 **/
export function decodeOnRampAddress(
  address: BytesLike,
  family: ChainFamily = ChainFamily.EVM,
): string {
  let decoded = decodeAddress(address, family)
  if (family === ChainFamily.Aptos) decoded += '::onramp'
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
  return getBytes(toBeHex(value, width)).reverse()
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
 */
export function getDataBytes(data: BytesLike | readonly number[]): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(data)
  }
  if (isBytesLike(data)) {
    return getBytes(data)
  } else if (isBase64(data)) {
    return decodeBase64(data)
  } else {
    throw new Error(`Unsupported data format: ${util.inspect(data)}`)
  }
}

/**
 * Extracts address bytes, handling both hex and Base58 formats.
 * @param address - Address in hex or Base58 format.
 * @returns Address bytes as Uint8Array.
 */
export function getAddressBytes(address: BytesLike): Uint8Array {
  let bytes: Uint8Array
  if (isBytesLike(address)) {
    bytes = getBytes(address)
  } else {
    bytes = bs58.decode(address)
  }
  if (bytes.length > 20) {
    if (
      bytes.slice(0, bytes.length - 20).every((b) => b === 0) &&
      bytes.slice(-20).some((b) => b !== 0)
    ) {
      bytes = bytes.slice(-20)
    }
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
  if (Array.isArray(obj)) {
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
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref())

/**
 * Parses a typeAndVersion string into its components.
 * @param typeAndVersion - String in format "TypeName vX.Y.Z".
 * @returns Tuple of [type, version, original, suffix?].
 */
export function parseTypeAndVersion(
  typeAndVersion: string,
): Awaited<ReturnType<Chain['typeAndVersion']>> {
  const match = typeAndVersion.match(/^(\w.+\S)\s+v?(\d+\.\d+(?:\.\d+)?)([^\d.].*)?$/)
  if (!match)
    throw new Error(
      `Invalid typeAndVersion: "${typeAndVersion}", len=${typeAndVersion.length}, hex=0x${Buffer.from(typeAndVersion).toString('hex')}`,
    )
  const [, typeRaw, version] = match
  // some string normalization
  const type = typeRaw
    .replaceAll(/-(\w)/g, (_, w: string) => w.toUpperCase()) // kebabToPascal
    .replace(/ccip/gi, 'CCIP')
    .replace(
      /(o)(n|ff)(ramp)\b/gi,
      (_, o: string, n: string, ramp: string) =>
        `${o.toUpperCase()}${n.toLowerCase()}${ramp.charAt(0).toUpperCase()}${ramp.slice(1).toLowerCase()}`,
    ) // ccipOfframp -> CCIPOffRamp
  if (!match[3]) return [type, version, typeAndVersion]
  else return [type, version, typeAndVersion, match[3]]
}

/**
 * Creates a rate-limited fetch function with retry logic.
 * Configurable via maxRequests, windowMs, and maxRetries options.
 * @returns Rate-limited fetch function.
 */
export function createRateLimitedFetch({
  maxRequests = Number(process.env['RL_MAX_REQUESTS'] || 40),
  windowMs = Number(process.env['RL_WINDOW_MS'] || 11e3),
  maxRetries = Number(process.env['RL_MAX_RETRIES'] || 5),
}: { maxRequests?: number; windowMs?: number; maxRetries?: number } = {}): typeof fetch {
  // Custom fetch implementation with retry logic and rate limiting
  // Per-instance state
  const requestQueue: Array<{ timestamp: number }> = []
  const methodRateLimits: Record<
    string,
    { limit: number; remaining: number; queue: Array<{ timestamp: number }> }
  > = {}

  const isRateLimited = (): boolean => {
    const now = Date.now()
    // Remove old requests outside the window
    while (requestQueue.length > 0 && now - requestQueue[0].timestamp > windowMs) {
      requestQueue.shift()
    }
    return requestQueue.length >= maxRequests
  }

  const isMethodRateLimited = (method: string): boolean => {
    const methodLimit = methodRateLimits[method]
    if (!methodLimit) return false

    const now = Date.now()
    // Remove old requests outside the window
    while (methodLimit.queue.length > 0 && now - methodLimit.queue[0].timestamp > windowMs) {
      methodLimit.queue.shift()
    }
    return methodLimit.queue.length >= methodLimit.limit
  }

  const waitForRateLimit = async (method?: string): Promise<void> => {
    // Wait for method-specific rate limit if applicable
    if (method && methodRateLimits[method]) {
      while (isMethodRateLimited(method)) {
        const oldestRequest = methodRateLimits[method].queue[0]
        const waitTime = windowMs - (Date.now() - oldestRequest.timestamp)
        if (waitTime > 0) {
          await sleep(waitTime + 100) // Add small buffer
        }
      }
    }

    // Wait for global rate limit
    while (isRateLimited()) {
      const oldestRequest = requestQueue[0]
      const waitTime = windowMs - (Date.now() - oldestRequest.timestamp)
      if (waitTime > 0) {
        await sleep(waitTime + 100) // Add small buffer
      }
    }
  }

  const recordRequest = (method?: string): void => {
    const timestamp = Date.now()
    requestQueue.push({ timestamp })
    if (method && methodRateLimits[method]) {
      methodRateLimits[method].queue.push({ timestamp })
    }
  }

  const updateMethodRateLimits = (response: Response, method?: string): void => {
    if (!method) return

    const limit = Number(response.headers.get('x-ratelimit-method-limit'))
    const remaining = Number(response.headers.get('x-ratelimit-method-remaining'))

    if (isNaN(limit) || isNaN(remaining)) return
    if (!methodRateLimits[method]) {
      methodRateLimits[method] = { limit, remaining, queue: [] }
    } else {
      methodRateLimits[method].limit = limit
      methodRateLimits[method].remaining = remaining
    }
  }

  const extractMethod = (init?: RequestInit): string | undefined => {
    if (!init?.body || (typeof init.body !== 'string' && typeof init.body !== 'object')) return
    try {
      const parsed = (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) as {
        method?: string
      }
      if (parsed && typeof parsed.method === 'string') return parsed.method
    } catch {
      // Not JSON or no method field
    }
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

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Wait for rate limit before making request
        await waitForRateLimit(method)
        recordRequest(method)
        // console.debug('__fetching', input, init?.body)

        const response = await fetch(input, init)

        // Update method rate limits from response headers
        updateMethodRateLimits(response, method)

        // If response is successful, return it
        if (response.ok) {
          console.debug('fetched', input, response.status, init?.body)
          return response
        }

        // For 429 responses, throw an error to trigger retry
        if (response.status === 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // For other non-2xx responses, don't retry
        console.debug('fetch non-retryable error', input, response.status, init?.body)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      } catch (error) {
        console.debug('fetch errored', attempt, error, input, init?.body)
        lastError = error instanceof Error ? error : new Error(String(error))

        // Only retry on rate limit errors
        if (!isRateLimitError(lastError)) {
          throw lastError
        }

        // Don't retry on the last attempt
        if (attempt >= maxRetries) {
          break
        }
      }
    }

    throw lastError || new Error('Request failed after all retries')
  }
}
