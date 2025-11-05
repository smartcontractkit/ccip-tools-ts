import { type Connection, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../chain.ts'
import { SolanaChain } from '../index.ts'

// Mock connection for testing
const mockConnection = {
  getGenesisHash: jest.fn(),
  getParsedAccountInfo: jest.fn(),
  getAccountInfo: jest.fn(),
} as unknown as Connection

const mockNetworkInfo = {
  family: ChainFamily.Solana,
  chainId: 'test-chain',
  name: 'Test Solana',
  chainSelector: 1234567890n,
  isTestnet: true,
}

describe('SolanaChain getTokenInfo', () => {
  let solanaChain: SolanaChain

  beforeEach(() => {
    jest.clearAllMocks()
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

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockMintInfo)

    const result = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    expect(result).toEqual({
      symbol: 'USDC',
      decimals: 6,
    })
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

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockMintInfo)
    ;(mockConnection.getAccountInfo as jest.Mock).mockResolvedValue(mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    expect(result).toEqual({
      symbol: 'TEST',
      decimals: 9,
    })
  })

  it('should fallback to Metaplex metadata when SPL token symbol is UNKNOWN', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: '', // Empty symbol in SPL token info
              decimals: 8,
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
    const name = 'Another Token'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    // Write symbol length and symbol
    const symbol = 'ANOTHER'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockMintInfo)
    ;(mockConnection.getAccountInfo as jest.Mock).mockResolvedValue(mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    expect(result).toEqual({
      symbol: 'ANOTHER',
      decimals: 8,
    })
  })

  it('should return UNKNOWN when both SPL token and metadata fail', async () => {
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

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockMintInfo)
    ;(mockConnection.getAccountInfo as jest.Mock).mockResolvedValue(null) // No metadata account

    const result = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    expect(result).toEqual({
      symbol: 'UNKNOWN',
      decimals: 9,
    })
  })

  it('should handle metadata parsing errors gracefully', async () => {
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

    // Mock metadata account with invalid/corrupted data
    const mockMetadataAccount = {
      data: Buffer.alloc(10), // Too small buffer
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockMintInfo)
    ;(mockConnection.getAccountInfo as jest.Mock).mockResolvedValue(mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    expect(result).toEqual({
      symbol: 'UNKNOWN',
      decimals: 6,
    })
  })

  it('should throw error for invalid SPL token', async () => {
    await expect(solanaChain.getTokenInfo('InvalidTokenAddress')).rejects.toThrow(
      'Non-base58 character',
    )
  })

  it('should throw error for non-spl-token program', async () => {
    const mockMintInfo = {
      value: {
        data: {
          program: 'not-spl-token',
        },
      },
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockMintInfo)

    await expect(
      solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    ).rejects.toThrow(
      'Invalid SPL token or Token-2022: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    )
  })

  it('should support Token-2022 tokens', async () => {
    const mockToken2022Info = {
      value: {
        data: {
          program: 'spl-token-2022',
          parsed: {
            info: {
              symbol: 'T2022',
              decimals: 8,
            },
          },
        },
      },
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockToken2022Info)

    const result = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

    expect(result).toEqual({
      symbol: 'T2022',
      decimals: 8,
    })
  })

  it('should fallback to Metaplex metadata for Token-2022 when symbol missing', async () => {
    const mockToken2022Info = {
      value: {
        data: {
          program: 'spl-token-2022',
          parsed: {
            info: {
              symbol: undefined,
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
    const name = 'Token 2022 Test'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    // Write symbol length and symbol
    const symbol = 'T2022META'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValue(mockToken2022Info)
    ;(mockConnection.getAccountInfo as jest.Mock).mockResolvedValue(mockMetadataAccount)

    const result = await solanaChain.getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

    expect(result).toEqual({
      symbol: 'T2022META',
      decimals: 9,
    })
  })
})

describe('SolanaChain getTokenInfo - Integration Demo', () => {
  let solanaChain: SolanaChain

  beforeEach(() => {
    jest.clearAllMocks()
    solanaChain = new SolanaChain(mockConnection, mockNetworkInfo)
  })

  it('should demonstrate complete fallback flow from SPL token to Metaplex metadata', async () => {
    // Test Case 1: SPL token has symbol - should not need fallback
    const splTokenWithSymbol = {
      value: {
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              symbol: 'NATIVE',
              decimals: 9,
            },
          },
        },
      },
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValueOnce(splTokenWithSymbol)

    const result1 = await solanaChain.getTokenInfo('So11111111111111111111111111111111111111112')
    expect(result1.symbol).toBe('NATIVE')
    expect(result1.decimals).toBe(9)
    // Should not call getAccountInfo for metadata since symbol exists
    expect(mockConnection.getAccountInfo).not.toHaveBeenCalled()

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

    // Create mock metadata with "CUSTOM" symbol using actual Metaplex format
    const mockMetadataBuffer = Buffer.alloc(300)
    let offset = 0

    // Write key (1 byte) - discriminator
    mockMetadataBuffer.writeUInt8(4, offset++)

    // Write update_authority (32 bytes) - skip
    offset += 32

    // Write mint (32 bytes) - skip
    offset += 32

    const name = 'Custom Token'
    mockMetadataBuffer.writeUInt32LE(name.length, offset)
    offset += 4
    mockMetadataBuffer.write(name, offset, 'utf8')
    offset += name.length

    const symbol = 'CUSTOM'
    mockMetadataBuffer.writeUInt32LE(symbol.length, offset)
    offset += 4
    mockMetadataBuffer.write(symbol, offset, 'utf8')

    const mockMetadataAccount = {
      data: mockMetadataBuffer,
    }

    ;(mockConnection.getParsedAccountInfo as jest.Mock).mockResolvedValueOnce(splTokenWithoutSymbol)
    ;(mockConnection.getAccountInfo as jest.Mock).mockResolvedValueOnce(mockMetadataAccount)

    const result2 = await solanaChain.getTokenInfo('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
    expect(result2.symbol).toBe('CUSTOM')
    expect(result2.decimals).toBe(6)
    // Should have called getAccountInfo for metadata fallback
    expect(mockConnection.getAccountInfo).toHaveBeenCalledTimes(1)

    // Verify the metadata PDA was derived correctly
    const expectedMetadataPDA = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
        new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU').toBuffer(),
      ],
      new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
    )[0]

    expect(mockConnection.getAccountInfo).toHaveBeenCalledWith(expectedMetadataPDA)
  })
})

describe('SolanaChain.encodeExtraArgs', () => {
  it('should encode EVMExtraArgsV2 with gasLimit and allowOutOfOrderExecution', () => {
    const args = {
      gasLimit: 300000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Should start with EVMExtraArgsV2Tag (0x181dcf10)
    expect(encoded.startsWith('0x181dcf10')).toBe(true)

    // Should be 21 bytes total: 4 bytes tag + 16 bytes gasLimit (uint128LE) + 1 byte allowOOOE
    expect(encoded.length).toBe(2 + 21 * 2) // 0x + 21 bytes * 2 hex chars
  })

  it('should encode EVMExtraArgsV2 with default gasLimit when not specified', () => {
    const args = {
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Should start with EVMExtraArgsV2Tag
    expect(encoded.startsWith('0x181dcf10')).toBe(true)

    // Should be 21 bytes total
    expect(encoded.length).toBe(2 + 21 * 2)

    // Should end with 0x00 for allowOutOfOrderExecution: false
    expect(encoded.endsWith('00')).toBe(true)
  })

  it('should encode EVMExtraArgsV1 with only gasLimit (converted to V2)', () => {
    const args = {
      gasLimit: 250000n,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // From Solana, EVMExtraArgsV1 should be converted to EVMExtraArgsV2 with allowOOOE=false
    expect(encoded.startsWith('0x181dcf10')).toBe(true)
    expect(encoded.length).toBe(2 + 21 * 2)
    expect(encoded.endsWith('00')).toBe(true) // allowOutOfOrderExecution defaults to false
  })

  it('should handle large gas limits correctly', () => {
    const args = {
      gasLimit: 0xffffffffffffffffn, // Max uint64 value
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    expect(encoded.startsWith('0x181dcf10')).toBe(true)
    expect(encoded.length).toBe(2 + 21 * 2)
    expect(encoded.endsWith('01')).toBe(true) // allowOutOfOrderExecution: true
  })

  it('should encode with allowOutOfOrderExecution true', () => {
    const args = {
      gasLimit: 500000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    expect(encoded.startsWith('0x181dcf10')).toBe(true)
    expect(encoded.endsWith('01')).toBe(true) // Should end with 0x01 for true
  })

  it('should be compatible with SolanaChain.decodeExtraArgs', () => {
    const originalArgs = {
      gasLimit: 350000n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(originalArgs)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    expect(decoded._tag).toBe('EVMExtraArgsV2')
    expect(decoded.gasLimit).toBe(originalArgs.gasLimit)
    expect(decoded.allowOutOfOrderExecution).toBe(originalArgs.allowOutOfOrderExecution)
  })

  it('should encode with minimum gasLimit value', () => {
    const args = {
      gasLimit: 0n,
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    expect(decoded.gasLimit).toBe(0n)
    expect(decoded.allowOutOfOrderExecution).toBe(false)
  })

  it('should encode empty args object by using defaults', () => {
    const args = {}

    const encoded = SolanaChain.encodeExtraArgs(args)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    expect(decoded._tag).toBe('EVMExtraArgsV2')
    expect(decoded.gasLimit).toBe(200000n) // DEFAULT_GAS_LIMIT
    expect(decoded.allowOutOfOrderExecution).toBe(false)
  })

  it('should maintain encoding consistency across multiple calls', () => {
    const args = {
      gasLimit: 123456n,
      allowOutOfOrderExecution: true,
    }

    const encoded1 = SolanaChain.encodeExtraArgs(args)
    const encoded2 = SolanaChain.encodeExtraArgs(args)

    expect(encoded1).toBe(encoded2)
  })

  it('should produce Solana-style EVMExtraArgsV2 format (21 bytes)', () => {
    const args = {
      gasLimit: 999999n,
      allowOutOfOrderExecution: true,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)

    // Solana format: 4 bytes tag + 16 bytes gasLimit (uint128LE) + 1 byte allowOOOE = 21 bytes total
    expect(encoded.length).toBe(2 + 21 * 2) // 0x + 42 hex chars

    // Decode to verify format matches expected Solana style
    const decoded = SolanaChain.decodeExtraArgs(encoded)
    expect(decoded._tag).toBe('EVMExtraArgsV2')
    expect(decoded.gasLimit).toBe(args.gasLimit)
    expect(decoded.allowOutOfOrderExecution).toBe(args.allowOutOfOrderExecution)
  })
  it('should produce valid extra args for CCIP message creation', () => {
    const gasLimit = 500000n
    const allowOutOfOrder = true

    const extraArgs = SolanaChain.encodeExtraArgs({
      gasLimit,
      allowOutOfOrderExecution: allowOutOfOrder,
    })

    // Verify it starts with the correct tag for EVMExtraArgsV2
    expect(extraArgs).toMatch(/^0x181dcf10/)

    // Verify it can be decoded back correctly
    const decoded = SolanaChain.decodeExtraArgs(extraArgs)
    expect(decoded._tag).toBe('EVMExtraArgsV2')
    expect(decoded.gasLimit).toBe(gasLimit)
    expect(decoded.allowOutOfOrderExecution).toBe(allowOutOfOrder)

    // Verify the encoding matches the Solana-specific format (21 bytes total)
    expect(extraArgs.length).toBe(44) // 0x + 42 hex characters = 21 bytes
  })

  it('should demonstrate usage pattern for cross-chain messaging', () => {
    // Common usage pattern: create extra args for a cross-chain transfer
    const messageExtraArgs = SolanaChain.encodeExtraArgs({
      gasLimit: 300000n, // Gas limit for destination chain execution
      allowOutOfOrderExecution: false, // Enforce sequential execution
    })

    // Verify this would be a valid extra args field for a CCIP message
    expect(typeof messageExtraArgs).toBe('string')
    expect(messageExtraArgs.startsWith('0x')).toBe(true)
    expect(messageExtraArgs.length).toBeGreaterThan(10) // Has meaningful content

    // Should be decodeable
    const parsed = SolanaChain.decodeExtraArgs(messageExtraArgs)
    expect(parsed).toBeDefined()
    expect(parsed?._tag).toBe('EVMExtraArgsV2')
  })
})
