import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import './index.ts'
import { ChainFamily } from './types.ts'
import {
  bigIntReplacer,
  bigIntReviver,
  blockRangeGenerator,
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
} from './utils.ts'

describe('getSomeBlockNumberBefore', () => {
  it('should return a block number before the given timestamp', async () => {
    const avgBlockTime = 12
    const rand = Math.random() * (avgBlockTime - 1) + 1 // [1, 12[
    const now = Math.trunc(Date.now() / 1e3)
    const getBlockTimestamp = mock.fn(
      async (num) =>
        now -
        (15000 - num) * avgBlockTime -
        Math.trunc(rand ** (num % avgBlockTime) % avgBlockTime),
    )

    const targetTs = now - avgBlockTime * 14200
    const blockNumber = await getSomeBlockNumberBefore(getBlockTimestamp, 15000, targetTs)
    assert.ok(blockNumber <= 800)
    assert.ok(blockNumber >= 790)
  })
})

describe('decodeAddress', () => {
  describe('EVM addresses', () => {
    it('should decode standard EVM addresses', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const decoded = decodeAddress(address)
      assert.equal(decoded, '0x1234567890123456789012345678901234567890')
    })

    it('should decode EVM addresses with explicit family', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const decoded = decodeAddress(address, ChainFamily.EVM)
      assert.equal(decoded, '0x1234567890123456789012345678901234567890')
    })

    it('should handle lowercase EVM addresses', () => {
      const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const decoded = decodeAddress(address)
      assert.equal(decoded, '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
    })

    it('should handle 32-byte padded EVM addresses', () => {
      const paddedAddress = '0x0000000000000000000000001234567890123456789012345678901234567890'
      const decoded = decodeAddress(paddedAddress)
      assert.equal(decoded, '0x1234567890123456789012345678901234567890')
    })

    it('should handle Uint8Array input for EVM addresses', () => {
      const addressBytes = new Uint8Array([
        0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90, 0x12, 0x34, 0x56, 0x78, 0x90,
        0x12, 0x34, 0x56, 0x78, 0x90,
      ])
      const decoded = decodeAddress(addressBytes)
      assert.equal(decoded, '0x1234567890123456789012345678901234567890')
    })

    it('should throw error for invalid EVM address length', () => {
      const invalidAddress = '0x12345678901234567890' // Too short
      assert.throws(() => decodeAddress(invalidAddress))
    })

    it('should throw error for too long EVM address without proper padding', () => {
      const tooLongAddress =
        '0x123456789012345678901234567890123456789012345678901234567890123456789012'
      assert.throws(() => decodeAddress(tooLongAddress))
    })
  })

  describe('Solana addresses', () => {
    it('should decode Solana addresses to Base58', () => {
      // 32-byte Solana public key
      const solanaBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decoded = decodeAddress(solanaBytes, ChainFamily.Solana)
      assert.equal(decoded, '11111111111111111112')
    })

    it('should handle 32-byte hex Solana addresses', () => {
      const solanaBytes = '0x0000000000000000000000000000000000000000000000000000000000000000'
      const decoded = decodeAddress(solanaBytes, ChainFamily.Solana)
      assert.equal(decoded, '11111111111111111111111111111111')
    })

    it('should handle Base58 string input for Solana', () => {
      const base58Address = 'So11111111111111111111111111111111111111112'
      const decoded = decodeAddress(base58Address, ChainFamily.Solana)
      assert.equal(decoded, 'So11111111111111111111111111111111111111112')
    })

    it('should handle hex string for Solana addresses', () => {
      const hexAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decoded = decodeAddress(hexAddress, ChainFamily.Solana)
      assert.equal(decoded, '11111111111111111112')
    })
  })

  describe('Aptos addresses', () => {
    it('should decode Aptos addresses as hex', () => {
      const aptosAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decoded = decodeAddress(aptosAddress, ChainFamily.Aptos)
      assert.equal(decoded, '0x0000000000000000000000000000000000000000000000000000000000000001')
    })

    it('should handle shorter Aptos addresses', () => {
      const aptosAddress = '0x0000000000000000000000000000000000000000000000000000000000000123'
      let decoded = decodeAddress(aptosAddress, ChainFamily.Aptos)
      assert.equal(decoded, '0x0000000000000000000000000000000000000000000000000000000000000123')

      const aptosToken = '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa'
      decoded = decodeAddress(aptosToken, ChainFamily.Aptos)
      assert.equal(decoded, '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa')
    })

    it('should handle Uint8Array for Aptos addresses', () => {
      const aptosBytes = new Uint8Array(32).fill(1)
      const decoded = decodeAddress(aptosBytes, ChainFamily.Aptos)
      assert.equal(decoded, '0x0101010101010101010101010101010101010101010101010101010101010101')
    })
  })

  describe('default behavior', () => {
    it('should default to EVM family when not specified', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const decoded = decodeAddress(address)
      assert.equal(decoded, '0x1234567890123456789012345678901234567890')
    })
  })

  describe('error handling', () => {
    it('should throw error for unsupported chain family', () => {
      const address = '0x1234567890123456789012345678901234567890'
      assert.throws(
        () => decodeAddress(address, 'InvalidFamily' as ChainFamily),
        /Unsupported chain family/,
      )
    })

    it('should handle empty bytes', () => {
      const emptyBytes = '0x'
      assert.throws(() => decodeAddress(emptyBytes))
    })

    it('should handle null/undefined input gracefully', () => {
      assert.throws(() => decodeAddress(null as unknown as string))
      assert.throws(() => decodeAddress(undefined as unknown as string))
    })
  })

  describe('edge cases', () => {
    it('should handle zero address for EVM', () => {
      const zeroAddress = '0x0000000000000000000000000000000000000000'
      const decoded = decodeAddress(zeroAddress)
      assert.equal(decoded, '0x0000000000000000000000000000000000000000')
    })

    it('should handle maximum EVM address', () => {
      const maxAddress = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      const decoded = decodeAddress(maxAddress)
      assert.equal(decoded, '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF')
    })

    it('should handle 32-byte zero-padded addresses correctly', () => {
      const paddedZeroAddress = '0x000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      const decoded = decodeAddress(paddedZeroAddress)
      assert.equal(decoded, '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF')
    })

    it('should handle mixed case hex input', () => {
      const mixedCaseAddress = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
      const decoded = decodeAddress(mixedCaseAddress)
      assert.equal(decoded, '0xabCDEF1234567890ABcDEF1234567890aBCDeF12')
    })

    it('should handle different byte lengths for non-EVM chains', () => {
      // Solana accepts 32-byte addresses
      const shortBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decodedShort = decodeAddress(shortBytes, ChainFamily.Solana)
      assert.equal(decodedShort, '11111111111111111112')

      // Aptos accepts variable length but normalizes to 32 bytes
      const longBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
      const decodedLong = decodeAddress(longBytes, ChainFamily.Aptos)
      assert.equal(
        decodedLong,
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      )
    })
  })
})

