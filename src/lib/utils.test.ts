import type { Network, Provider } from 'ethers'

import { CCIPContractType, CCIPVersion } from './types.js'
import {
  bigIntReplacer,
  bigIntReviver,
  blockRangeGenerator,
  chainIdFromName,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  chainSelectorFromId,
  getProviderNetwork,
  getSomeBlockNumberBefore,
  lazyCached,
  networkInfo,
  validateTypeAndVersion,
} from './utils.js'

let provider: jest.Mocked<Provider>

const mockedContract = {
  typeAndVersion: jest.fn(() => Promise.resolve(`${CCIPContractType.OnRamp} ${CCIPVersion.V1_2}`)),
  getStaticConfig: jest.fn(() => Promise.resolve({ chainSelector: 1 })),
  getAddress: jest.fn(() => '0x123'),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn((address, _2, runner) => ({
    ...mockedContract,
    runner,
    getAddress: jest.fn(() => address),
  })),
  // Interface: jest.fn(() => mockedInterface),
}))

beforeEach(() => {
  provider = {
    get provider() {
      return provider
    },
    getBlockNumber: jest.fn(),
    getBlock: jest.fn(),
    getNetwork: jest.fn(() => Promise.resolve({ chainId: 1n })),
  } as unknown as jest.Mocked<Provider>
})

describe('getSomeBlockNumberBefore', () => {
  it('should return a block number before the given timestamp', async () => {
    const avgBlockTime = 12
    const rand = Math.random() * (avgBlockTime - 1) + 1 // [1, 12[
    const now = Math.trunc(Date.now() / 1e3)
    const provider = {
      getBlockNumber: jest.fn(() => 15000),
      getBlock: jest.fn((num) => ({
        timestamp:
          now -
          (15000 - num) * avgBlockTime -
          Math.trunc(rand ** (num % avgBlockTime) % avgBlockTime),
      })),
    }

    const targetTs = now - avgBlockTime * 14200
    const blockNumber = await getSomeBlockNumberBefore(provider as unknown as Provider, targetTs)
    expect(blockNumber).toBeLessThanOrEqual(800)
    expect(blockNumber).toBeGreaterThanOrEqual(790)
    expect(provider.getBlock(blockNumber).timestamp).toBeLessThanOrEqual(targetTs)
  })
})

describe('lazyCached', () => {
  it('should cache and return the same value for a given key', () => {
    let value: Date | undefined
    const cache = new Map<string, unknown>()
    const factory = jest.fn(() => {
      const obj = new Date()
      if (!value) value = obj
      return obj
    })

    lazyCached('key', factory, cache)
    expect(value).toBeDefined()
    const result = lazyCached('key', factory, cache)
    expect(result).toBe(value)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})

describe('validateTypeAndVersion', () => {
  it('should return the type and version of the contract', async () => {
    const [type_, version] = await validateTypeAndVersion(provider, '0x123')
    expect(type_).toBe(CCIPContractType.OnRamp)
    expect(version).toBe(CCIPVersion.V1_2)
  })

  it('should return base version of -dev contracts', async () => {
    mockedContract.typeAndVersion.mockResolvedValueOnce(
      `${CCIPContractType.OffRamp} ${CCIPVersion.V1_5}-dev`,
    )
    const [type_, version] = await validateTypeAndVersion(provider, '0x124')
    expect(type_).toBe(CCIPContractType.OffRamp)
    expect(version).toBe(CCIPVersion.V1_5)
  })

  it('should throw on contracts not implementing interface', async () => {
    mockedContract.typeAndVersion.mockRejectedValueOnce({ code: 'BAD_DATA' })
    await expect(validateTypeAndVersion(provider, '0x125')).rejects.toThrow(
      '0x125 not a CCIP contract on "ethereum-mainnet"',
    )
  })
})

describe('chainNameFromId', () => {
  it('should return the chain name for a given id', () => {
    expect(chainNameFromId(1)).toBe('ethereum-mainnet')
  })
})

describe('chainSelectorFromId', () => {
  it('should return the chain selector for a given id', () => {
    expect(chainSelectorFromId(1)).toBe(5009297550715157269n)
  })
})

describe('chainIdFromSelector', () => {
  it('should return the chain id for a given selector', () => {
    expect(chainIdFromSelector(5009297550715157269n)).toBe(1)
  })
})

describe('chainNameFromSelector', () => {
  it('should return the chain name for a given selector', () => {
    expect(chainNameFromSelector(5009297550715157269n)).toBe('ethereum-mainnet')
  })
})

describe('chainIdFromName', () => {
  it('should return the chain id for a given name', () => {
    expect(chainIdFromName('ethereum-mainnet')).toBe(1)
  })
})

describe('networkInfo', () => {
  it('should return the network info for a given selector or id', () => {
    expect(networkInfo(1)).toEqual({
      chainId: 1,
      chainSelector: 5009297550715157269n,
      name: 'ethereum-mainnet',
      isTestnet: false,
    })

    expect(networkInfo(3478487238524512106n)).toEqual({
      chainId: 421614,
      chainSelector: 3478487238524512106n,
      name: 'ethereum-testnet-sepolia-arbitrum-1',
      isTestnet: true,
    })
  })
})

describe('getProviderNetwork', () => {
  it('should return the network info for the provider', async () => {
    provider.getNetwork.mockResolvedValue({ chainId: 1n } as Network)

    const info = await getProviderNetwork(provider)
    expect(info).toEqual({
      chainId: 1,
      chainSelector: 5009297550715157269n,
      name: 'ethereum-mainnet',
      isTestnet: false,
    })
  })
})

describe('blockRangeGenerator', () => {
  it('should generate block ranges backwards', () => {
    const ranges = Array.from(blockRangeGenerator({ endBlock: 100 }, 10))
    expect(ranges).toEqual([
      { fromBlock: 91, toBlock: 100 },
      { fromBlock: 81, toBlock: 90 },
      { fromBlock: 71, toBlock: 80 },
      { fromBlock: 61, toBlock: 70 },
      { fromBlock: 51, toBlock: 60 },
      { fromBlock: 41, toBlock: 50 },
      { fromBlock: 31, toBlock: 40 },
      { fromBlock: 21, toBlock: 30 },
      { fromBlock: 11, toBlock: 20 },
      { fromBlock: 1, toBlock: 10 },
    ])
  })

  it('should generate block ranges forwards', () => {
    const ranges = Array.from(blockRangeGenerator({ startBlock: 54, endBlock: 100 }, 10))
    expect(ranges).toEqual([
      { fromBlock: 54, toBlock: 63 },
      { fromBlock: 64, toBlock: 73 },
      { fromBlock: 74, toBlock: 83 },
      { fromBlock: 84, toBlock: 93 },
      { fromBlock: 94, toBlock: 100 },
    ])
  })

  it('should generate single block range', () => {
    const ranges = Array.from(blockRangeGenerator({ singleBlock: 17 }, 10))
    expect(ranges).toEqual([{ fromBlock: 17, toBlock: 17 }])
  })
})

describe('bigIntReplacer', () => {
  it('should replace bigint with string', () => {
    const obj = { value: 1n }
    const json = JSON.stringify(obj, bigIntReplacer)
    expect(json).toBe('{"value":"1"}')
  })
})

describe('bigIntReviver', () => {
  it('should revive string to bigint', () => {
    const json = '{"value":"1"}'
    const obj = JSON.parse(json, bigIntReviver)
    expect(obj).toEqual({ value: 1n })
  })
})
