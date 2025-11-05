import type { Abi } from 'abitype'
import {
  type Addressable,
  type BaseContract,
  type BigNumberish,
  type BytesLike,
  type InterfaceAbi,
  type Provider,
  Contract,
  Result,
  dataLength,
  decodeBase58,
  decodeBase64,
  encodeBase58,
  getAddress,
  getBytes,
  hexlify,
  isBytesLike,
  toBeArray,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import SELECTORS from './selectors.ts'
import {
  type NetworkInfo,
  CCIPContractType,
  CCIPVersion,
  ChainFamily,
  VersionedContractABI,
} from './types.ts'

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

const defaultSharedCache = new Map<string, unknown>()
/**
 * Receives a key and a factory: creates, caches and returns the same value for a given key
 **/
export function lazyCached<T>(
  key: string,
  lazy: () => T,
  cache: Map<string, unknown> = defaultSharedCache,
): T {
  if (cache.has(key)) return cache.get(key) as T
  const cached = lazy()
  cache.set(key, cached)
  return cached
}

export type KeysMatching<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never
}[keyof T]

export type ContractLike<C> = C extends { [1]: Abi } ? TypedContract<C[1]> : C

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AwaitedReturn<T> = T extends (...args: any) => Promise<infer R> ? R : never

/**
 * Fetches multiple properties of a contract (async getters with no arguments), caching the results
 *
 * @param contract - contract to fetch properties from, as contract instance
 *   or [address, abi, provider] contract constructor arguments (constructed only if not cached)
 * @param properties - list of property names to fetch
 * @returns Promise to tuple of property values
 **/
export async function getContractProperties<
  C extends
    | Pick<BaseContract, 'getAddress' | 'runner'>
    | readonly [address: string | Addressable, abi: Abi, provider: Provider],
  T extends readonly (string & KeysMatching<ContractLike<C>, () => Promise<unknown>>)[],
>(
  contract: C,
  ...properties: T
): Promise<{ [K in keyof T]: AwaitedReturn<ContractLike<C>[T[K]]> }> {
  let provider, address
  if ('runner' in contract) {
    address = await contract.getAddress()
    provider = contract.runner!.provider!
  } else {
    address = typeof contract[0] === 'string' ? contract[0] : await contract[0].getAddress()
    provider = contract[2]
  }

  const { name } = await getProviderNetwork(provider)
  return Promise.all(
    properties.map(async (prop) =>
      lazyCached(`${name}@${address}.${prop}()`, () =>
        (
          ('runner' in contract
            ? contract
            : new Contract(address, contract[1] as InterfaceAbi, provider)) as unknown as {
            [k: string]: () => Promise<unknown>
          }
        )[prop](),
      ),
    ),
  ) as Promise<{ [K in keyof T]: AwaitedReturn<ContractLike<C>[T[K]]> }>
}

export async function getTypeAndVersion(
  provider: Provider,
  address: string,
): Promise<[type_: string, version: string, typeAndVersion: string, suffix?: string]>
export async function getTypeAndVersion(
  contract: Pick<
    TypedContract<typeof VersionedContractABI>,
    'typeAndVersion' | 'getAddress' | 'runner'
  >,
): Promise<[type_: string, version: string, typeAndVersion: string, suffix?: string]>
/**
 * Fetches cached typeAndVersion() of a contract
 *
 * @param provider - provider to fetch the contract from
 * @param address - address of the contract
 * @returns [type, version, typeAndVersion, suffix?] tuple
 **/
export async function getTypeAndVersion(
  providerOrContract:
    | Provider
    | Pick<TypedContract<typeof VersionedContractABI>, 'typeAndVersion' | 'getAddress' | 'runner'>,
  address?: string,
): Promise<[type_: string, version: string, typeAndVersion: string, suffix?: string]> {
  let provider: Provider
  let versionedContract: Pick<
    TypedContract<typeof VersionedContractABI>,
    'typeAndVersion' | 'getAddress' | 'runner'
  >
  if (address) {
    provider = providerOrContract as Provider
  } else {
    provider = (providerOrContract as TypedContract<typeof VersionedContractABI>).runner!.provider!
    address = await (providerOrContract as TypedContract<typeof VersionedContractABI>).getAddress()
    versionedContract = providerOrContract as TypedContract<typeof VersionedContractABI>
  }
  const { name } = await getProviderNetwork(provider)
  return lazyCached(`${name}@${address}.parsedTypeAndVersion`, async () => {
    if (!versionedContract)
      versionedContract = new Contract(
        address,
        VersionedContractABI,
        provider,
      ) as unknown as TypedContract<typeof VersionedContractABI>
    let typeAndVersion: string
    try {
      ;[typeAndVersion] = await getContractProperties(versionedContract, 'typeAndVersion')
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'BAD_DATA') {
        throw new Error(
          `${address} not a CCIP contract on "${(await getProviderNetwork(provider)).name}"`,
        )
      }
      throw err
    }
    const match = typeAndVersion.match(/^(\w.+\S)\s+v?(\d+\.\d+(?:\.\d+)?)([^\d.].*)?$/)
    if (!match) throw new Error(`Invalid typeAndVersion: "${typeAndVersion}"`)
    if (!match[3]) return [match[1], match[2], typeAndVersion]
    else return [match[1], match[2], typeAndVersion, match[3]]
  })
}