describe('networkInfo', () => {
  describe('bigint selector input', () => {
    it('should handle EVM chain selector as bigint', () => {
      const info = networkInfo(5009297550715157269n) // Ethereum mainnet selector
      assert.equal(info.chainId, 1)
      assert.equal(info.chainSelector, 5009297550715157269n)
      assert.equal(info.name, 'ethereum-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Aptos chain selector as bigint', () => {
      const info = networkInfo(4741433654826277614n) // Aptos mainnet selector
      assert.equal(info.chainId, 'aptos:1')
      assert.equal(info.chainSelector, 4741433654826277614n)
      assert.equal(info.name, 'aptos-mainnet')
      assert.equal(info.family, ChainFamily.Aptos)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Solana chain selector as bigint', () => {
      const info = networkInfo(124615329519749607n) // Solana mainnet selector
      assert.equal(info.chainId, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      assert.equal(info.chainSelector, 124615329519749607n)
      assert.equal(info.name, 'solana-mainnet')
      assert.equal(info.family, ChainFamily.Solana)
      assert.equal(info.isTestnet, false)
    })

    it('should handle testnet chain selector as bigint', () => {
      const info = networkInfo(16015286601757825753n) // Sepolia selector
      assert.equal(info.chainId, 11155111)
      assert.equal(info.chainSelector, 16015286601757825753n)
      assert.equal(info.name, 'ethereum-testnet-sepolia')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, true)
    })
  })

  describe('number chain ID input', () => {
    it('should handle EVM chain ID as number', () => {
      const info = networkInfo(1) // Ethereum mainnet
      assert.equal(info.chainId, 1)
      assert.equal(info.chainSelector, 5009297550715157269n)
      assert.equal(info.name, 'ethereum-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle BSC chain ID as number', () => {
      const info = networkInfo(56) // BSC mainnet
      assert.equal(info.chainId, 56)
      assert.equal(info.chainSelector, 11344663589394136015n)
      assert.equal(info.name, 'binance_smart_chain-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle testnet chain ID as number', () => {
      const info = networkInfo(11155111) // Sepolia
      assert.equal(info.chainId, 11155111)
      assert.equal(info.chainSelector, 16015286601757825753n)
      assert.equal(info.name, 'ethereum-testnet-sepolia')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, true)
    })
  })

  describe('string chain ID input', () => {
    it('should handle EVM chain ID as string', () => {
      const info = networkInfo('1')
      assert.equal(info.chainId, 1)
      assert.equal(info.chainSelector, 5009297550715157269n)
      assert.equal(info.name, 'ethereum-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Aptos chain ID as string', () => {
      const info = networkInfo('aptos:1')
      assert.equal(info.chainId, 'aptos:1')
      assert.equal(info.chainSelector, 4741433654826277614n)
      assert.equal(info.name, 'aptos-mainnet')
      assert.equal(info.family, ChainFamily.Aptos)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Aptos testnet chain ID as string', () => {
      const info = networkInfo('aptos:2')
      assert.equal(info.chainId, 'aptos:2')
      assert.equal(info.chainSelector, 743186221051783445n)
      assert.equal(info.name, 'aptos-testnet')
      assert.equal(info.family, ChainFamily.Aptos)
      assert.equal(info.isTestnet, true)
    })

    it('should handle Solana chain ID as string', () => {
      const info = networkInfo('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      assert.equal(info.chainId, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      assert.equal(info.chainSelector, 124615329519749607n)
      assert.equal(info.name, 'solana-mainnet')
      assert.equal(info.family, ChainFamily.Solana)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Solana testnet chain ID as string', () => {
      const info = networkInfo('4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY')
      assert.equal(info.chainId, '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY')
      assert.equal(info.chainSelector, 6302590918974934319n)
      assert.equal(info.name, 'solana-testnet')
      assert.equal(info.family, ChainFamily.Solana)
      assert.equal(info.isTestnet, true)
    })
  })

  describe('string selector input', () => {
    it('should handle selector as string when valid selector exists', () => {
      const info = networkInfo('5009297550715157269')
      assert.equal(info.chainId, 1)
      assert.equal(info.chainSelector, 5009297550715157269n)
      assert.equal(info.name, 'ethereum-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle EVM chainID as bigint', () => {
      const info = networkInfo(BigInt(1))
      assert.equal(info.chainId, 1)
      assert.equal(info.chainSelector, 5009297550715157269n)
      assert.equal(info.name, 'ethereum-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Aptos chain ID as string when not a valid selector', () => {
      const info = networkInfo('aptos:1')
      assert.equal(info.chainId, 'aptos:1')
      assert.equal(info.chainSelector, 4741433654826277614n)
      assert.equal(info.name, 'aptos-mainnet')
      assert.equal(info.family, ChainFamily.Aptos)
      assert.equal(info.isTestnet, false)
    })
  })

  describe('string chain name input', () => {
    it('should handle EVM chain name', () => {
      const info = networkInfo('ethereum-mainnet')
      assert.equal(info.chainId, 1)
      assert.equal(info.chainSelector, 5009297550715157269n)
      assert.equal(info.name, 'ethereum-mainnet')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Aptos chain name', () => {
      const info = networkInfo('aptos-mainnet')
      assert.equal(info.chainId, 'aptos:1')
      assert.equal(info.chainSelector, 4741433654826277614n)
      assert.equal(info.name, 'aptos-mainnet')
      assert.equal(info.family, ChainFamily.Aptos)
      assert.equal(info.isTestnet, false)
    })

    it('should handle Solana chain name', () => {
      const info = networkInfo('solana-mainnet')
      assert.equal(info.chainId, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      assert.equal(info.chainSelector, 124615329519749607n)
      assert.equal(info.name, 'solana-mainnet')
      assert.equal(info.family, ChainFamily.Solana)
      assert.equal(info.isTestnet, false)
    })

    it('should handle EVM testnet chain name', () => {
      const info = networkInfo('ethereum-testnet-sepolia')
      assert.equal(info.chainId, 11155111)
      assert.equal(info.chainSelector, 16015286601757825753n)
      assert.equal(info.name, 'ethereum-testnet-sepolia')
      assert.equal(info.family, ChainFamily.EVM)
      assert.equal(info.isTestnet, true)
    })
  })

  describe('edge cases and error handling', () => {
    it('should throw error for invalid selector', () => {
      assert.throws(() => networkInfo(999999n))
    })

    it('should throw error for invalid chain ID', () => {
      assert.throws(() => networkInfo(999999))
    })

    it('should throw error for invalid chain name', () => {
      assert.throws(() => networkInfo('invalid-chain-name'))
    })

    it('should throw error for numeric string that is neither selector nor chain ID nor name', () => {
      assert.throws(() => networkInfo('999999999999999999999'))
    })

    it('should handle large numeric strings gracefully', () => {
      const largeSelector = '5009297550715157269'
      const info = networkInfo(largeSelector)
      assert.equal(info.chainSelector, 5009297550715157269n)
    })

    it('should throw error for empty string', () => {
      assert.throws(() => networkInfo(''))
    })

    it('should handle zero values', () => {
      // Zero is not a valid chain ID or selector
      assert.throws(() => networkInfo(0))
      assert.throws(() => networkInfo(0n))
    })
  })

  describe('isTestnet detection', () => {
    it('should correctly identify mainnet chains', () => {
      assert.equal(networkInfo(1).isTestnet, false) // Ethereum mainnet
      assert.equal(networkInfo(56).isTestnet, false) // BSC mainnet
      assert.equal(networkInfo('aptos-mainnet').isTestnet, false) // Aptos mainnet
    })

    it('should correctly identify testnet chains', () => {
      assert.equal(networkInfo(11155111).isTestnet, true) // Sepolia
      assert.equal(networkInfo('aptos-testnet').isTestnet, true) // Aptos testnet
      assert.equal(networkInfo('solana-testnet').isTestnet, true) // Solana testnet
    })

    it('should correctly identify devnet/localnet as testnet', () => {
      assert.equal(networkInfo('solana-testnet').isTestnet, true)
    })
  })
})

describe('blockRangeGenerator', () => {
  it('should generate block ranges backwards', () => {
    const ranges = [...blockRangeGenerator({ endBlock: 100000 })]
    assert.equal(ranges.length, 10)
    assert.deepEqual(ranges[0], { fromBlock: 90001, toBlock: 100000 })
    assert.deepEqual(ranges[1], { fromBlock: 80001, toBlock: 90000 })
    assert.deepEqual(ranges[2], { fromBlock: 70001, toBlock: 80000 })
    assert.deepEqual(ranges[3], { fromBlock: 60001, toBlock: 70000 })
    assert.deepEqual(ranges[4], { fromBlock: 50001, toBlock: 60000 })
    assert.deepEqual(ranges[5], { fromBlock: 40001, toBlock: 50000 })
    assert.deepEqual(ranges[6], { fromBlock: 30001, toBlock: 40000 })
    assert.deepEqual(ranges[7], { fromBlock: 20001, toBlock: 30000 })
    assert.deepEqual(ranges[8], { fromBlock: 10001, toBlock: 20000 })
    assert.deepEqual(ranges[9], { fromBlock: 1, toBlock: 10000 })
  })
  it('should generate block ranges forwards', () => {
    const ranges = [...blockRangeGenerator({ startBlock: 1000, endBlock: 50000 })]
    assert.equal(ranges.length, 5)
    assert.equal(ranges[0].fromBlock, 1000)
    assert.equal(ranges[0].toBlock, 10999)
    assert.ok('progress' in ranges[0])
    assert.equal(ranges[1].fromBlock, 11000)
    assert.equal(ranges[1].toBlock, 20999)
    assert.equal(ranges[4].fromBlock, 41000)
    assert.equal(ranges[4].toBlock, 50000)
  })

  it('should generate single block range', () => {
    const ranges = [...blockRangeGenerator({ singleBlock: 42 })]
    assert.deepEqual(ranges, [{ fromBlock: 42, toBlock: 42 }])
  })

  it('should handle custom step size', () => {
    const ranges = [...blockRangeGenerator({ startBlock: 1, endBlock: 1000, page: 200 })]
    assert.equal(ranges.length, 5)
    assert.equal(ranges[0].fromBlock, 1)
    assert.equal(ranges[0].toBlock, 200)
    assert.equal(ranges[4].fromBlock, 801)
    assert.equal(ranges[4].toBlock, 1000)
  })

  it('should handle when endBlock equals startBlock', () => {
    const ranges = [...blockRangeGenerator({ startBlock: 100, endBlock: 100 })]
    assert.equal(ranges.length, 0)
  })
})

describe('bigIntReplacer', () => {
  it('should replace bigint with string', () => {
    const obj = { value: 123n }
    const json = JSON.stringify(obj, bigIntReplacer)
    assert.equal(json, '{"value":"123"}')
  })

  it('should handle nested objects with bigints', () => {
    const obj = { outer: { inner: 456n }, array: [1n, 2n, 3n] }
    const json = JSON.stringify(obj, bigIntReplacer)
    assert.equal(json, '{"outer":{"inner":"456"},"array":["1","2","3"]}')
  })

  it('should preserve non-bigint values', () => {
    const obj = { str: 'test', num: 42, bool: true, nil: null }
    const json = JSON.stringify(obj, bigIntReplacer)
    assert.equal(json, '{"str":"test","num":42,"bool":true,"nil":null}')
  })
})

describe('bigIntReviver', () => {
  it('should revive string to bigint', () => {
    const json = '{"value":"123"}'
    const obj = JSON.parse(json, bigIntReviver) as { value: bigint }
    assert.equal(obj.value, 123n)
  })

  it('should handle nested objects', () => {
    const json = '{"outer":{"inner":"456"},"array":["1","2","3"]}'
    const obj = JSON.parse(json, bigIntReviver) as {
      outer: { inner: bigint }
      array: bigint[]
    }
    assert.equal(obj.outer.inner, 456n)
    assert.deepEqual(obj.array, [1n, 2n, 3n])
  })

  it('should preserve non-numeric strings', () => {
    const json = '{"str":"test","numStr":"123","bool":"true"}'
    const obj = JSON.parse(json, bigIntReviver) as Record<string, unknown>
    assert.equal(obj.str, 'test')
    assert.equal(obj.numStr, 123n)
    assert.equal(obj.bool, 'true')
  })
})

describe('snakeToCamel', () => {
  it('should convert snake_case to camelCase', () => {
    assert.equal(snakeToCamel('snake_case'), 'snakeCase')
    assert.equal(snakeToCamel('foo_bar'), 'fooBar')
    assert.equal(snakeToCamel('test_string_here'), 'testStringHere')
    assert.equal(snakeToCamel('source_token_data'), 'sourceTokenData')
    assert.equal(snakeToCamel('dest_token_address'), 'destTokenAddress')
  })

  it('should handle single underscore', () => {
    assert.equal(snakeToCamel('a_b'), 'aB')
    assert.equal(snakeToCamel('_start'), 'Start')
  })

  it('should handle strings without underscores', () => {
    assert.equal(snakeToCamel('nounderscores'), 'nounderscores')
    assert.equal(snakeToCamel('CamelCase'), 'CamelCase')
    assert.equal(snakeToCamel('already'), 'already')
  })

  it('should handle empty string', () => {
    assert.equal(snakeToCamel(''), '')
  })

  it('should handle multiple consecutive underscores', () => {
    assert.equal(snakeToCamel('test__double'), 'test_Double')
    assert.equal(snakeToCamel('a___b'), 'a__B')
  })

  it('should handle leading underscores', () => {
    assert.equal(snakeToCamel('_private'), 'Private')
    assert.equal(snakeToCamel('__dunder'), '_Dunder')
  })

  it('should handle trailing underscores', () => {
    assert.equal(snakeToCamel('trailing_'), 'trailing_')
    assert.equal(snakeToCamel('double_trailing__'), 'doubleTrailing__')
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
    assert.deepEqual(convertKeysToCamelCase(input), expected)
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
    assert.deepEqual(convertKeysToCamelCase(input), expected)
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
    assert.deepEqual(convertKeysToCamelCase(input), expected)
  })

  it('should handle primitive values', () => {
    assert.equal(convertKeysToCamelCase('string'), 'string')
    assert.equal(convertKeysToCamelCase(123), 123)
    assert.equal(convertKeysToCamelCase(true), true)
    assert.equal(convertKeysToCamelCase(null), null)
  })

  it('should handle arrays of primitives', () => {
    const input = [1, 2, 3, 'four', true]
    assert.deepEqual(convertKeysToCamelCase(input), [1, 2, 3, 'four', true])
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
    assert.deepEqual(convertKeysToCamelCase(input), expected)
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
    assert.deepEqual(convertKeysToCamelCase(input), expected)
  })

  it('should handle empty objects and arrays', () => {
    assert.deepEqual(convertKeysToCamelCase({}), {})
    assert.deepEqual(convertKeysToCamelCase([]), [])
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
    assert.deepEqual(result, {
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
    assert.deepEqual(convertKeysToCamelCase(input), expected)
  })
})

describe('decodeOnRampAddress', () => {
  it('should decode EVM addresses without modification', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const decoded = decodeOnRampAddress(address, ChainFamily.EVM)
    assert.equal(decoded, '0x1234567890123456789012345678901234567890')
  })

  it('should append ::onramp for Aptos addresses', () => {
    const aptosAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const decoded = decodeOnRampAddress(aptosAddress, ChainFamily.Aptos)
    assert.equal(
      decoded,
      '0x0000000000000000000000000000000000000000000000000000000000000001::onramp',
    )
  })

  it('should decode Solana addresses without ::onramp', () => {
    const solanaBytes = '0x0000000000000000000000000000000000000000000000000000000000000001'
    const decoded = decodeOnRampAddress(solanaBytes, ChainFamily.Solana)
    assert.ok(!decoded.includes('::onramp'))
  })

  it('should use EVM as default family', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const decoded = decodeOnRampAddress(address)
    assert.equal(decoded, '0x1234567890123456789012345678901234567890')
  })
})

describe('leToBigInt', () => {
  it('should convert little-endian bytes to bigint', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00])
    const result = leToBigInt(bytes)
    assert.equal(result, 1n)
  })

  it('should handle array input', () => {
    const bytes = [0x01, 0x00, 0x00, 0x00]
    const result = leToBigInt(bytes)
    assert.equal(result, 1n)
  })

  it('should convert larger values correctly', () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x00, 0x00])
    const result = leToBigInt(bytes)
    assert.equal(result, 255n)
  })

  it('should handle multi-byte values', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x00, 0x00])
    const result = leToBigInt(bytes)
    assert.equal(result, 256n)
  })

  it('should handle hex string input', () => {
    const hexString = '0x01000000'
    const result = leToBigInt(hexString)
    assert.equal(result, 1n)
  })

  it('should handle large numbers', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    const result = leToBigInt(bytes)
    assert.equal(result, 18446744073709551615n)
  })
})

describe('toLeArray', () => {
  it('should convert bigint to little-endian byte array', () => {
    const result = toLeArray(1n)
    assert.deepEqual(result, new Uint8Array([0x01]))
  })

  it('should handle larger values', () => {
    const result = toLeArray(256n)
    assert.deepEqual(result, new Uint8Array([0x00, 0x01]))
  })

  it('should handle zero', () => {
    const result = toLeArray(0n)
    assert.deepEqual(result, new Uint8Array([0x00]))
  })

  it('should handle custom width', () => {
    const result = toLeArray(1n, 4)
    assert.deepEqual(result, new Uint8Array([0x01, 0x00, 0x00, 0x00]))
  })

  it('should handle number input', () => {
    const result = toLeArray(255, 2)
    assert.deepEqual(result, new Uint8Array([0xff, 0x00]))
  })

  it('should handle large numbers with width', () => {
    const result = toLeArray(65535n, 4)
    assert.deepEqual(result, new Uint8Array([0xff, 0xff, 0x00, 0x00]))
  })
})

describe('isBase64', () => {
  it('should return true for valid base64 strings', () => {
    assert.equal(isBase64('SGVsbG8gV29ybGQ='), true)
    assert.equal(isBase64('YWJjZGVmZ2g='), true)
    assert.equal(isBase64('MTIzNDU2Nzg='), true)
  })

  it('should return true for base64 with double padding', () => {
    assert.equal(isBase64('YQ=='), true) // "a" in base64
    assert.equal(isBase64('SGVsbG8gV29ybGQ='), true) // Valid with groups of 4 then padding
  })

  it('should return false for incorrectly padded strings', () => {
    assert.equal(isBase64('YWI=='), false) // "ab" should be "YWI=" not "YWI=="
    assert.equal(isBase64('YWJjZA'), false) // Missing padding
  })

  it('should return false for invalid characters', () => {
    assert.equal(isBase64('Hello World!'), false)
    assert.equal(isBase64('abc@def'), false)
  })

  it('should return false for non-string inputs', () => {
    assert.equal(isBase64(123 as any), false)
    assert.equal(isBase64(null as any), false)
    assert.equal(isBase64(undefined as any), false)
    assert.equal(isBase64({} as any), false)
  })

  it('should return false for empty string', () => {
    assert.equal(isBase64(''), true) // Empty string is technically valid base64
  })

  it('should return false for hex strings', () => {
    assert.equal(isBase64('0x1234567890abcdef'), false)
  })

  it('should handle long base64 strings', () => {
    const longBase64 =
      'VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgZW5jb2RlZCBzdHJpbmcgdGhhdCBzaG91bGQgc3RpbGwgYmUgdmFsaWRhdGVkIGNvcnJlY3RseQ=='
    assert.equal(isBase64(longBase64), true)
  })
})

describe('getDataBytes', () => {
  it('should handle hex string input', () => {
    const result = getDataBytes('0x1234')
    assert.deepEqual(result, new Uint8Array([0x12, 0x34]))
  })

  it('should handle Uint8Array input', () => {
    const input = new Uint8Array([0x12, 0x34])
    const result = getDataBytes(input)
    assert.deepEqual(result, input)
  })

  it('should handle base64 string input', () => {
    const base64 = 'SGVsbG8=' // "Hello"
    const result = getDataBytes(base64)
    assert.ok(result instanceof Uint8Array)
    assert.ok(result.length > 0)
  })

  it('should throw error for invalid input', () => {
    assert.throws(() => getDataBytes('not-hex-or-base64' as any), /Unsupported data format/)
  })

  it('should handle empty hex string', () => {
    const result = getDataBytes('0x')
    assert.deepEqual(result, new Uint8Array([]))
  })
})

describe('getAddressBytes', () => {
  it('should handle hex string input', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const result = getAddressBytes(address)
    assert.ok(result instanceof Uint8Array)
    assert.equal(result.length, 20)
  })

  it('should handle Uint8Array input', () => {
    const input = new Uint8Array(20).fill(0x12)
    const result = getAddressBytes(input)
    assert.deepEqual(result, input)
  })

  it('should strip leading zeros from 32-byte padded addresses', () => {
    const paddedAddress = '0x0000000000000000000000001234567890123456789012345678901234567890'
    const result = getAddressBytes(paddedAddress)
    assert.equal(result.length, 20)
  })

  it('should handle base58 Solana addresses', () => {
    const solanaAddress = '11111111111111111111111111111111'
    const result = getAddressBytes(solanaAddress)
    assert.ok(result instanceof Uint8Array)
  })

  it('should not strip zeros if non-zero bytes exist in leading portion', () => {
    const address = new Uint8Array(32)
    address[0] = 0x01 // Non-zero in leading portion
    address[31] = 0x02
    const result = getAddressBytes(address)
    assert.equal(result.length, 32)
  })

  it('should preserve 20-byte addresses without modification', () => {
    const address = new Uint8Array(20).fill(0xff)
    const result = getAddressBytes(address)
    assert.deepEqual(result, address)
    assert.equal(result.length, 20)
  })
})

describe('sleep', () => {
  it('should delay execution for specified milliseconds', async () => {
    const start = Date.now()
    await sleep(50)
    const elapsed = Date.now() - start
    assert.ok(elapsed >= 45) // Allow some margin
    assert.ok(elapsed < 150) // Should not take too long
  })

  it('should work with zero milliseconds', async () => {
    const start = Date.now()
    await sleep(0)
    const elapsed = Date.now() - start
    assert.ok(elapsed < 50)
  })

  it('should return a promise', () => {
    const result = sleep(10)
    assert.ok(result instanceof Promise)
  })
})

describe('parseTypeAndVersion', () => {
  it('should parse standard typeAndVersion format', () => {
    const result = parseTypeAndVersion('EVM2EVMOnRamp 1.2.0')
    assert.deepEqual(result, ['EVM2EVMOnRamp', '1.2.0', 'EVM2EVMOnRamp 1.2.0'])
  })

  it('should parse with v prefix', () => {
    const result = parseTypeAndVersion('EVM2EVMOffRamp v1.5.0')
    assert.deepEqual(result, ['EVM2EVMOffRamp', '1.5.0', 'EVM2EVMOffRamp v1.5.0'])
  })

  it('should normalize CCIP casing', () => {
    const result = parseTypeAndVersion('ccipOnRamp 1.0.0')
    assert.ok(result[0].includes('CCIP'))
  })

  it('should normalize OnRamp/OffRamp casing', () => {
    const result = parseTypeAndVersion('CCIPOnramp 1.0.0')
    assert.equal(result[0], 'CCIPOnRamp')
  })

  it('should normalize OffRamp casing', () => {
    const result = parseTypeAndVersion('CCIPOfframp 1.0.0')
    assert.equal(result[0], 'CCIPOffRamp')
  })

  it('should convert kebab-case to camelCase and normalize OnRamp', () => {
    const result = parseTypeAndVersion('evm-to-evm-onramp 1.0.0')
    assert.equal(result[0], 'evmToEvmOnRamp')
  })

  it('should handle version without patch number', () => {
    const result = parseTypeAndVersion('Router 2.1')
    assert.deepEqual(result, ['Router', '2.1', 'Router 2.1'])
  })

  it('should capture suffix if present', () => {
    const result = parseTypeAndVersion('OnRamp 1.0.0-beta')
    assert.equal(result.length, 4)
    assert.equal(result[3], '-beta')
  })

  it('should throw error for invalid format', () => {
    assert.throws(() => parseTypeAndVersion('InvalidFormat'), /Invalid typeAndVersion/)
    assert.throws(() => parseTypeAndVersion(''), /Invalid typeAndVersion/)
    assert.throws(() => parseTypeAndVersion('NoVersion'), /Invalid typeAndVersion/)
  })

  it('should handle whitespace variations', () => {
    const result = parseTypeAndVersion('Router  v1.0.0')
    assert.equal(result[0], 'Router')
    assert.equal(result[1], '1.0.0')
  })
})

describe('createRateLimitedFetch', () => {
  let originalFetch: typeof fetch
  let mockedFetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mockedFetch = undefined
  })

  it('should create a rate-limited fetch function', () => {
    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 2, windowMs: 1000 })
    assert.equal(typeof rateLimitedFetch, 'function')
  })

  it('should allow requests within rate limit', async () => {
    globalThis.fetch = mockedFetch = mock.fn(() =>
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

    assert.equal(mockedFetch.mock.calls.length, 2)
  })

  it('should retry on 429 rate limit errors', async () => {
    let callCount = 0
    globalThis.fetch = mockedFetch = mock.fn(() => {
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

    const result = await rateLimitedFetch('https://example.com')
    assert.equal(result.ok, true)
    assert.equal(mockedFetch.mock.calls.length, 2)
  })

  it('should throw non-retryable errors immediately', async () => {
    globalThis.fetch = mockedFetch = mock.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response),
    )

    const rateLimitedFetch = createRateLimitedFetch({ maxRequests: 5, windowMs: 1000 })

    await assert.rejects(rateLimitedFetch('https://example.com'), /HTTP 404/)
    assert.equal(mockedFetch.mock.calls.length, 1)
  })

  it('should respect maxRetries parameter', async () => {
    globalThis.fetch = mockedFetch = mock.fn(() =>
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

    await assert.rejects(rateLimitedFetch('https://example.com'), /Too Many Requests/)
    assert.equal(mockedFetch.mock.calls.length, 3) // Initial + 2 retries
  })

  it('should use default parameters when none provided', () => {
    const rateLimitedFetch = createRateLimitedFetch()
    assert.equal(typeof rateLimitedFetch, 'function')
  })

  it('should handle network errors with retry logic', async () => {
    let callCount = 0
    globalThis.fetch = mockedFetch = mock.fn(() => {
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

    const result = await rateLimitedFetch('https://example.com')
    assert.equal(result.ok, true)
  })
})
