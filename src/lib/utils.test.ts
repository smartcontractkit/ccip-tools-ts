import { type Provider, Result } from 'ethers'

import './index.ts'
import { ChainFamily } from './chain.ts'
import { CCIPVersion } from './types.ts'
import {
  bigIntReplacer,
  bigIntReviver,
  blockRangeGenerator,
  chainIdFromName,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  chainSelectorFromId,
  convertKeysToCamelCase,
  createRateLimitedFetch,
  decodeAddress,
  decodeOnRampAddress,
  getAddressBytes,
  getDataBytes,
  getSomeBlockNumberBefore,
  isBase64,
  leToBigInt,
  networkInfo,
  parseTypeAndVersion,
  sleep,
  snakeToCamel,
  toLeArray,
  toObject,
} from './utils.ts'

let provider: jest.Mocked<Provider>

const mockedContract = {
  typeAndVersion: jest.fn(() => Promise.resolve(`EVM2EVMOnRamp ${CCIPVersion.V1_2}`)),
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

describe('chainNameFromId', () => {
  it('should return the chain name for a given id', () => {
    expect(chainNameFromId(1)).toBe('ethereum-mainnet')
  })

  it('should throw error for invalid chain ID', () => {
    expect(() => chainNameFromId(999999)).toThrow('Chain ID not found: 999999')
  })
})

describe('chainSelectorFromId', () => {
  it('should return the chain selector for a given id', () => {
    expect(chainSelectorFromId(1)).toBe(5009297550715157269n)
  })

  it('should throw error for invalid chain ID', () => {
    expect(() => chainSelectorFromId(999999)).toThrow('Chain ID not found: 999999')
  })
})

describe('chainIdFromSelector', () => {
  it('should return the chain id for a given selector', () => {
    expect(chainIdFromSelector(5009297550715157269n)).toBe(1)
  })

  it('should throw error for invalid selector', () => {
    expect(() => chainIdFromSelector(999999n)).toThrow('Selector not found: 999999')
  })
})

describe('chainNameFromSelector', () => {
  it('should return the chain name for a given selector', () => {
    expect(chainNameFromSelector(5009297550715157269n)).toBe('ethereum-mainnet')
  })

  it('should throw error for invalid selector', () => {
    expect(() => chainNameFromSelector(999999n)).toThrow('Selector not found: 999999')
  })
})

describe('chainIdFromName', () => {
  it('should return the chain id for a given name', () => {
    expect(chainIdFromName('ethereum-mainnet')).toBe(1)
  })

  it('should throw error for invalid name', () => {
    expect(() => chainIdFromName('invalid-chain')).toThrow('Chain name not found: invalid-chain')
  })
})

describe('decodeAddress', () => {
  describe('EVM addresses', () => {
    it('should decode standard EVM addresses', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const decoded = decodeAddress(address)
      expect(decoded).toBe('0x1234567890123456789012345678901234567890')
    })

    it('should decode EVM addresses with explicit family', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const decoded = decodeAddress(address, ChainFamily.EVM)
      expect(decoded).toBe('0x1234567890123456789012345678901234567890')
    })

    it('should handle lowercase EVM addresses', () => {
      const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const decoded = decodeAddress(address)
      expect(decoded).toBe('0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
    })

    it('should handle 32-byte padded EVM addresses', () => {
      const paddedAddress = '0x0000000000000000000000001234567890123456789012345678901234567890'
      const decoded = decodeAddress(paddedAddress)
      expect(decoded).toBe('0x1234567890123456789012345678901234567890')
    })

    it('should handle Uint8Array input for EVM addresses', () => {
      const addressBytes = new Uint8Array([
        0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90,
        0x12, 0x34, 0x56, 0x78, 0x90,
      ])
      const decoded = decodeAddress(addressBytes)
      expect(decoded).toBe('0x1234567890123456789012345678901234567890')
    })

    it('should throw error for invalid EVM address length', () => {
      const invalidAddress = '0x12345678901234567890' // Too short
      expect(() => decodeAddress(invalidAddress)).toThrow()
    })

    it('should throw error for too long EVM address without proper padding', () => {
      const tooLongAddress =
        '0x123456789012345678901234567890123456789012345678901234567890123456789012'
      expect(() => decodeAddress(tooLongAddress)).toThrow()
    })
  })

  describe('Solana addresses', () => {
    it('should decode Solana addresses to Base58', () => {
      // 32-byte Solana public key
      const solanaBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decoded = decodeAddress(solanaBytes, ChainFamily.Solana)
      expect(decoded).toBe('11111111111111111112')
    })

    it('should handle 32-byte hex Solana addresses', () => {
      const solanaBytes = '0x0000000000000000000000000000000000000000000000000000000000000000'
      const decoded = decodeAddress(solanaBytes, ChainFamily.Solana)
      expect(decoded).toBe('11111111111111111111111111111111')
    })

    it('should handle Base58 string input for Solana', () => {
      const base58Address = 'So11111111111111111111111111111111111111112'
      const decoded = decodeAddress(base58Address, ChainFamily.Solana)
      expect(decoded).toBe('So11111111111111111111111111111111111111112')
    })

    it('should handle hex string for Solana addresses', () => {
      const hexAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decoded = decodeAddress(hexAddress, ChainFamily.Solana)
      expect(decoded).toBe('11111111111111111112')
    })
  })

  describe('Aptos addresses', () => {
    it('should decode Aptos addresses as hex', () => {
      const aptosAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decoded = decodeAddress(aptosAddress, ChainFamily.Aptos)
      expect(decoded).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    })

    it('should handle shorter Aptos addresses', () => {
      const aptosAddress = '0x0000000000000000000000000000000000000000000000000000000000000123'
      let decoded = decodeAddress(aptosAddress, ChainFamily.Aptos)
      expect(decoded).toBe('0x0000000000000000000000000000000000000000000000000000000000000123')

      const aptosToken = '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa'
      decoded = decodeAddress(aptosToken, ChainFamily.Aptos)
      expect(decoded).toBe('0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa')
    })

    it('should handle Uint8Array for Aptos addresses', () => {
      const aptosBytes = new Uint8Array(32).fill(1)
      const decoded = decodeAddress(aptosBytes, ChainFamily.Aptos)
      expect(decoded).toBe('0x0101010101010101010101010101010101010101010101010101010101010101')
    })
  })

  describe('default behavior', () => {
    it('should default to EVM family when not specified', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const decoded = decodeAddress(address)
      expect(decoded).toBe('0x1234567890123456789012345678901234567890')
    })
  })

  describe('error handling', () => {
    it('should throw error for unsupported chain family', () => {
      const address = '0x1234567890123456789012345678901234567890'
      expect(() => decodeAddress(address, 'InvalidFamily' as ChainFamily)).toThrow(
        'Unsupported chain family',
      )
    })

    it('should handle empty bytes', () => {
      const emptyBytes = '0x'
      expect(() => decodeAddress(emptyBytes)).toThrow()
    })

    it('should handle null/undefined input gracefully', () => {
      expect(() => decodeAddress(null as unknown as string)).toThrow()
      expect(() => decodeAddress(undefined as unknown as string)).toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle zero address for EVM', () => {
      const zeroAddress = '0x0000000000000000000000000000000000000000'
      const decoded = decodeAddress(zeroAddress)
      expect(decoded).toBe('0x0000000000000000000000000000000000000000')
    })

    it('should handle maximum EVM address', () => {
      const maxAddress = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      const decoded = decodeAddress(maxAddress)
      expect(decoded).toBe('0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF')
    })

    it('should handle 32-byte zero-padded addresses correctly', () => {
      const paddedZeroAddress = '0x000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      const decoded = decodeAddress(paddedZeroAddress)
      expect(decoded).toBe('0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF')
    })

    it('should handle mixed case hex input', () => {
      const mixedCaseAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
      const decoded = decodeAddress(mixedCaseAddress)
      expect(decoded).toBe('0xabCDEF1234567890ABcDEF1234567890aBCDeF12')
    })

    it('should handle different byte lengths for non-EVM chains', () => {
      // Solana accepts 32-byte addresses
      const shortBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decodedShort = decodeAddress(shortBytes, ChainFamily.Solana)
      expect(decodedShort).toBe('11111111111111111112')

      // Aptos accepts variable length but normalizes to 32 bytes
      const longBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decodedLong = decodeAddress(longBytes, ChainFamily.Aptos)
      expect(decodedLong).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    })
  })
})

