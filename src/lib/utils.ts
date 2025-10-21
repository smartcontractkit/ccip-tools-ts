import bs58 from 'bs58'
import {
  type BigNumberish,
  type BytesLike,
  type Numeric,
  type Provider,
  Result,
  decodeBase64,
  getBytes,
  isBytesLike,
  toBeHex,
  toBigInt,
} from 'ethers'

import { type Chain, type ChainStatic, ChainFamily } from './chain.ts'
import SELECTORS from './selectors.ts'
import { supportedChains } from './supported-chains.ts'
import type { NetworkInfo } from './types.ts'

/**
 * Returns *some* block number with timestamp prior to `timestamp`
 *
 * @param provider - provider to search blocks on
 * @param timestamp - target timestamp
 * @param precision - returned blockNumber should be within this many blocks from target
 * @returns blockNumber of a block at provider which is close but before target timestamp
 **/
export async function getSomeBlockNumberBefore(
  provider: Provider,
  timestamp: number,
  precision = 10,
): Promise<number> {
  const currentBlockNumber = await provider.getBlockNumber()
  let beforeBlockNumber = Math.max(1, currentBlockNumber - precision * 1000)
  let beforeTimestamp = (await provider.getBlock(beforeBlockNumber))!.timestamp

  const now = Math.trunc(Date.now() / 1000)
  let estimatedBlockTime = (now - beforeTimestamp) / (currentBlockNumber - beforeBlockNumber),
    afterBlockNumber = currentBlockNumber,
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
    const beforeBlock = await provider.getBlock(beforeBlockNumber)
    if (!beforeBlock) throw new Error(`Could not fetch block=${beforeBlockNumber}`)
    beforeTimestamp = beforeBlock.timestamp
    estimatedBlockTime = (now - beforeTimestamp) / (currentBlockNumber - beforeBlockNumber)
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
    const pivotTimestamp = (await provider.getBlock(pivot))!.timestamp
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

export function chainNameFromId(id: NetworkInfo['chainId']): string {
  const entry = SELECTORS[id]
  if (!entry) throw new Error(`Chain ID not found: ${id}`)
  if (!entry.name) throw new Error(`No name for chain with id = ${id}`)
  return entry.name
}

export function chainSelectorFromId(id: NetworkInfo['chainId']): bigint {
  const entry = SELECTORS[id]
  if (!entry) throw new Error(`Chain ID not found: ${id}`)
  return entry.selector
}

export function chainIdFromSelector(selector: bigint): NetworkInfo['chainId'] {
  for (const id in SELECTORS) {
    if (SELECTORS[id].selector === selector) {
      return isNaN(Number(id)) ? id : Number(id)
    }
  }
  throw new Error(`Selector not found: ${selector}`)
}

export const chainNameFromSelector = (selector: bigint) =>
  chainNameFromId(chainIdFromSelector(selector))

export function chainIdFromName(name: string): NetworkInfo['chainId'] {
  for (const id in SELECTORS) {
    if (SELECTORS[id].name === name) {
      return isNaN(Number(id)) ? id : Number(id)
    }
  }
  throw new Error(`Chain name not found: ${name}`)
}

/**
 * Converts a chain selector, chain ID, or chain name to complete network information
 *
 * @param selectorOrIdOrName - Can be:
 *   - Chain selector as bigint or numeric string
 *   - Chain ID as number or string (EVM: "1", Aptos: "aptos:1", Solana: base58)
 *   - Chain name as string ("ethereum-mainnet")
 * @returns Complete NetworkInfo object
 */
export function networkInfo(selectorOrIdOrName: bigint | number | string): NetworkInfo {
  const { chainId, chainSelector } = resolveChainIdentifiers(selectorOrIdOrName)

  const name = chainNameFromSelector(chainSelector)
  const family = getChainFamily(name)

  return {
    chainId,
    chainSelector,
    name,
    family,
    isTestnet: !name.includes('-mainnet'),
  } as NetworkInfo
}

/**
 * Helper function to resolve input to chainId and chainSelector
 */
function resolveChainIdentifiers(input: bigint | number | string): {
  chainId: NetworkInfo['chainId']
  chainSelector: bigint
} {
  // Handle bigint selector
  if (typeof input === 'bigint') {
    return {
      chainSelector: input,
      chainId: chainIdFromSelector(input),
    }
  }

  // Handle number (EVM chain ID)
  if (typeof input === 'number') {
    return {
      chainId: input,
      chainSelector: chainSelectorFromId(input),
    }
  }

  // Handle string inputs
  return resolveStringInput(input)
}

/**
 * Resolves string input which could be selector, chain ID, or chain name
 */
function resolveStringInput(input: string): {
  chainId: NetworkInfo['chainId']
  chainSelector: bigint
} {
  // Try as direct chain ID first (handles Aptos/Solana IDs)
  if (input in SELECTORS) {
    return {
      chainId: input,
      chainSelector: chainSelectorFromId(input),
    }
  }

  // Try as numeric value (selector or EVM chain ID)
  if (/^\d+$/.test(input)) {
    return resolveNumericString(input)
  }

  // Fall back to chain name lookup
  const chainId = chainIdFromName(input)
  return {
    chainId,
    chainSelector: chainSelectorFromId(chainId),
  }
}

/**
 * Resolves numeric string - could be selector or EVM chain ID
 */
function resolveNumericString(input: string): {
  chainId: NetworkInfo['chainId']
  chainSelector: bigint
} {
  const bigIntValue = BigInt(input)

  // Try as selector first
  try {
    return {
      chainSelector: bigIntValue,
      chainId: chainIdFromSelector(bigIntValue),
    }
  } catch {
    // If not a valid selector, try as EVM chain ID
    const numValue = Number(input)
    if (numValue.toString() in SELECTORS) {
      return {
        chainId: numValue,
        chainSelector: chainSelectorFromId(numValue),
      }
    }

    // Not found as either, treat as chain name
    const chainId = chainIdFromName(input)
    return {
      chainId,
      chainSelector: chainSelectorFromId(chainId),
    }
  }
}

/**
 * Determines chain family from chain name
 */
function getChainFamily(name: string): ChainFamily {
  if (name.startsWith('solana-')) return ChainFamily.Solana
  if (name.startsWith('aptos-')) return ChainFamily.Aptos
  if (name.startsWith('test-')) return ChainFamily.Test
  return ChainFamily.EVM
}

const BLOCK_RANGE = 10_000
/**
 * Generates exclusive block ranges [fromBlock, toBlock]
 * If startBlock is given, moves forward from there (up to latestBlock),
 * Otherwise, moves backwards down to genesis (you probably want to break/return before that)
 **/
export function* blockRangeGenerator(
  params: { endBlock: number; startBlock?: number } | { singleBlock: number },
  stepSize = BLOCK_RANGE,
) {
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

export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

export function bigIntReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }
  return value
}

