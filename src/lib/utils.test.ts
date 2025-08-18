import type { Network, Provider } from 'ethers'

import { CCIPContractType, CCIPVersion, ChainFamily } from './types.ts'
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
  decodeAddress,
  getProviderNetwork,
  getSomeBlockNumberBefore,
  lazyCached,
  networkInfo,
  toCamelCase,
  validateContractType,
} from './utils.ts'

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

describe('validateContractType', () => {
  it('should return the type and version of the contract', async () => {
    const [version] = await validateContractType(provider, '0x123', CCIPContractType.OnRamp)
    expect(version).toBe(CCIPVersion.V1_2)
  })

  it('should return base version of -dev contracts', async () => {
    mockedContract.typeAndVersion.mockResolvedValueOnce(
      `${CCIPContractType.OffRamp} ${CCIPVersion.V1_5}-dev`,
    )
    const [version] = await validateContractType(provider, '0x124', CCIPContractType.OffRamp)
    expect(version).toBe(CCIPVersion.V1_5)
  })

  it('should throw on contracts not implementing interface', async () => {
    mockedContract.typeAndVersion.mockRejectedValueOnce({ code: 'BAD_DATA' })
    await expect(validateContractType(provider, '0x125', CCIPContractType.OnRamp)).rejects.toThrow(
      '0x125 not a CCIP contract on "ethereum-mainnet"',
    )
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

describe('decodeAddress', () => {
  describe('EVM addresses', () => {
    it('should decode standard EVM addresses', () => {
      const address = '0x1234567890abcdef1234567890abcdef12345678'
      const decoded = decodeAddress(address)
      expect(decoded).toEqual('0x1234567890AbcdEF1234567890aBcdef12345678')
    })

    it('should decode EVM addresses with explicit family', () => {
      const address = '0xa0b86a33e6427bcfb6ecccfb7acfb5d7896b46ad'
      const decoded = decodeAddress(address, ChainFamily.EVM)
      expect(decoded).toEqual('0xa0B86A33E6427bcFb6EccCfb7ACfB5d7896b46AD')
    })

    it('should handle lowercase EVM addresses', () => {
      const address = '0xabcdef1234567890abcdef1234567890abcdef12'
      const decoded = decodeAddress(address, ChainFamily.EVM)
      expect(decoded).toEqual('0xabCDEF1234567890ABcDEF1234567890aBCDeF12')
    })

    it('should handle 32-byte padded EVM addresses', () => {
      const paddedAddress = '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678'
      const decoded = decodeAddress(paddedAddress, ChainFamily.EVM)
      expect(decoded).toEqual('0x1234567890AbcdEF1234567890aBcdef12345678')
    })

    it('should handle Uint8Array input for EVM addresses', () => {
      const addressBytes = new Uint8Array([
        0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd,
        0xef, 0x12, 0x34, 0x56, 0x78,
      ])
      const decoded = decodeAddress(addressBytes, ChainFamily.EVM)
      expect(decoded).toEqual('0x1234567890AbcdEF1234567890aBcdef12345678')
    })

    it('should throw error for invalid EVM address length', () => {
      const invalidAddress = '0x1234567890abcdef'
      expect(() => decodeAddress(invalidAddress, ChainFamily.EVM)).toThrow('Invalid address length')
    })

    it('should throw error for too long EVM address without proper padding', () => {
      const tooLongAddress =
        '0x123456789012345678901234567890123456789012345678901234567890123456789012345678'
      expect(() => decodeAddress(tooLongAddress, ChainFamily.EVM)).toThrow('Invalid address length')
    })
  })

  describe('Solana addresses', () => {
    it('should decode Solana addresses to Base58', () => {
      // 32-byte Solana address in hex
      const solanaBytes = new Uint8Array(32).fill(1) // Simple test bytes
      const decoded = decodeAddress(solanaBytes, ChainFamily.Solana)
      // Should return Base58 encoded string
      expect(typeof decoded).toBe('string')
      expect(decoded.length).toBeGreaterThan(0)
    })

    it('should handle 32-byte hex Solana addresses', () => {
      const solanaBytes = new Uint8Array(32).fill(2) // Different test bytes
      const decoded = decodeAddress(solanaBytes, ChainFamily.Solana)
      expect(typeof decoded).toBe('string')
      expect(decoded.length).toBeGreaterThan(0)
    })

    it('should handle Base58 string input for Solana', () => {
      const base58Address = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
      const decoded = decodeAddress(base58Address, ChainFamily.Solana)
      expect(typeof decoded).toBe('string')
      expect(decoded).toBe(base58Address)
    })

    it('should handle hex string for Solana addresses', () => {
      const hexAddress = '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
      const decoded = decodeAddress(hexAddress, ChainFamily.Solana)
      expect(typeof decoded).toBe('string')
      expect(decoded.length).toBeGreaterThan(0)
    })
  })

  describe('Aptos addresses', () => {
    it('should decode Aptos addresses as hex', () => {
      const aptosAddress = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const decoded = decodeAddress(aptosAddress, ChainFamily.Aptos)
      expect(decoded).toBe('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
    })

    it('should handle shorter Aptos addresses', () => {
      const aptosAddress = '0x1'
      let decoded = decodeAddress(aptosAddress, ChainFamily.Aptos)
      expect(decoded).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')

      const aptosToken = '0xa'
      decoded = decodeAddress(aptosToken, ChainFamily.Aptos)
      expect(decoded).toBe('0x000000000000000000000000000000000000000000000000000000000000000a')
    })

    it('should handle Uint8Array for Aptos addresses', () => {
      const aptosBytes = new Uint8Array([0x12, 0x34, 0x56, 0x78])
      const decoded = decodeAddress(aptosBytes, ChainFamily.Aptos)
      expect(decoded).toBe('0x0000000000000000000000000000000000000000000000000000000012345678')
    })
  })

  describe('default behavior', () => {
    it('should default to EVM family when not specified', () => {
      const address = '0x1234567890abcdef1234567890abcdef12345678'
      const decoded = decodeAddress(address)
      expect(decoded).toEqual('0x1234567890AbcdEF1234567890aBcdef12345678')
    })
  })

  describe('error handling', () => {
    it('should throw error for unsupported chain family', () => {
      const address = '0x1234567890abcdef1234567890abcdef12345678'
      expect(() => decodeAddress(address, 'bitcoin' as ChainFamily)).toThrow(
        'Unsupported address family: bitcoin',
      )
    })

    it('should handle empty bytes', () => {
      const emptyBytes = new Uint8Array(0)
      expect(() => decodeAddress(emptyBytes, ChainFamily.EVM)).toThrow()
    })

    it('should handle null/undefined input gracefully', () => {
      expect(() => decodeAddress(null as any, ChainFamily.EVM)).toThrow()
      expect(() => decodeAddress(undefined as any, ChainFamily.EVM)).toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle zero address for EVM', () => {
      const zeroAddress = '0x0000000000000000000000000000000000000000'
      const decoded = decodeAddress(zeroAddress, ChainFamily.EVM)
      expect(decoded).toBe('0x0000000000000000000000000000000000000000')
    })

    it('should handle maximum EVM address', () => {
      const maxAddress = '0xffffffffffffffffffffffffffffffffffffffff'
      const decoded = decodeAddress(maxAddress, ChainFamily.EVM)
      expect(decoded).toBe('0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF')
    })

    it('should handle 32-byte zero-padded addresses correctly', () => {
      const paddedZeroAddress = '0x0000000000000000000000000000000000000000000000000000000000000000'
      expect(() => decodeAddress(paddedZeroAddress, ChainFamily.EVM)).toThrow(
        'Invalid address length',
      )
    })

    it('should handle mixed case hex input', () => {
      const mixedCaseAddress = '0xAbCdEf1234567890ABCDEF1234567890abcdef12'
      const decoded = decodeAddress(mixedCaseAddress, ChainFamily.EVM)
      expect(decoded).toEqual('0xabCDEF1234567890ABcDEF1234567890aBCDeF12')
    })

    it('should handle different byte lengths for non-EVM chains', () => {
      // Test with different byte lengths for Aptos
      const shortBytes = new Uint8Array([0x01])
      const decodedShort = decodeAddress(shortBytes, ChainFamily.Aptos)
      expect(decodedShort).toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      )

      // Test with longer bytes for Aptos
      const longBytes = new Uint8Array(64).fill(0xaa)
      const decodedLong = decodeAddress(longBytes, ChainFamily.Aptos)
      expect(decodedLong.length).toBeGreaterThan(2) // Should be more than '0x'
    })
  })
})

describe('networkInfo', () => {
  describe('bigint selector input', () => {
    it('should handle EVM chain selector as bigint', () => {
      expect(networkInfo(5009297550715157269n)).toEqual({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain selector as bigint', () => {
      expect(networkInfo(4741433654826277614n)).toEqual({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })

    it('should handle Solana chain selector as bigint', () => {
      expect(networkInfo(124615329519749607n)).toEqual({
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        chainSelector: 124615329519749607n,
        name: 'solana-mainnet',
        family: ChainFamily.Solana,
        isTestnet: false,
      })
    })

    it('should handle testnet chain selector as bigint', () => {
      expect(networkInfo(3478487238524512106n)).toEqual({
        chainId: 421614,
        chainSelector: 3478487238524512106n,
        name: 'ethereum-testnet-sepolia-arbitrum-1',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })
  })

  describe('number chain ID input', () => {
    it('should handle EVM chain ID as number', () => {
      expect(networkInfo(1)).toEqual({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle BSC chain ID as number', () => {
      expect(networkInfo(56)).toEqual({
        chainId: 56,
        chainSelector: 11344663589394136015n,
        name: 'binance_smart_chain-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle testnet chain ID as number', () => {
      expect(networkInfo(97)).toEqual({
        chainId: 97,
        chainSelector: 13264668187771770619n,
        name: 'binance_smart_chain-testnet',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })
  })

  describe('string chain ID input', () => {
    it('should handle EVM chain ID as string', () => {
      expect(networkInfo('1')).toEqual({
        chainId: '1',
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain ID as string', () => {
      expect(networkInfo('aptos:1')).toEqual({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })

    it('should handle Aptos testnet chain ID as string', () => {
      expect(networkInfo('aptos:2')).toEqual({
        chainId: 'aptos:2',
        chainSelector: 743186221051783445n,
        name: 'aptos-testnet',
        family: ChainFamily.Aptos,
        isTestnet: true,
      })
    })

    it('should handle Solana chain ID as string', () => {
      expect(networkInfo('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toEqual({
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        chainSelector: 124615329519749607n,
        name: 'solana-mainnet',
        family: ChainFamily.Solana,
        isTestnet: false,
      })
    })

    it('should handle Solana testnet chain ID as string', () => {
      expect(networkInfo('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY')).toEqual({
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
      expect(networkInfo('3478487238524512106')).toEqual({
        chainId: 421614,
        chainSelector: 3478487238524512106n,
        name: 'ethereum-testnet-sepolia-arbitrum-1',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })

    it('should handle EVM chain ID as string when not a valid selector', () => {
      expect(networkInfo('56')).toEqual({
        chainId: '56',
        chainSelector: 11344663589394136015n,
        name: 'binance_smart_chain-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain ID as string when not a valid selector', () => {
      expect(networkInfo('aptos:2')).toEqual({
        chainId: 'aptos:2',
        chainSelector: 743186221051783445n,
        name: 'aptos-testnet',
        family: ChainFamily.Aptos,
        isTestnet: true,
      })
    })
  })

  describe('string chain name input', () => {
    it('should handle EVM chain name', () => {
      expect(networkInfo('ethereum-mainnet')).toEqual({
        chainId: 1,
        chainSelector: 5009297550715157269n,
        name: 'ethereum-mainnet',
        family: ChainFamily.EVM,
        isTestnet: false,
      })
    })

    it('should handle Aptos chain name', () => {
      expect(networkInfo('aptos-mainnet')).toEqual({
        chainId: 'aptos:1',
        chainSelector: 4741433654826277614n,
        name: 'aptos-mainnet',
        family: ChainFamily.Aptos,
        isTestnet: false,
      })
    })

    it('should handle Solana chain name', () => {
      expect(networkInfo('solana-mainnet')).toEqual({
        chainId: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        chainSelector: 124615329519749607n,
        name: 'solana-mainnet',
        family: ChainFamily.Solana,
        isTestnet: false,
      })
    })

    it('should handle EVM testnet chain name', () => {
      expect(networkInfo('binance_smart_chain-testnet')).toEqual({
        chainId: 97,
        chainSelector: 13264668187771770619n,
        name: 'binance_smart_chain-testnet',
        family: ChainFamily.EVM,
        isTestnet: true,
      })
    })
  })

  describe('edge cases and error handling', () => {
    it('should throw error for invalid selector', () => {
      expect(() => networkInfo(999999999999999999n)).toThrow('Selector not found')
    })

    it('should throw error for invalid chain ID', () => {
      expect(() => networkInfo(999999)).toThrow('Chain ID not found: 999999')
    })

    it('should throw error for invalid chain name', () => {
      expect(() => networkInfo('invalid-chain-name')).toThrow('Chain name not found')
    })

    it('should throw error for numeric string that is neither selector nor chain ID nor name', () => {
      expect(() => networkInfo('999999999999999999')).toThrow('Chain name not found')
    })

    it('should handle large numeric strings gracefully', () => {
      // This should fall back to chain name lookup and fail gracefully
      expect(() => networkInfo('99999999999999999999999999999')).toThrow('Chain name not found')
    })

    it('should handle empty string', () => {
      expect(() => networkInfo('')).toThrow('Chain name not found')
    })

    it('should handle zero values', () => {
      expect(() => networkInfo(0)).toThrow('Chain ID not found: 0')
      expect(() => networkInfo(0n)).toThrow('Selector not found')
      expect(() => networkInfo('0')).toThrow('Chain name not found')
    })
  })

  describe('isTestnet detection', () => {
    it('should correctly identify mainnet chains', () => {
      expect(networkInfo('ethereum-mainnet').isTestnet).toBe(false)
      expect(networkInfo('aptos-mainnet').isTestnet).toBe(false)
      expect(networkInfo('solana-mainnet').isTestnet).toBe(false)
      expect(networkInfo('binance_smart_chain-mainnet').isTestnet).toBe(false)
    })

    it('should correctly identify testnet chains', () => {
      expect(networkInfo('aptos-testnet').isTestnet).toBe(true)
      expect(networkInfo('solana-testnet').isTestnet).toBe(true)
      expect(networkInfo('binance_smart_chain-testnet').isTestnet).toBe(true)
      expect(networkInfo('ethereum-testnet-sepolia-arbitrum-1').isTestnet).toBe(true)
    })

    it('should correctly identify devnet/localnet as testnet', () => {
      expect(networkInfo('solana-devnet').isTestnet).toBe(true)
      expect(networkInfo('aptos-localnet').isTestnet).toBe(true)
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
      family: ChainFamily.EVM,
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

describe('toCamelCase', () => {
  it('should convert snake_case to camelCase', () => {
    expect(toCamelCase('snake_case')).toBe('snakeCase')
    expect(toCamelCase('foo_bar')).toBe('fooBar')
    expect(toCamelCase('test_string_here')).toBe('testStringHere')
    expect(toCamelCase('source_token_data')).toBe('sourceTokenData')
    expect(toCamelCase('dest_token_address')).toBe('destTokenAddress')
  })

  it('should handle single underscore', () => {
    expect(toCamelCase('a_b')).toBe('aB')
    expect(toCamelCase('_start')).toBe('Start')
  })

  it('should handle strings without underscores', () => {
    expect(toCamelCase('nounderscores')).toBe('nounderscores')
    expect(toCamelCase('CamelCase')).toBe('CamelCase')
    expect(toCamelCase('already')).toBe('already')
  })

  it('should handle empty string', () => {
    expect(toCamelCase('')).toBe('')
  })

  it('should handle multiple consecutive underscores', () => {
    expect(toCamelCase('test__double')).toBe('test_Double')
    expect(toCamelCase('a___b')).toBe('a__B')
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
        { source_token: 'token1', dest_token: 'token2' },
        { source_token: 'token3', dest_token: 'token4' },
      ],
    }
    const expected = {
      tokenAmounts: [
        { sourceToken: 'token1', destToken: 'token2' },
        { sourceToken: 'token3', destToken: 'token4' },
      ],
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle primitive values', () => {
    expect(convertKeysToCamelCase(null)).toBe(null)
    expect(convertKeysToCamelCase(undefined)).toBe(undefined)
    expect(convertKeysToCamelCase('string')).toBe('string')
    expect(convertKeysToCamelCase(123)).toBe(123)
    expect(convertKeysToCamelCase(true)).toBe(true)
    expect(convertKeysToCamelCase(123n)).toBe(123n)
  })

  it('should handle arrays of primitives', () => {
    const input = ['a', 'b', 'c']
    expect(convertKeysToCamelCase(input)).toEqual(['a', 'b', 'c'])
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
        { item_name: 'item1', item_value: 100 },
        { item_name: 'item2', item_value: 200 },
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
        { itemName: 'item1', itemValue: 100 },
        { itemName: 'item2', itemValue: 200 },
      ],
    }
    expect(convertKeysToCamelCase(input)).toEqual(expected)
  })

  it('should handle empty objects and arrays', () => {
    expect(convertKeysToCamelCase({})).toEqual({})
    expect(convertKeysToCamelCase([])).toEqual([])
  })
})
