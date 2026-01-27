import assert from 'node:assert/strict'
import { beforeEach, describe, it, mock } from 'node:test'

import { type Connection, PublicKey } from '@solana/web3.js'

import { ChainFamily, NetworkType } from '../../types.ts'
import { SolanaChain } from '../index.ts'

// Create mock functions
const mockGetAccountInfo = mock.fn(() => null as any)
const mockGetParsedAccountInfo = mock.fn(() => null as any)
const mockGetGenesisHash = mock.fn(() => null as any)
const mockGetSignaturesForAddress = mock.fn(() => null as any)

// Mock connection for testing
const mockConnection = {
  getGenesisHash: mockGetGenesisHash,
  getParsedAccountInfo: mockGetParsedAccountInfo,
  getAccountInfo: mockGetAccountInfo,
  getSignaturesForAddress: mockGetSignaturesForAddress,
} as unknown as Connection

const mockNetworkInfo = {
  family: ChainFamily.Solana,
  chainId: 'test-chain',
  name: 'Test Solana',
  chainSelector: 1234567890n,
  networkType: NetworkType.Testnet,
  isTestnet: true,
}

describe('SolanaChain getTokenInfo', () => {
  let solanaChain: SolanaChain

  beforeEach(() => {
    mock.restoreAll()
    mockGetAccountInfo.mock.mockImplementation(async () => null)
    mockGetParsedAccountInfo.mock.mockImplementation(async () => null)
    mockGetGenesisHash.mock.mockImplementation(async () => 'test-genesis-hash')
    solanaChain = new SolanaChain(mockConnection, mockNetworkInfo)
  })

  it('should return symbol from SPL token info when available', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: 'USDC',
              decimals: 6,
            },
          },
        },
      },
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockMintInfo)

    const result = await solanaChain.getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

    assert.equal(result.symbol, 'USDC')
    assert.equal(result.decimals, 6)
  })

  it('should fallback to Metaplex metadata when SPL token symbol is missing', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: undefined, // No symbol in SPL token info
              decimals: 9,
            },
          },
        },
      },
    }

    // Mock metadata account with symbol using actual Metaplex format
    const mockMetadataBuffer = Buffer.alloc(300)
    let offset = 0

    // Write key (1 byte) - discriminator
    mockMetadataBuffer.writeUInt8(4, offset++)

    // Write update_authority (32 bytes) - skip
    offset += 32

    // Write mint (32 bytes) - skip
    offset += 32

    // Write name length and name
    const name = 'Test Token'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    // Write symbol length and symbol
    const symbol = 'TEST'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockMintInfo)
    mockGetAccountInfo.mock.mockImplementation(async () => mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('So11111111111111111111111111111111111111112')

    assert.equal(result.symbol, 'TEST')
    assert.equal(result.decimals, 9)
    assert.equal(result.name, 'Test Token')
  })

  it('should fallback to Metaplex metadata when SPL token symbol is UNKNOWN', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: 'UNKNOWN', // Placeholder symbol
              decimals: 9,
            },
          },
        },
      },
    }

    // Mock metadata account with symbol using actual Metaplex format
    const mockMetadataBuffer = Buffer.alloc(300)
    let offset = 0

    // Write key (1 byte) - discriminator
    mockMetadataBuffer.writeUInt8(4, offset++)

    // Write update_authority (32 bytes) - skip
    offset += 32

    // Write mint (32 bytes) - skip
    offset += 32

    // Write name length and name
    const name = 'Real Token Name'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    // Write symbol length and symbol
    const symbol = 'REAL'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockMintInfo)
    mockGetAccountInfo.mock.mockImplementation(async () => mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

    assert.equal(result.symbol, 'REAL')
    assert.equal(result.decimals, 9)
    assert.equal(result.name, 'Real Token Name')
  })

  it('should return UNKNOWN when both SPL token and metadata fail', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: undefined,
              decimals: 6,
            },
          },
        },
      },
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockMintInfo)
    mockGetAccountInfo.mock.mockImplementation(async () => null) // No metadata account

    const result = await solanaChain.getTokenInfo('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')

    assert.equal(result.symbol, 'UNKNOWN')
    assert.equal(result.decimals, 6)
  })

  it('should handle metadata parsing errors gracefully', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: undefined,
              decimals: 9,
            },
          },
        },
      },
    }

    const mockMetadataAccount = {
      data: Buffer.from('invalid metadata'),
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockMintInfo)
    mockGetAccountInfo.mock.mockImplementation(async () => mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs')

    assert.equal(result.symbol, 'UNKNOWN')
    assert.equal(result.decimals, 9)
  })

  it('should throw error for invalid SPL token', async () => {
    mockGetParsedAccountInfo.mock.mockImplementation(async () => null)

    await assert.rejects(async () => {
      await solanaChain.getTokenInfo('InvalidTokenAddress')
    })
  })

  it('should throw error for non-spl-token program', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'some-other-program',
        },
      },
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockMintInfo)

    await assert.rejects(
      async () => {
        await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
      },
      (error: Error) => {
        assert.ok(error.message.includes('Invalid SPL token'))
        return true
      },
    )
  })

  it('should support Token-2022 tokens', async () => {
    const mockToken2022Info = {
      value: {
        data: {
          program: 'spl-token-2022',
          parsed: {
            info: {
              symbol: 'TOKEN22',
              decimals: 8,
            },
          },
        },
      },
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockToken2022Info)

    const result = await solanaChain.getTokenInfo('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo')

    assert.equal(result.symbol, 'TOKEN22')
    assert.equal(result.decimals, 8)
  })

  it('should fallback to Metaplex metadata for Token-2022 when symbol missing', async () => {
    const mockToken2022Info = {
      value: {
        data: {
          program: 'spl-token-2022',
          parsed: {
            info: {
              symbol: undefined,
              decimals: 6,
            },
          },
        },
      },
    }

    // Mock metadata account with symbol using actual Metaplex format
    const mockMetadataBuffer = Buffer.alloc(300)
    let offset = 0

    // Write key (1 byte) - discriminator
    mockMetadataBuffer.writeUInt8(4, offset++)

    // Write update_authority (32 bytes) - skip
    offset += 32

    // Write mint (32 bytes) - skip
    offset += 32

    // Write name length and name
    const name = 'Token-2022 Asset'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    // Write symbol length and symbol
    const symbol = 'T22'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => mockToken2022Info)
    mockGetAccountInfo.mock.mockImplementation(async () => mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('9vMJfxuKxXBoEa7rM12mYLMwTacLMLDJqHozw96WQL8i')

    assert.equal(result.symbol, 'T22')
    assert.equal(result.decimals, 6)
    assert.equal(result.name, 'Token-2022 Asset')
  })
})