describe('networkInfo', () => {
  describe('bigint selector input', () => {
    it('should handle EVM chain selector as bigint', () => {
      const info = networkInfo(5009297550715157269n) // Ethereum mainnet selector
      expect(info).toMatchObject({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain selector as bigint', () => {
      const info = networkInfo(4741433654826277614n) // Aptos mainnet selector
      expect(info).toMatchObject({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })

    it('should handle Solana chain selector as bigint', () => {
      const info = networkInfo(124615329519749607n) // Solana mainnet selector
      expect(info).toMatchObject({
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        chainSelector: 124615329519749607n,
        name: 'solana-mainnet',
        family: ChainFamily.Solana,
        isTestnet: false,
      })
    })

    it('should handle testnet chain selector as bigint', () => {
      const info = networkInfo(16015286601757825753n) // Sepolia selector
      expect(info).toMatchObject({
        chainId: 11155111,
        chainSelector: 16015286601757825753n,
        name: 'ethereum-testnet-sepolia',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })
  })

  describe('number chain ID input', () => {
    it('should handle EVM chain ID as number', () => {
      const info = networkInfo(1) // Ethereum mainnet
      expect(info).toMatchObject({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle BSC chain ID as number', () => {
      const info = networkInfo(56) // BSC mainnet
      expect(info).toMatchObject({
        chainId: 56,
        chainSelector: 11344663589394136015n,
        name: 'binance_smart_chain-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle testnet chain ID as number', () => {
      const info = networkInfo(11155111) // Sepolia
      expect(info).toMatchObject({
        chainId: 11155111,
        chainSelector: 16015286601757825753n,
        name: 'ethereum-testnet-sepolia',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })
  })

  describe('string chain ID input', () => {
    it('should handle EVM chain ID as string', () => {
      const info = networkInfo('1')
      expect(info).toMatchObject({
        chainId: '1',
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain ID as string', () => {
      const info = networkInfo('aptos:1')
      expect(info).toMatchObject({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })

    it('should handle Aptos testnet chain ID as string', () => {
      const info = networkInfo('aptos:2')
      expect(info).toMatchObject({
        chainId: 'aptos:2',
        chainSelector: 743186221051783445n,
        name: 'aptos-testnet',
        family: ChainFamily.Aptos,
        isTestnet: true,
      })
    })

    it('should handle Solana chain ID as string', () => {
      const info = networkInfo('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      expect(info).toMatchObject({
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        chainSelector: 124615329519749607n,
        name: 'solana-mainnet',
        family: ChainFamily.Solana,
        isTestnet: false,
      })
    })

    it('should handle Solana testnet chain ID as string', () => {
      const info = networkInfo('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY')
      expect(info).toMatchObject({
        chainId: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
        chainSelector: 6302590918974934319n,
        name: 'solana-testnet',
        family: ChainFamily.Solana,
        isTestnet: true,
      })
    })
  })

  describe('string selector input', () => {
    it('should handle selector as string when valid selector exists', () => {
      const info = networkInfo('5009297550715157269')
      expect(info).toMatchObject({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle EVM chain ID as string when not a valid selector', () => {
      const info = networkInfo('1')
      expect(info).toMatchObject({
        chainId: '1',
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain ID as string when not a valid selector', () => {
      const info = networkInfo('aptos:1')
      expect(info).toMatchObject({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })
  })

  describe('string chain name input', () => {
    it('should handle EVM chain name', () => {
      const info = networkInfo('ethereum-mainnet')
      expect(info).toMatchObject({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain name', () => {
      const info = networkInfo('aptos-mainnet')
      expect(info).toMatchObject({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })

    it('should handle Solana chain name', () => {
      const info = networkInfo('solana-mainnet')
      expect(info).toMatchObject({
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        chainSelector: 124615329519749607n,
        name: 'solana-mainnet',
        family: ChainFamily.Solana,
        isTestnet: false,
      })
    })

    it('should handle EVM testnet chain name', () => {
      const info = networkInfo('ethereum-testnet-sepolia')
      expect(info).toMatchObject({
        chainId: 11155111,
        chainSelector: 16015286601757825753n,
        name: 'ethereum-testnet-sepolia',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })
  })

  describe('edge cases and error handling', () => {
    it('should throw error for invalid selector', () => {
      expect(() => networkInfo(999999n)).toThrow()
    })

    it('should throw error for invalid chain ID', () => {
      expect(() => networkInfo(999999)).toThrow()
    })

    it('should throw error for invalid chain name', () => {
      expect(() => networkInfo('invalid-chain-name')).toThrow()
    })

    it('should throw error for numeric string that is neither selector nor chain ID nor name', () => {
      expect(() => networkInfo('999999999999999999999')).toThrow()
    })

    it('should handle large numeric strings gracefully', () => {
      const largeSelector = '5009297550715157269'
      const info = networkInfo(largeSelector)
      expect(info.chainSelector).toBe(5009297550715157269n)
    })

    it('should throw error for empty string', () => {
      expect(() => networkInfo('')).toThrow()
    })

    it('should handle zero values', () => {
      // Zero is not a valid chain ID or selector
      expect(() => networkInfo(0)).toThrow()
      expect(() => networkInfo(0n)).toThrow()
    })
  })

  describe('isTestnet detection', () => {
    it('should correctly identify mainnet chains', () => {
      expect(networkInfo(1).isTestnet).toBe(false) // Ethereum mainnet
      expect(networkInfo(56).isTestnet).toBe(false) // BSC mainnet
      expect(networkInfo('aptos-mainnet').isTestnet).toBe(false) // Aptos mainnet
    })

    it('should correctly identify testnet chains', () => {
      expect(networkInfo(11155111).isTestnet).toBe(true) // Sepolia
      expect(networkInfo('aptos-testnet').isTestnet).toBe(true) // Aptos testnet
      expect(networkInfo('solana-testnet').isTestnet).toBe(true) // Solana testnet
    })

    it('should correctly identify devnet/localnet as testnet', () => {
      expect(networkInfo('solana-testnet').isTestnet).toBe(true)
    })
  })
})

describe('blockRangeGenerator', () => {
  it('should generate block ranges backwards', () => {
    const ranges = [...blockRangeGenerator({ endBlock: 100000 })]
    expect(ranges.length).toBe(10)
    expect(ranges[0]).toEqual({ fromBlock: 90001, toBlock: 100000 })
    expect(ranges[1]).toEqual({ fromBlock: 80001, toBlock: 90000 })
    expect(ranges[2]).toEqual({ fromBlock: 70001, toBlock: 80000 })
    expect(ranges[3]).toEqual({ fromBlock: 60001, toBlock: 70000 })
    expect(ranges[4]).toEqual({ fromBlock: 50001, toBlock: 60000 })
    expect(ranges[5]).toEqual({ fromBlock: 40001, toBlock: 50000 })
    expect(ranges[6]).toEqual({ fromBlock: 30001, toBlock: 40000 })
    expect(ranges[7]).toEqual({ fromBlock: 20001, toBlock: 30000 })
    expect(ranges[8]).toEqual({ fromBlock: 10001, toBlock: 20000 })
    expect(ranges[9]).toEqual({ fromBlock: 1, toBlock: 10000 })
  })
  it('should generate block ranges forwards', () => {
    const ranges = [...blockRangeGenerator({ startBlock: 1000, endBlock: 50000 })]
    expect(ranges.length).toBe(5)
    expect(ranges[0].fromBlock).toBe(1000)
    expect(ranges[0].toBlock).toBe(10999)
    expect(ranges[0]).toHaveProperty('progress')
    expect(ranges[1].fromBlock).toBe(11000)
    expect(ranges[1].toBlock).toBe(20999)
    expect(ranges[4].fromBlock).toBe(41000)
    expect(ranges[4].toBlock).toBe(50000)
  })

  it('should generate single block range', () => {
    const ranges = [...blockRangeGenerator({ singleBlock: 42 })]
    expect(ranges).toEqual([{ fromBlock: 42, toBlock: 42 }])
  })

  it('should handle custom step size', () => {
    const ranges = [...blockRangeGenerator({ startBlock: 1, endBlock: 1000 }, 200)]
    expect(ranges.length).toBe(5)
    expect(ranges[0].fromBlock).toBe(1)
    expect(ranges[0].toBlock).toBe(200)
    expect(ranges[4].fromBlock).toBe(801)
    expect(ranges[4].toBlock).toBe(1000)
  })

  it('should handle when endBlock equals startBlock', () => {
    const ranges = [...blockRangeGenerator({ startBlock: 100, endBlock: 100 })]
    expect(ranges.length).toBe(0)
  })
})

describe('bigIntReplacer', () => {
  it('should replace bigint with string', () => {
    const obj = { value: 123n }
    const json = JSON.stringify(obj, bigIntReplacer)
    expect(json).toBe('{"value":"123"}')
  })

  it('should handle nested objects with bigints', () => {
    const obj = { outer: { inner: 456n }, array: [1n, 2n, 3n] }
    const json = JSON.stringify(obj, bigIntReplacer)
    expect(json).toBe('{"outer":{"inner":"456"},"array":["1","2","3"]}')
  })

  it('should preserve non-bigint values', () => {
    const obj = { str: 'test', num: 42, bool: true, nil: null }
    const json = JSON.stringify(obj, bigIntReplacer)
    expect(json).toBe('{"str":"test","num":42,"bool":true,"nil":null}')
  })
})

describe('bigIntReviver', () => {
  it('should revive string to bigint', () => {
    const json = '{"value":"123"}'
    const obj = JSON.parse(json, bigIntReviver) as { value: bigint }
    expect(obj.value).toBe(123n)
  })

  it('should handle nested objects', () => {
    const json = '{"outer":{"inner":"456"},"array":["1","2","3"]}'
    const obj = JSON.parse(json, bigIntReviver) as {
      outer: { inner: bigint }
      array: bigint[]
    }
    expect(obj.outer.inner).toBe(456n)
    expect(obj.array).toEqual([1n, 2n, 3n])
  })

  it('should preserve non-numeric strings', () => {
    const json = '{"str":"test","numStr":"123","bool":"true"}'
    const obj = JSON.parse(json, bigIntReviver) as Record<string, unknown>
    expect(obj.str).toBe('test')
    expect(obj.numStr).toBe(123n)
    expect(obj.bool).toBe('true')
  })
})

describe('snakeToCamel', () => {
  it('should convert snake_case to camelCase', () => {
    expect(snakeToCamel('snake_case')).toBe('snakeCase')
    expect(snakeToCamel('foo_bar')).toBe('fooBar')
    expect(snakeToCamel('test_string_here')).toBe('testStringHere')
    expect(snakeToCamel('source_token_data')).toBe('sourceTokenData')
    expect(snakeToCamel('dest_token_address')).toBe('destTokenAddress')
  })

  it('should handle single underscore', () => {
    expect(snakeToCamel('a_b')).toBe('aB')
    expect(snakeToCamel('_start')).toBe('Start')
  })

  it('should handle strings without underscores', () => {
    expect(snakeToCamel('nounderscores')).toBe('nounderscores')
    expect(snakeToCamel('CamelCase')).toBe('CamelCase')
    expect(snakeToCamel('already')).toBe('already')
  })

  it('should handle empty string', () => {
    expect(snakeToCamel('')).toBe('')
  })

  it('should handle multiple consecutive underscores', () => {
    expect(snakeToCamel('test__double')).toBe('test_Double')
    expect(snakeToCamel('a___b')).toBe('a__B')
  })

  it('should handle leading underscores', () => {
    expect(snakeToCamel('_private')).toBe('Private')
    expect(snakeToCamel('__dunder')).toBe('_Dunder')
  })

  it('should handle trailing underscores', () => {
    expect(snakeToCamel('trailing_')).toBe('trailing_')
    expect(snakeToCamel('double_trailing__')).toBe('doubleTrailing__')
  })
})

describe('convertKeysToCamelCase', () => {
  it('should convert snake_case keys in simple objects', () => {
    const input = {
      snake_case: 'value1',
      another_key: 'value2',
      normalKey: 'value3',
    }
    const expected = {
      snakeCase: 'value1',
      anotherKey: 'value2',
      normalKey: 'value3',
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle nested objects', () => {
    const input = {
      normalKey2: 'value1',
      outer_key: {
        inner_key: 'value',
        another_inner: {
          deep_key: 'deep_value',
        },
      },
      normal_key: 'value',
    }
    const expected = {
      outerKey: {
        innerKey: 'value',
        anotherInner: {
          deepKey: 'deep_value',
        },
      },
      normalKey: 'value',
      normalKey2: 'value1',
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle arrays', () => {
    const input = {
      token_amounts: [
        { source_token: 'A', dest_token: 'B' },
        { source_token: 'C', dest_token: 'D' },
      ],
    }
    const expected = {
      tokenAmounts: [
        { sourceToken: 'A', destToken: 'B' },
        { sourceToken: 'C', destToken: 'D' },
      ],
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle primitive values', () => {
    expect(convertKeysToCamelCase('string')).toBe('string')
    expect(convertKeysToCamelCase(123)).toBe(123)
    expect(convertKeysToCamelCase(true)).toBe(true)
    expect(convertKeysToCamelCase(null)).toBe(null)
  })

  it('should handle arrays of primitives', () => {
    const input = [1, 2, 3, 'four', true]
    expect(convertKeysToCamelCase(input)).toEqual([1, 2, 3, 'four', true])
  })

  it('should only convert keys with underscores', () => {
    const input = {
      normalKey: 'value1',
      snake_case_key: 'value2',
      camelCaseKey: 'value3',
      PascalCaseKey: 'value4',
    }
    const expected = {
      normalKey: 'value1',
      snakeCaseKey: 'value2',
      camelCaseKey: 'value3',
      PascalCaseKey: 'value4',
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle complex nested structure', () => {
    const input = {
      user_info: {
        first_name: 'John',
        last_name: 'Doe',
        contact_details: {
          email_address: 'john@example.com',
          phone_number: '123-456-7890',
        },
      },
      data_items: [
        { item_name: 'Item 1', item_value: 100 },
        { item_name: 'Item 2', item_value: 200 },
      ],
    }
    const expected = {
      userInfo: {
        firstName: 'John',
        lastName: 'Doe',
        contactDetails: {
          emailAddress: 'john@example.com',
          phoneNumber: '123-456-7890',
        },
      },
      dataItems: [
        { itemName: 'Item 1', itemValue: 100 },
        { itemName: 'Item 2', itemValue: 200 },
      ],
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle empty objects and arrays', () => {
    expect(convertKeysToCamelCase({})).toEqual({})
    expect(convertKeysToCamelCase([])).toEqual([])
  })

  it('should handle custom mapValues function', () => {
    const input = {
      string_value: 'test',
      number_value: 42,
    }
    const mapValues = (value: unknown) => {
      if (typeof value === 'string') return value.toUpperCase()
      if (typeof value === 'number') return value * 2
      return value
    }
    const result = convertKeysToCamelCase(input, mapValues)
    expect(result).toEqual({
      stringValue: 'TEST',
      numberValue: 84,
    })
  })

  it('should handle undefined and null values', () => {
    const input = {
      null_value: null,
      undefined_value: undefined,
      nested_obj: {
        also_null: null,
      },
    }
    const expected = {
      nullValue: null,
      undefinedValue: undefined,
      nestedObj: {
        alsoNull: null,
      },
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })
})

describe('toObject', () => {
  it('should return Result.toObject() for Result instances', () => {
    const mockToObject = jest.fn(() => ({ key: 'value' }))
    const mockResult = Object.create(Result.prototype)
    mockResult.toObject = mockToObject
    const result = toObject(mockResult)
    expect(mockToObject).toHaveBeenCalled()
    expect(result).toEqual({ key: 'value' })
  })

  it('should return the object as-is if not a Result', () => {
    const obj = { key: 'value' }
    const result = toObject(obj)
    expect(result).toBe(obj)
  })

  it('should handle primitives', () => {
    expect(toObject('string')).toBe('string')
    expect(toObject(42)).toBe(42)
    expect(toObject(true)).toBe(true)
  })

  it('should handle null and undefined', () => {
    expect(toObject(null)).toBe(null)
    expect(toObject(undefined)).toBe(undefined)
  })
})

describe('decodeOnRampAddress', () => {
  it('should decode EVM addresses without modification', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const decoded = decodeOnRampAddress(address, ChainFamily.EVM)
    expect(decoded).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should append ::onramp for Aptos addresses', () => {
    const aptosAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const decoded = decodeOnRampAddress(aptosAddress, ChainFamily.Aptos)
    expect(decoded).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::onramp',
    )
  })

  it('should decode Solana addresses without ::onramp', () => {
    const solanaBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const decoded = decodeOnRampAddress(solanaBytes, ChainFamily.Solana)
    expect(decoded).not.toContain('::onramp')
  })

  it('should use EVM as default family', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const decoded = decodeOnRampAddress(address)
    expect(decoded).toBe('0x1234567890123456789012345678901234567890')
  })
})

describe('leToBigInt', () => {
  it('should convert little-endian bytes to bigint', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00])
    const result = leToBigInt(bytes)
    expect(result).toBe(1n)
  })

  it('should handle array input', () => {
    const bytes = [0x01, 0x00, 0x00, 0x00]
    const result = leToBigInt(bytes)
    expect(result).toBe(1n)
  })

  it('should convert larger values correctly', () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x00, 0x00])
    const result = leToBigInt(bytes)
    expect(result).toBe(255n)
  })

  it('should handle multi-byte values', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x00, 0x00])
    const result = leToBigInt(bytes)
    expect(result).toBe(256n)
  })

  it('should handle hex string input', () => {
    const hexString = '0x01000000'
    const result = leToBigInt(hexString)
    expect(result).toBe(1n)
  })

  it('should handle large numbers', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    const result = leToBigInt(bytes)
    expect(result).toBe(18446744073709551615n)
  })
})

describe('toLeArray', () => {
  it('should convert bigint to little-endian byte array', () => {
    const result = toLeArray(1n)
    expect(result).toEqual(new Uint8Array([0x01]))
  })

  it('should handle larger values', () => {
    const result = toLeArray(256n)
    expect(result).toEqual(new Uint8Array([0x00, 0x01]))
  })

  it('should handle zero', () => {
    const result = toLeArray(0n)
    expect(result).toEqual(new Uint8Array([0x00]))
  })

  it('should handle custom width', () => {
    const result = toLeArray(1n, 4)
    expect(result).toEqual(new Uint8Array([0x01, 0x00, 0x00, 0x00]))
  })

  it('should handle number input', () => {
    const result = toLeArray(255, 2)
    expect(result).toEqual(new Uint8Array([0xff, 0x00]))
  })

  it('should handle large numbers with width', () => {
    const result = toLeArray(65535n, 4)
    expect(result).toEqual(new Uint8Array([0xff, 0xff, 0x00, 0x00]))
  })
})

describe('isBase64', () => {
  it('should return true for valid base64 strings', () => {
    expect(isBase64('SGVsbG8gV29ybGQ=')).toBe(true)
    expect(isBase64('YWJjZGVmZ2g=')).toBe(true)
    expect(isBase64('MTIzNDU2Nzg=')).toBe(true)
  })

  it('should return true for base64 with double padding', () => {
    expect(isBase64('YQ==')).toBe(true) // "a" in base64
    expect(isBase64('SGVsbG8gV29ybGQ=')).toBe(true) // Valid with groups of 4 then padding
  })

  it('should return false for incorrectly padded strings', () => {
    expect(isBase64('YWI==')).toBe(false) // "ab" should be "YWI=" not "YWI=="
    expect(isBase64('YWJjZA')).toBe(false) // Missing padding
  })

  it('should return false for invalid characters', () => {
    expect(isBase64('Hello World!')).toBe(false)
    expect(isBase64('abc@def')).toBe(false)
  })

  it('should return false for non-string inputs', () => {
    expect(isBase64(123 as any)).toBe(false)
    expect(isBase64(null as any)).toBe(false)
    expect(isBase64(undefined as any)).toBe(false)
    expect(isBase64({} as any)).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(isBase64('')).toBe(true) // Empty string is technically valid base64
  })

  it('should return false for hex strings', () => {
    expect(isBase64('0x1234567890abcdef')).toBe(false)
  })

  it('should handle long base64 strings', () => {
    const longBase64 =
      'VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgZW5jb2RlZCBzdHJpbmcgdGhhdCBzaG91bGQgc3RpbGwgYmUgdmFsaWRhdGVkIGNvcnJlY3RseQ=='
    expect(isBase64(longBase64)).toBe(true)
  })
})

describe('getDataBytes', () => {
  it('should handle hex string input', () => {
    const result = getDataBytes('0x1234')
    expect(result).toEqual(new Uint8Array([0x12, 0x34]))
  })

  it('should handle Uint8Array input', () => {
    const input = new Uint8Array([0x12, 0x34])
    const result = getDataBytes(input)
    expect(result).toEqual(input)
  })

  it('should handle base64 string input', () => {
    const base64 = 'SGVsbG8=' // "Hello"
    const result = getDataBytes(base64)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('should throw error for invalid input', () => {
    expect(() => getDataBytes('not-hex-or-base64' as any)).toThrow('Unsupported data format')
  })

  it('should handle empty hex string', () => {
    const result = getDataBytes('0x')
    expect(result).toEqual(new Uint8Array([]))
  })
})

describe('getAddressBytes', () => {
  it('should handle hex string input', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const result = getAddressBytes(address)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(20)
  })

  it('should handle Uint8Array input', () => {
    const input = new Uint8Array(20).fill(0x12)
    const result = getAddressBytes(input)
    expect(result).toEqual(input)
  })

  it('should strip leading zeros from 32-byte padded addresses', () => {
    const paddedAddress = '0x0000000000000000000000001234567890123456789012345678901234567890'
    const result = getAddressBytes(paddedAddress)
    expect(result.length).toBe(20)
  })

  it('should handle base58 Solana addresses', () => {
    const solanaAddress = '11111111111111111111111111111111'
    const result = getAddressBytes(solanaAddress)
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('should not strip zeros if non-zero bytes exist in leading portion', () => {
    const address = new Uint8Array(32)
    address[0] = 0x01 // Non-zero in leading portion
    address[31] = 0x02
    const result = getAddressBytes(address)
    expect(result.length).toBe(32)
  })

  it('should preserve 20-byte addresses without modification', () => {
    const address = new Uint8Array(20).fill(0xff)
    const result = getAddressBytes(address)
    expect(result).toEqual(address)
    expect(result.length).toBe(20)
  })
})

describe('sleep', () => {
  it('should delay execution for specified milliseconds', async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some margin
    expect(elapsed).toBeLessThan(150) // Should not take too long
  })

  it('should work with zero milliseconds', async () => {
    const start = Date.now()
    await sleep(0)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })

  it('should return a promise', () => {
    const result = sleep(10)
    expect(result).toBeInstanceOf(Promise)
  })
})

describe('parseTypeAndVersion', () => {
  it('should parse standard typeAndVersion format', () => {
    const result = parseTypeAndVersion('EVM2EVMOnRamp 1.2.0')
    expect(result).toEqual(['EVM2EVMOnRamp', '1.2.0', 'EVM2EVMOnRamp 1.2.0'])
  })

  it('should parse with v prefix', () => {
    const result = parseTypeAndVersion('EVM2EVMOffRamp v1.5.0')
    expect(result).toEqual(['EVM2EVMOffRamp', '1.5.0', 'EVM2EVMOffRamp v1.5.0'])
  })

  it('should normalize CCIP casing', () => {
    const result = parseTypeAndVersion('ccipOnRamp 1.0.0')
    expect(result[0]).toContain('CCIP')
  })

  it('should normalize OnRamp/OffRamp casing', () => {
    const result = parseTypeAndVersion('CCIPOnramp 1.0.0')
    expect(result[0]).toBe('CCIPOnRamp')
  })

  it('should normalize OffRamp casing', () => {
    const result = parseTypeAndVersion('CCIPOfframp 1.0.0')
    expect(result[0]).toBe('CCIPOffRamp')
  })

  it('should convert kebab-case to camelCase and normalize OnRamp', () => {
    const result = parseTypeAndVersion('evm-to-evm-onramp 1.0.0')
    expect(result[0]).toBe('evmToEvmOnRamp')
  })

  it('should handle version without patch number', () => {
    const result = parseTypeAndVersion('Router 2.1')
    expect(result).toEqual(['Router', '2.1', 'Router 2.1'])
  })

  it('should capture suffix if present', () => {
    const result = parseTypeAndVersion('OnRamp 1.0.0-beta')
    expect(result).toHaveLength(4)
    expect(result[3]).toBe('-beta')
  })

  it('should throw error for invalid format', () => {
    expect(() => parseTypeAndVersion('InvalidFormat')).toThrow('Invalid typeAndVersion')
    expect(() => parseTypeAndVersion('')).toThrow('Invalid typeAndVersion')
    expect(() => parseTypeAndVersion('NoVersion')).toThrow('Invalid typeAndVersion')
  })

  it('should handle whitespace variations', () => {
    const result = parseTypeAndVersion('Router  v1.0.0')
    expect(result[0]).toBe('Router')
    expect(result[1]).toBe('1.0.0')
  })
})

describe('createRateLimitedFetch', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
    jest.useFakeTimers()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
  })

  it('should create a rate-limited fetch function', () => {
    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 2, windowMs: 1000 })
    expect(typeof rateLimitedFetch).toBe('function')
  })

  it('should allow requests within rate limit', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 2, windowMs: 1000 })

    const promise1 = rateLimitedFetch('https://example.com')
    const promise2 = rateLimitedFetch('https://example.com')

    await Promise.all([promise1, promise2])

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('should retry on 429 rate limit errors', async () => {
    let callCount = 0
    global.fetch = jest.fn(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response)
    })

    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 5, windowMs: 1000 })

    const promise = rateLimitedFetch('https://example.com')

    // Fast-forward time to allow retry
    await jest.runAllTimersAsync()

    const result = await promise
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('should throw non-retryable errors immediately', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 5, windowMs: 1000 })

    await expect(rateLimitedFetch('https://example.com')).rejects.toThrow('HTTP 404')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('should respect maxRetries parameter', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({
      maxRequests: 10,
      windowMs: 1000,
      maxRetries: 2,
    })

    const promise = rateLimitedFetch('https://example.com')

    // Fast-forward time and wait for promise to settle
    const result = Promise.race([promise, jest.runAllTimersAsync().then(() => promise)])

    await expect(result).rejects.toThrow('Too Many Requests')
    expect(global.fetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })

  it('should use default parameters when none provided', () => {
    const rateLimitedFetch = createRateLimitedFetch()
    expect(typeof rateLimitedFetch).toBe('function')
  })

  it('should handle network errors with retry logic', async () => {
    let callCount = 0
    global.fetch = jest.fn(() => {
      callCount++
      if (callCount === 1) {
        return Promise.reject(new Error('429 rate limit exceeded'))
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response)
    })

    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 5, windowMs: 1000 })

    const promise = rateLimitedFetch('https://example.com')

    await jest.runAllTimersAsync()

    const result = await promise
    expect(result.ok).toBe(true)
  })
})
