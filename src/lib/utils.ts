import { type BaseContract, type Provider, Contract } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import SELECTORS from './selectors.js'
import { type NetworkInfo, CCIPContractType, CCIPVersion, VersionedContractABI } from './types.js'

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

export type KeysMatching<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never
}[keyof T]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AwaitedReturn<T> = T extends (...args: any) => Promise<infer R> ? R : never

export async function getContractProperties<
  C extends Omit<BaseContract, 'getFunction' | 'getEvent'>,
  T extends readonly (string & KeysMatching<C, () => Promise<unknown>>)[],
>(contract: C, ...properties: T): Promise<{ [K in keyof T]: AwaitedReturn<C[T[K]]> }> {
  const provider = contract.runner!.provider!
  const { name } = await getProviderNetwork(provider)
  return Promise.all(
    properties.map(async (prop) =>
      lazyCached(`${name}@${await contract.getAddress()}.${prop}()`, () =>
        (contract[prop] as () => Promise<unknown>)(),
      ),
    ),
  ) as Promise<{ [K in keyof T]: AwaitedReturn<C[T[K]]> }>
}

export async function getTypeAndVersion(
  provider: Provider,
  address: string,
): Promise<[type_: string, version: string, typeAndVersion: string, suffix?: string]>
export async function getTypeAndVersion(
  contract: Pick<TypedContract<typeof VersionedContractABI>, 'typeAndVersion'>,
): Promise<[type_: string, version: string, typeAndVersion: string, suffix?: string]>
/**
 * Fetches cached typeAndVersion() of a contract
 *
 * @param provider - provider to fetch the contract from
 * @param address - address of the contract
 * @returns [type, version, typeAndVersion, suffix?] tuple
 **/
export async function getTypeAndVersion(
  providerOrContract: Provider | Pick<TypedContract<typeof VersionedContractABI>, 'typeAndVersion'>,
  address?: string,
): Promise<[type_: string, version: string, typeAndVersion: string, suffix?: string]> {
  let provider: Provider
  if (address) {
    provider = providerOrContract as Provider
  } else {
    provider = (providerOrContract as TypedContract<typeof VersionedContractABI>).runner!.provider!
    address = await (providerOrContract as TypedContract<typeof VersionedContractABI>).getAddress()
  }
  const { name } = await getProviderNetwork(provider)
  return lazyCached(`${name}@${address}.parsedTypeAndVersion`, async () => {
    const versionedContract = new Contract(
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
export async function validateTypeAndVersion(
  provider: Provider,
  address: string,
): Promise<readonly [type: CCIPContractType, version: CCIPVersion, typeAndVersion: string]> {
  const [type_, version, typeAndVersion] = await getTypeAndVersion(provider, address)
  const ctype = Object.values(CCIPContractType).find((t) => type_.endsWith(t))
  if (!ctype) {
    throw new Error(`Unknown/not-core contract type: ${typeAndVersion}`)
  }
  const isCcipContractVersion = (v: string): v is CCIPVersion =>
    Object.values(CCIPVersion).includes(v as CCIPVersion)
  if (!isCcipContractVersion(version)) {
    throw new Error(`Unsupported contract version: "${typeAndVersion}" != "${version}"`)
  }
  return [ctype, version, typeAndVersion]
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