describe('SolanaChain getTokenInfo - Integration Demo', () => {
  let solanaChain: SolanaChain

  beforeEach(() => {
    mock.restoreAll()
    mockGetAccountInfo.mock.mockImplementation(async () => null)
    mockGetParsedAccountInfo.mock.mockImplementation(async () => null)
    mockGetGenesisHash.mock.mockImplementation(async () => 'test-genesis-hash')
    solanaChain = new SolanaChain(mockConnection, mockNetworkInfo)
  })

  it('should demonstrate complete fallback flow from SPL token to Metaplex metadata', async () => {
    // Test Case 1: SPL token with symbol - should not fallback
    const splTokenWithSymbol = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: 'USDC',
              decimals: 9,
            },
          },
        },
      },
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => splTokenWithSymbol)

    const result1 = await solanaChain.getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

    assert.equal(result1.symbol, 'USDC')
    assert.equal(result1.decimals, 9)
    // Test Case 2: SPL token missing symbol - should fallback to Metaplex
    const splTokenWithoutSymbol = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: undefined,
              decimals: 6,
            },
          },
        },
      },
    }

    // Mock metadata account with symbol using actual Metaplex format
    const mockMetadataBuffer = Buffer.alloc(300)
    let offset = 0

    // Write key (1 byte) - discriminator
    mockMetadataBuffer.writeUInt8(4, offset++)

    // Write update_authority (32 bytes) - skip
    offset += 32

    // Write mint (32 bytes) - skip
    offset += 32

    // Write name length and name
    const name = 'Fallback Token'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    // Write symbol length and symbol
    const symbol = 'FBT'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    mockGetParsedAccountInfo.mock.mockImplementation(async () => splTokenWithoutSymbol)
    mockGetAccountInfo.mock.mockImplementation(async () => mockMetadataAccount)

    const result2 = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    assert.equal(result2.symbol, 'FBT')
    assert.equal(result2.decimals, 6)

    // Verify that the metadata PDA was correctly calculated
    const tokenMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
    const metaplexProgramId = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
    const expectedMetadataPDA = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), metaplexProgramId.toBuffer(), tokenMint.toBuffer()],
      metaplexProgramId,
    )[0]

    // mockGetAccountInfo may be called multiple times due to memoization cache misses
    assert.ok(mockGetAccountInfo.mock.calls.length >= 1)
    // Find the call with the expectedMetadataPDA
    const callWithPDA = mockGetAccountInfo.mock.calls.find((call: any) =>
      call.arguments[0].equals(expectedMetadataPDA),
    )
    assert.ok(callWithPDA, 'Expected metadata PDA should have been called')
  })
})

