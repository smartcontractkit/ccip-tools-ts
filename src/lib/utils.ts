import { type Provider, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import SELECTORS from './selectors.js'
import {
  type CCIPContractType,
  type CCIPVersion,
  type NetworkInfo,
  CCIPContractTypeCommitStore,
  CCIPContractTypeOffRamp,
  CCIPContractTypeOnRamp,
  CCIPContractTypeTokenPool,
  CCIPVersion_1_2,
  CCIPVersion_1_5,
  CCIPVersion_1_5_1,
  VersionedContractABI,
} from './types.js'

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
    beforeTimestamp = (await provider.getBlock(beforeBlockNumber))!.timestamp
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

export async function getTypeAndVersion(
  provider: Provider,
  address: string,
): Promise<readonly [type_: CCIPContractType, version: CCIPVersion, typeAndVersion: string]> {
  return lazyCached(`${address}.typeAndVersion()`, async () => {
    const versionedContract = new Contract(
      address,
      VersionedContractABI,
      provider,
    ) as unknown as TypedContract<typeof VersionedContractABI>
    let typeAndVersion
    try {
      typeAndVersion = await versionedContract.typeAndVersion()
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'BAD_DATA') {
        throw new Error(
          `${address} not a CCIP contract on "${(await getProviderNetwork(provider)).name}"`,
        )
      }
      throw err
    }
    const [type_, version_] = typeAndVersion.split(' ', 2)
    const [version] = version_.split('-', 2) // remove `-dev` suffixes

    const isCcipContractType = (t: string): t is CCIPContractType =>
      [
        CCIPContractTypeOnRamp,
        CCIPContractTypeOffRamp,
        CCIPContractTypeCommitStore,
        ...CCIPContractTypeTokenPool,
      ].some((t) => type_ === t)
    const isCcipContractVersion = (v: string): v is CCIPVersion =>
      [CCIPVersion_1_2, CCIPVersion_1_5, CCIPVersion_1_5_1].some((v) => version === v)
    if (!isCcipContractType(type_)) {
      throw new Error(`Unknown contract type: ${typeAndVersion}`)
    }
    if (!isCcipContractVersion(version)) {
      throw new Error(`Unsupported contract version: "${typeAndVersion}" != "${version}"`)
    }

    return [type_, version, typeAndVersion]
  })
}

export function chainNameFromId(id: number): string {
  if (!SELECTORS[id].name) throw new Error(`No name for chain with id = ${id}`)
  return SELECTORS[id].name
}

export function chainSelectorFromId(id: number): bigint {
  return SELECTORS[id].selector
}

export function chainIdFromSelector(selector: bigint): number {
  const id = lazyCached(`chainIdFromSelector ${selector}`, () => {
    for (const id in SELECTORS) {
      if (SELECTORS[id].selector === selector) {
        return Number(id)
      }
    }
  })
  if (id === undefined) throw new Error(`Selector not found: ${selector}`)
  return id
}

export const chainNameFromSelector = (selector: bigint) =>
  chainNameFromId(chainIdFromSelector(selector))

export function chainIdFromName(name: string): number {
  const id = lazyCached(`chainIdFromName ${name}`, () => {
    for (const id in SELECTORS) {
      if (SELECTORS[id].name === name) {
        return Number(id)
      }
    }
  })
  if (id === undefined) throw new Error(`Chain name not found: ${name}`)
  return id
}

export function networkInfo(selectorOrId: bigint | number): NetworkInfo {
  let chainId: number, chainSelector: bigint
  if (typeof selectorOrId === 'number') {
    chainId = selectorOrId
    chainSelector = chainSelectorFromId(chainId)
  } else {
    chainSelector = selectorOrId
    chainId = chainIdFromSelector(chainSelector)
  }
  const name = chainNameFromId(chainId)
  return {
    chainId,
    chainSelector,
    name,
    isTestnet: !name.includes('-mainnet'),
  }
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
 * Splits an array into multiple arrays of specified size.
 *
 * @template T - Type of array elements
 * @param array - The array to split into chunks
 * @param size - The size of each chunk. Must be greater than 0
 * @returns Array of chunks, each of size `size` (except possibly the last one)
 * @throws {Error} If size is less than or equal to 0
 *
 * @example
 * ```ts
 * const numbers = [1, 2, 3, 4, 5];
 * const chunks = chunk(numbers, 2);
 * // Result: [[1, 2], [3, 4], [5]]
 * ```
 */
export function chunk<T>(array: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0')
  }
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}
