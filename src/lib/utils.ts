import fs from 'node:fs'

import { Contract, type Provider } from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import path from 'path'
import YAML from 'yaml'

import {
  type CCIPContractType,
  CCIPContractTypeCommitStore,
  CCIPContractTypeOffRamp,
  CCIPContractTypeOnRamp,
  type CCIPVersion,
  CCIPVersion_1_2,
  CCIPVersion_1_5,
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
  for (let iter = 0; beforeBlockNumber > 1 && beforeTimestamp >= timestamp; iter++) {
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

  if (beforeTimestamp >= timestamp) {
    throw new Error(`Could not find a block prior to timestamp=${timestamp}`)
  }

  // now, bin-search based on timestamp proportions, looking for
  // a block at most N estimated blockTimes from our target timestamp
  while (timestamp - beforeTimestamp > estimatedBlockTime * precision) {
    const pivot =
      beforeBlockNumber +
      Math.trunc(
        ((timestamp - beforeTimestamp) / (afterTimestamp - beforeTimestamp)) *
          (afterBlockNumber - beforeBlockNumber),
      )
    const pivotTimestamp = (await provider.getBlock(pivot))!.timestamp
    if (pivotTimestamp > timestamp) {
      afterBlockNumber = pivot
      afterTimestamp = pivotTimestamp
    } else {
      beforeBlockNumber = pivot
      beforeTimestamp = pivotTimestamp
    }
  }
  return beforeBlockNumber
}

const lazyCache = new Map<string, unknown>()
/**
 * Receives a key and a Promise factory: creates, caches and returns the same Promise
 * for any given key
 **/
export function lazyCached<T>(key: string, lazy: () => T): T {
  let cached = lazyCache.get(key)
  if (cached !== undefined) return cached as T
  cached = lazy()
  lazyCache.set(key, cached)
  return cached as T
}

export async function getTypeAndVersion(
  provider: Provider,
  address: string,
): Promise<readonly [type_: CCIPContractType, version: CCIPVersion]> {
  return lazyCached(`${address}.typeAndVersion()`, async () => {
    const versionedContract = new Contract(
      address,
      VersionedContractABI,
      provider,
    ) as unknown as TypedContract<typeof VersionedContractABI>
    const typeAndVersion = await versionedContract.typeAndVersion()
    const [type_, version] = typeAndVersion.split(' ', 2)

    if (
      ![CCIPContractTypeOnRamp, CCIPContractTypeOffRamp, CCIPContractTypeCommitStore].some(
        (t) => type_ === t,
      )
    ) {
      throw new Error(`Unknown contract type: ${typeAndVersion}`)
    }
    if (![CCIPVersion_1_2, CCIPVersion_1_5].some((v) => version === v)) {
      throw new Error(`Unsupported contract version: "${typeAndVersion}" != "${version}"`)
    }

    return [type_, version] as readonly [type_: CCIPContractType, version: CCIPVersion]
  })
}

interface Selectors {
  selectors: Record<number, { selector: bigint; name: string }>
}

// TODO: embed this instead of reading from fs
let SELECTORS = (
  YAML.parse(fs.readFileSync(path.join(import.meta.dirname, 'selectors.yml'), 'utf8'), {
    intAsBigInt: true,
  }) as Selectors
).selectors

fetch('https://github.com/smartcontractkit/chain-selectors/raw/main/selectors.yml')
  .then((res) => res.text())
  .then((body) => {
    SELECTORS = (YAML.parse(body, { intAsBigInt: true }) as Selectors).selectors
  })
  .catch((err) => console.warn('Could not fetch up-to-date chain-selectors; using embedded', err))

export function chainNameFromId(id: bigint): string {
  return SELECTORS[Number(id)].name
}

export function chainSelectorFromId(id: bigint): bigint {
  return SELECTORS[Number(id)].selector
}

export function chainIdFromSelector(selector: bigint): bigint {
  for (const id in SELECTORS) {
    if (SELECTORS[id].selector === selector) {
      return BigInt(id)
    }
  }
  throw new Error(`Selector not found: ${selector}`)
}

export async function getProviderNetwork(
  provider: Provider,
): Promise<{ chainId: number; chainSelector: bigint; name: string; isTestnet: boolean }> {
  // AbstractProvider.getNetwork() is cached
  const chainId = (await provider.getNetwork()).chainId
  const name = chainNameFromId(chainId)
  return {
    chainId: Number(chainId),
    chainSelector: chainSelectorFromId(chainId),
    name,
    isTestnet: !name.includes('-mainnet'),
  }
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