/**
 * When decoding structs, we often get Results which don't support `<string> in` operator, so we need to convert them to proper objects first
 **/
export function toObject<T>(obj: T | Result): T {
  if (obj instanceof Result) return obj.toObject() as T
  return obj
}

/**
 * Decode address from a 32-byte hex string
 **/
export function decodeAddress(address: BytesLike, family: ChainFamily = ChainFamily.EVM): string {
  const chain = (supportedChains as Partial<Record<ChainFamily, ChainStatic>>)[family]
  if (!chain) throw new Error(`Unsupported chain family: ${family}`)
  return chain.getAddress(address)
}

export function leToBigInt(data: BytesLike | readonly number[]): bigint {
  if (Array.isArray(data)) data = new Uint8Array(data)
  return toBigInt(getBytes(data as BytesLike).reverse())
}

export function toLeArray(value: BigNumberish, width?: Numeric): Uint8Array {
  return getBytes(toBeHex(value, width)).reverse()
}

export function getDataBytes(data: BytesLike): Uint8Array {
  if (isBytesLike(data)) {
    return getBytes(data)
  } else {
    return decodeBase64(data)
  }
}

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

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function parseTypeAndVersion(
  typeAndVersion: string,
): Awaited<ReturnType<Chain['typeAndVersion']>> {
  const match = typeAndVersion.match(/^(\w.+\S)\s+v?(\d+\.\d+(?:\.\d+)?)([^\d.].*)?$/)
  if (!match)
    throw new Error(
      `Invalid typeAndVersion: "${typeAndVersion}", len=${typeAndVersion.length}, hex=0x${Buffer.from(typeAndVersion).toString('hex')}`,
    )
  const [_, typeRaw, version] = match
  const type_ = typeRaw
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // kebabToPascal
    .join('')
    .replace(/ramp\b/, 'Ramp') // CcipOfframp -> CcipOffRamp
  if (!match[3]) return [type_, version, typeAndVersion]
  else return [type_, version, typeAndVersion, match[3]]
}

export function createRateLimitedFetch({
  maxRequests = Number(process.env['RL_MAX_REQUESTS'] || 2),
  windowMs = Number(process.env['RL_WINDOW_MS'] || 10000),
  maxRetries = Number(process.env['RL_MAX_RETRIES'] || 5),
}: { maxRequests?: number; windowMs?: number; maxRetries?: number } = {}): typeof fetch {
  // Custom fetch implementation with retry logic and rate limiting
  // Per-instance state
  const requestQueue: Array<{ timestamp: number }> = []

  const isRateLimited = (): boolean => {
    const now = Date.now()
    // Remove old requests outside the window
    while (requestQueue.length > 0 && now - requestQueue[0].timestamp > windowMs) {
      requestQueue.shift()
    }
    return requestQueue.length >= maxRequests
  }

  const waitForRateLimit = async (): Promise<void> => {
    while (isRateLimited()) {
      const oldestRequest = requestQueue[0]
      const waitTime = windowMs - (Date.now() - oldestRequest.timestamp)
      if (waitTime > 0) {
        await sleep(waitTime + 100) // Add small buffer
      }
    }
  }

  const recordRequest = (): void => {
    requestQueue.push({ timestamp: Date.now() })
  }

  const isRateLimitError = (error: unknown): boolean => {
    if (error instanceof Error) {
      return !!error.message.match(/\b(429\b|rate.?limit)/i)
    }
    return false
  }

  return async (input, init?) => {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Wait for rate limit before making request
        await waitForRateLimit()
        recordRequest()
        console.debug('__fetching', input, init?.body)

        const response = await fetch(input, init)

        // If response is successful, return it
        if (response.ok) {
          console.debug('__fetch succeeded', input, response.status, init?.body)
          return response
        }

        // For 429 responses, throw an error to trigger retry
        if (response.status === 429) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // For other non-2xx responses, don't retry
        console.debug('__fetch non-retryable error', input, response.status, init?.body)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      } catch (error) {
        console.debug('__fetch errored', attempt, error, input, init?.body)
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