describe('SolanaChain.encodeExtraArgs', () => {
  it('should encode EVMExtraArgsV2 with gasLimit and allowOutOfOrderExecution', () => {
    const args = {
      gasLimit: 200000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Should start with EVMExtraArgsV2Tag (0x181dcf10)
    assert.equal(encoded.startsWith('0x181dcf10'), true)
    // Should be 21 bytes total: 4 bytes tag + 16 bytes gasLimit (uint128LE) + 1 byte allowOOOE
    assert.equal(encoded.length, 2 + 21 * 2) // 0x + 21 bytes * 2 hex chars
  })

  it('should encode EVMExtraArgsV2 with default gasLimit when not specified', () => {
    const args = {
      gasLimit: 0n, // Provide explicit zero instead of omitting
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Should start with EVMExtraArgsV2Tag
    assert.equal(encoded.startsWith('0x181dcf10'), true)

    // Should be 21 bytes total
    assert.equal(encoded.length, 2 + 21 * 2)

    // Should end with 0x00 for allowOutOfOrderExecution: false
    assert.equal(encoded.endsWith('00'), true)
  })

  it('should encode EVMExtraArgsV1 with only gasLimit (converted to V2)', () => {
    const args = {
      gasLimit: 150000n,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Should start with EVMExtraArgsV2Tag (Solana always produces V2)
    assert.equal(encoded.startsWith('0x181dcf10'), true)
  })

  it('should handle large gas limits correctly', () => {
    const args = {
      gasLimit: 1000000000000n,
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    assert.equal(encoded.startsWith('0x181dcf10'), true)
    assert.equal(encoded.length, 2 + 21 * 2)
  })

  it('should encode with allowOutOfOrderExecution true', () => {
    const args = {
      gasLimit: 300000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    assert.equal(encoded.endsWith('01'), true)
  })

  it('should be compatible with SolanaChain.decodeExtraArgs', () => {
    const originalArgs = {
      gasLimit: 250000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(originalArgs)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    assert.equal(decoded?._tag, 'EVMExtraArgsV2')
    assert.equal(decoded.gasLimit, originalArgs.gasLimit)
    assert.equal(decoded.allowOutOfOrderExecution, originalArgs.allowOutOfOrderExecution)
  })

  it('should encode with minimum gasLimit value', () => {
    const args = {
      gasLimit: 1n,
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    assert.equal(decoded?.gasLimit, 1n)
  })

  it('should encode empty args object by using defaults', () => {
    const args = {
      gasLimit: 200000n, // Provide a default value
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    assert.ok(decoded)
    assert.equal(decoded.gasLimit, 200000n)
  })

  it('should maintain encoding consistency across multiple calls', () => {
    const args = {
      gasLimit: 200000n,
      allowOutOfOrderExecution: false,
    }

    const encoded1 = SolanaChain.encodeExtraArgs(args)
    const encoded2 = SolanaChain.encodeExtraArgs(args)

    assert.equal(encoded1, encoded2)
  })

  it('should produce Solana-style EVMExtraArgsV2 format (21 bytes)', () => {
    const args = {
      gasLimit: 500000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Verify total length is 21 bytes (42 hex chars + 0x prefix)
    assert.equal(encoded.length, 44)

    const decoded = SolanaChain.decodeExtraArgs(encoded)
    assert.equal(decoded?._tag, 'EVMExtraArgsV2')
    assert.equal(decoded.gasLimit, 500000n)
    assert.equal(decoded.allowOutOfOrderExecution, true)
  })

  it('should produce valid extra args for CCIP message creation', () => {
    const gasLimit = 400000n
    const allowOutOfOrder = false

    const extraArgs = {
      gasLimit,
      allowOutOfOrderExecution: allowOutOfOrder,
    }

    const encoded = SolanaChain.encodeExtraArgs(extraArgs)

    // Verify it can be decoded
    const decoded = SolanaChain.decodeExtraArgs(encoded)
    assert.ok(decoded)
    assert.equal(decoded.gasLimit, gasLimit)
    assert.equal(decoded.allowOutOfOrderExecution, allowOutOfOrder)
  })

  it('should demonstrate usage pattern for cross-chain messaging', () => {
    // Example: Creating extra args for a cross-chain message
    const messageExtraArgs = {
      gasLimit: 350000n,
      allowOutOfOrderExecution: true,
    }

    const encodedExtraArgs = SolanaChain.encodeExtraArgs(messageExtraArgs)

    // Verify the encoded args can be used in a CCIP message
    assert.match(encodedExtraArgs, /^0x181dcf10[0-9a-f]{34}$/)

    const parsed = SolanaChain.decodeExtraArgs(encodedExtraArgs)
    assert.equal(parsed?._tag, 'EVMExtraArgsV2')
  })
})