/**
 * Fetches and validates typeAndVersion for known/core contract types (OnRamp, OffRamp, etc)
 * and supported CCIP versions
 **/
export async function validateContractType(
  provider: Provider,
  address: string,
  type: CCIPContractType,
): Promise<readonly [version: CCIPVersion, typeAndVersion: string]> {
  const [type_, version, typeAndVersion] = await getTypeAndVersion(provider, address)
  const ctype = Object.values(CCIPContractType).find((t) => type_.endsWith(t))
  if (!ctype) {
    throw new Error(`Unknown/not-core contract type: ${typeAndVersion}`)
  }
  if (ctype !== type) {
    throw new Error(
      `Not a${type.startsWith('O') ? 'n' : ''} ${type}: ${address} is "${typeAndVersion}"`,
    )
  }
  const isCcipContractVersion = (v: string): v is CCIPVersion =>
    Object.values(CCIPVersion).includes(v as CCIPVersion)
  if (!isCcipContractVersion(version)) {
    throw new Error(`Unsupported contract version: "${typeAndVersion}"`)
  }
  return [version, typeAndVersion]
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
  return lazyCached(`chainIdFromSelector ${selector}`, () => {
    for (const id in SELECTORS) {
      if (SELECTORS[id].selector === selector) {
        return isNaN(Number(id)) ? id : Number(id)
      }
    }
    throw new Error(`Selector not found: ${selector}`)
  })
}

export const chainNameFromSelector = (selector: bigint) =>
  chainNameFromId(chainIdFromSelector(selector))

export function chainIdFromName(name: string): NetworkInfo['chainId'] {
  return lazyCached(`chainIdFromName ${name}`, () => {
    for (const id in SELECTORS) {
      if (SELECTORS[id].name === name) {
        return isNaN(Number(id)) ? id : Number(id)
      }
    }
    throw new Error(`Chain name not found: ${name}`)
  })
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
  if (name.startsWith('sui-')) return ChainFamily.Sui
  if (name.startsWith('test-')) return ChainFamily.Test
  return ChainFamily.EVM
}

export async function getProviderNetwork(provider: Provider): Promise<NetworkInfo> {
  // AbstractProvider.getNetwork() is cached
  return networkInfo(Number((await provider.getNetwork()).chainId))
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
  switch (family) {
    case ChainFamily.EVM: {
      const bytes = hexlify(getAddressBytes(address))
      if (dataLength(bytes) !== 20)
        throw new Error(`Invalid address length: ${bytes} => ${bytes.length} != 20`)
      return getAddress(bytes)
    }
    case ChainFamily.Aptos: {
      let aptosBytes: Uint8Array
      if (typeof address === 'string' && address.startsWith('0x')) {
        // Handle hex strings, including odd-length ones like '0x1'
        let normalizedAddress = address
        if (address.length % 2 === 1) {
          // Pad odd-length hex strings with leading zero
          normalizedAddress = '0x0' + address.slice(2)
        }
        aptosBytes = getBytes(normalizedAddress)
      } else if (isBytesLike(address)) {
        aptosBytes = getBytes(address)
      } else {
        aptosBytes = getBytes(toBeHex(decodeBase58(address), 32))
      }
      // Always return a 32-byte hex string for Aptos addresses
      if (aptosBytes.length <= 32) {
        return zeroPadValue(hexlify(aptosBytes), 32)
      }
      // If longer than 32 bytes, take the last 32 bytes
      return hexlify(aptosBytes.slice(-32))
    }
    case ChainFamily.Solana: {
      return encodeBase58(getAddressBytes(address))
    }
    case ChainFamily.Test: {
      return hexlify(getBytes(address))
    }
    default:
      throw new Error(`Unsupported address family: ${family as string}`)
  }
}

export function toLeHex(_value: BigNumberish, width?: number): string {
  let value = toBeArray(_value).reverse()
  if (width == null) {
    // pass
  } else if (value.length > width) {
    throw new Error(`Value ${_value} is too big for ${width} bytes`)
  } else if (width > value.length) {
    const val = new Uint8Array(width).fill(0)
    val.set(value, 0)
    value = val
  }
  return hexlify(value)
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
    bytes = getBytes(toBeHex(decodeBase58(address), 32))
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
export function toCamelCase(str: string): string {
  return str.replace(/_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase())
}

/**
 * Recursively converts all snake_case keys in an object to camelCase
 * Only converts keys that actually have snake_case format
 */
export function convertKeysToCamelCase(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(convertKeysToCamelCase)
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Only convert keys that contain underscores
    const camelKey = key.includes('_') ? toCamelCase(key) : key
    result[camelKey] = convertKeysToCamelCase(value)
  }
  return result
}
