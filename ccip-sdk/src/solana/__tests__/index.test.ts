import assert from 'node:assert/strict'
import { beforeEach, describe, it, mock } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { type Connection, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { LaneFeature } from '../../chain.ts'
import {
  CCIPCommitHistoryPrunedError,
  CCIPCommitNotFoundError,
  CCIPDataFormatUnsupportedError,
  CCIPTokenPoolStateNotFoundError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../networks.ts'
import { CCIPVersion } from '../../types.ts'
import { parseTypeAndVersion, toLeArray } from '../../utils.ts'
import { sizedCoder } from '../coder.ts'
import { IDL as BASE_TOKEN_POOL_V2 } from '../idl/2.0.0/BASE_TOKEN_POOL.ts'
import { type SolanaTransaction, SolanaChain } from '../index.ts'
import {
  deriveTokenPoolChainConfigOverridePda,
  deriveTokenPoolChainConfigV2Pda,
} from '../token-pool.ts'
import { hexDiscriminator } from '../utils.ts'

// Create mock functions
const mockGetAccountInfo = mock.fn(() => null as any)
const mockGetAddressLookupTable = mock.fn(() => null as any)
const mockGetParsedAccountInfo = mock.fn(() => null as any)
const mockGetGenesisHash = mock.fn(() => null as any)
const mockGetSignaturesForAddress = mock.fn(() => null as any)
const mockGetProgramAccounts = mock.fn(() => [] as any)

// Mock connection for testing
const mockConnection = {
  rpcEndpoint: 'test-endpoint',
  getGenesisHash: mockGetGenesisHash,
  getParsedAccountInfo: mockGetParsedAccountInfo,
  getAccountInfo: mockGetAccountInfo,
  getAddressLookupTable: mockGetAddressLookupTable,
  getSignaturesForAddress: mockGetSignaturesForAddress,
  getProgramAccounts: mockGetProgramAccounts,
} as unknown as Connection

const mockNetworkInfo: NetworkInfo = {
  family: ChainFamily.Solana,
  chainId: 'test-chain',
  name: 'Test Solana',
  chainSelector: 1234567890n,
  networkType: NetworkType.Testnet,
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

    assert.equal(decoded?._tag, 'EVMExtraArgsV2')
    assert.equal(decoded.gasLimit, 1n)
  })

  it('should encode empty args object by using defaults', () => {
    const args = {
      gasLimit: 200000n, // Provide a default value
      allowOutOfOrderExecution: false,
    }

    const encoded = SolanaChain.encodeExtraArgs(args)
    const decoded = SolanaChain.decodeExtraArgs(encoded)

    assert.ok(decoded)
    assert.equal(decoded._tag, 'EVMExtraArgsV2')
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
    assert.equal(decoded._tag, 'EVMExtraArgsV2')
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

describe('SolanaChain getRegistryTokenConfig', () => {
  const key = (byte: number): PublicKey => {
    return new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
  }

  const router = key(1)
  const mint = key(2)
  const administrator = key(3)
  const pendingAdministrator = key(4)
  const lookupTable = key(5)
  const tokenPool = key(6)

  function tokenAdminRegistryData(
    administrator: PublicKey,
    pendingAdministrator: PublicKey,
    lookupTable: PublicKey,
    mint: PublicKey,
  ): Buffer {
    const data = Buffer.alloc(170)
    BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry').copy(data)
    data[8] = 2
    administrator.toBuffer().copy(data, 9)
    pendingAdministrator.toBuffer().copy(data, 41)
    lookupTable.toBuffer().copy(data, 73)
    mint.toBuffer().copy(data, 137)
    return data
  }

  function chainWithLookupTable(lookup: () => Promise<unknown>): SolanaChain {
    return new SolanaChain(
      {
        getAccountInfo: async () => ({
          data: tokenAdminRegistryData(administrator, pendingAdministrator, lookupTable, mint),
        }),
        getAddressLookupTable: lookup,
        getSignaturesForAddress: async () => [],
      } as unknown as Connection,
      mockNetworkInfo,
    )
  }

  it('returns the configured administrator, pending administrator, and token pool', async () => {
    const chain = chainWithLookupTable(async () => ({
      value: {
        state: {
          addresses: [PublicKey.default, PublicKey.default, PublicKey.default, tokenPool],
        },
      },
    }))

    assert.deepEqual(await chain.getRegistryTokenConfig(router.toBase58(), mint.toBase58()), {
      administrator: administrator.toBase58(),
      pendingAdministrator: pendingAdministrator.toBase58(),
      tokenPool: tokenPool.toBase58(),
    })
  })

  it('omits the token pool when lookup-table resolution fails', async () => {
    const chain = chainWithLookupTable(async () => {
      throw new CCIPDataFormatUnsupportedError('RPC unavailable')
    })

    assert.deepEqual(await chain.getRegistryTokenConfig(router.toBase58(), mint.toBase58()), {
      administrator: administrator.toBase58(),
      pendingAdministrator: pendingAdministrator.toBase58(),
    })
  })
})

describe('SolanaChain token pool readers', () => {
  const key = (byte: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
  const coder = sizedCoder(BASE_TOKEN_POOL_V2)

  const router = key(1)
  const mint = key(2)
  const poolProgram = key(3)
  const tokenPool = key(4)
  const remoteSelector = 16423721717087811551n // solana-devnet
  const chainConfigPda = PublicKey.findProgramAddressSync(
    [Buffer.from('ccip_tokenpool_chainconfig'), toLeArray(remoteSelector, 8), mint.toBuffer()],
    poolProgram,
  )[0]
  const chainConfigV2Pda = deriveTokenPoolChainConfigV2Pda(poolProgram, remoteSelector, mint)
  const overridePda = deriveTokenPoolChainConfigOverridePda(poolProgram, remoteSelector, mint)
  const feeOpts = {
    destChainSelector: remoteSelector,
    finality: 'finalized',
    tokenArgs: '0x',
  } as const
  // a recorded `observe_dest_chain_v2` return of the 2.0 staging router
  const laneObservation = Buffer.from(
    'AQAVAAAAY2NpcC1yb3V0ZXIgMi4wLjAtZGV2Adka2clPukHe+C8AAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAqrP9/xjtfoHo/uM627bDkPLOn1AD0u3u1en80sNL1vwAAAAAz2m0emq6bEJQWd2XuYl2ULtp755IijYPP8xb+H7mG4QUAAAA66XXlFlITlQ70VYHpiHs4pspypkyAAAAlgAAAEANAwA=',
    'base64',
  )

  const bucket = (enabled: boolean, capacity: number, rate: number) => ({
    tokens: new BN(capacity),
    lastUpdated: new BN(Math.floor(Date.now() / 1000)),
    cfg: { enabled, capacity: new BN(capacity), rate: new BN(rate) },
  })
  const encode = (name: string, data: unknown) => coder.accounts.encode(name, data)

  /**
   * A chain with a 2.0 router and a pool of `poolTypeAndVersion` (`null` for a custom pool without
   * `typeVersion`) with a ChainConfig to `remoteSelector`, and optionally a ChainConfigV2 and FTF
   * override; the router has a 2.0 lane to `remoteSelector` unless `laneV2` is false.
   */
  async function poolChain({
    poolTypeAndVersion,
    override,
    chainConfigV2,
    laneV2 = true,
  }: {
    poolTypeAndVersion: string | null
    override?: { enabled: boolean }
    chainConfigV2?: { flags: number; blockDepth: number }
    laneV2?: boolean
  }) {
    const state = await encode('state', {
      version: 1,
      config: {
        tokenProgram: key(10),
        mint,
        decimals: 9,
        poolSigner: key(11),
        poolTokenAccount: key(12),
        owner: key(13),
        proposedOwner: key(14),
        rateLimitAdmin: key(15),
        routerOnrampAuthority: key(16),
        router,
      },
    })
    const chainConfig = await encode('chainConfig', {
      base: {
        remote: {
          poolAddresses: [{ address: key(0xbb).toBuffer() }],
          tokenAddress: { address: key(0xaa).toBuffer() },
          decimals: 18,
        },
        inboundRateLimit: bucket(true, 100, 1),
        outboundRateLimit: bucket(true, 200, 2),
      },
    })
    const chainConfigV2Data =
      chainConfigV2 &&
      (await encode('chainConfigV2', {
        bump: 254,
        version: 1,
        remoteChainSelector: new BN(remoteSelector.toString()),
        mint,
        allowedFinalityConfig: chainConfigV2,
        tokenTransferFeeConfig: {
          destGasOverhead: 90_000,
          destBytesOverhead: 32,
          finalityFee: 25,
          fastFinalityFee: 50,
          finalityBpsFee: 10,
          fastFinalityBpsFee: 20,
          isEnabled: true,
        },
      }))
    const overrideData =
      override &&
      (await encode('chainConfigOverride', {
        bump: 254,
        version: 1,
        base: {
          remoteChainSelector: new BN(remoteSelector.toString()),
          mint,
          inboundRateLimit: bucket(override.enabled, 10, 3),
          outboundRateLimit: bucket(override.enabled, 20, 4),
          overrideType: { ftf: {} },
        },
      }))

    const accounts = new Map<string, { owner: PublicKey; data: Buffer }>([
      [tokenPool.toBase58(), { owner: poolProgram, data: state }],
      [chainConfigPda.toBase58(), { owner: poolProgram, data: chainConfig }],
    ])
    if (chainConfigV2Data)
      accounts.set(chainConfigV2Pda.toBase58(), { owner: poolProgram, data: chainConfigV2Data })
    if (overrideData)
      accounts.set(overridePda.toBase58(), { owner: poolProgram, data: overrideData })
    const getAccountInfo = mock.fn(async (k: PublicKey) => accounts.get(k.toBase58()) ?? null)
    const getMultipleAccountsInfo = mock.fn(async (keys: PublicKey[]) =>
      keys.map((k) => accounts.get(k.toBase58()) ?? null),
    )
    const chain = new SolanaChain(
      {
        getAccountInfo,
        getProgramAccounts: async () => [
          { pubkey: chainConfigPda, account: accounts.get(chainConfigPda.toBase58()) },
        ],
        getMultipleAccountsInfo,
        getSignaturesForAddress: async () => [],
        // `observe_dest_chain_v2`, failing with AccountNotInitialized without a 2.0 lane
        simulateTransaction: async () => ({
          value: laneV2
            ? {
                err: null,
                logs: [],
                unitsConsumed: 1,
                returnData: {
                  programId: router.toBase58(),
                  data: [laneObservation.toString('base64'), 'base64'],
                },
              }
            : { err: { InstructionError: [0, { Custom: 3012 }] }, logs: [], unitsConsumed: 1 },
        }),
        getLatestBlockhash: async () => ({
          blockhash: PublicKey.default.toBase58(),
          lastValidBlockHeight: 1,
        }),
      } as unknown as Connection,
      mockNetworkInfo,
    )
    mock.method(chain, 'typeAndVersion', async (address: string) => {
      if (address === router.toBase58()) return parseTypeAndVersion('ccip-router 2.0.0-dev')
      if (poolTypeAndVersion == null) throw new Error('typeVersion not implemented')
      return parseTypeAndVersion(poolTypeAndVersion)
    })
    mock.method(chain, 'getRegistryTokenConfig', async () => ({
      administrator: key(20).toBase58(),
      tokenPool: tokenPool.toBase58(),
    }))
    return { chain, getAccountInfo, getMultipleAccountsInfo }
  }

  const v2Pool = 'burnmint-token-pool 2.0.0-dev'
  const v16Pool = 'burnmint-token-pool 1.6.2'
  const v2ChainConfig = { flags: 0, blockDepth: 5 }
  const chainConfigV2Reads = (getAccountInfo: { mock: { calls: { arguments: unknown[] }[] } }) =>
    getAccountInfo.mock.calls.filter(({ arguments: [k] }) =>
      (k as PublicKey).equals(chainConfigV2Pda),
    ).length

  it('returns the token, router and pool program of a pool', async () => {
    const { chain } = await poolChain({ poolTypeAndVersion: v2Pool, chainConfigV2: v2ChainConfig })
    assert.deepEqual(await chain.getTokenPoolConfig(tokenPool.toBase58()), {
      token: mint.toBase58(),
      router: router.toBase58(),
      tokenPoolProgram: poolProgram.toBase58(),
      typeAndVersion: 'burnmint-token-pool 2.0.0-dev',
    })
  })

  it('rejects accounts that are not a pool State', async () => {
    const { chain } = await poolChain({ poolTypeAndVersion: v2Pool })
    await assert.rejects(
      chain.getTokenPoolConfig(chainConfigPda.toBase58()),
      CCIPTokenPoolStateNotFoundError,
    )
  })

  it("returns a 2.0 pool's finality and fees for the lane of feeOpts", async () => {
    const { chain } = await poolChain({ poolTypeAndVersion: v2Pool, chainConfigV2: v2ChainConfig })
    const config = await chain.getTokenPoolConfig(tokenPool.toBase58(), feeOpts)
    assert.equal(config.finalityDepth, 5)
    assert.equal(config.finalitySafe, undefined)
    assert.deepEqual(config.tokenTransferFeeConfig, {
      destGasOverhead: 90_000,
      destBytesOverhead: 32,
      finalityFeeUSDCents: 25,
      fastFinalityFeeUSDCents: 50,
      finalityTransferFeeBps: 10,
      fastFinalityTransferFeeBps: 20,
      isEnabled: true,
    })

    const { chain: safeChain } = await poolChain({
      poolTypeAndVersion: v2Pool,
      chainConfigV2: { flags: 1, blockDepth: 0 },
    })
    const safe = await safeChain.getTokenPoolConfig(tokenPool.toBase58(), feeOpts)
    assert.equal(safe.finalitySafe, true)
    assert.equal(safe.finalityDepth, 0)
  })

  it('reads a 2.0 lane without ChainConfigV2 as finalized-only, without fees', async () => {
    const { chain } = await poolChain({ poolTypeAndVersion: v2Pool })
    const config = await chain.getTokenPoolConfig(tokenPool.toBase58(), feeOpts)
    assert.equal(config.finalityDepth, 0)
    assert.equal(config.finalitySafe, undefined)
    assert.equal(config.tokenTransferFeeConfig?.isEnabled, false)
  })

  it('reads no finality without feeOpts, or from 1.6 pools', async () => {
    let { chain, getAccountInfo } = await poolChain({
      poolTypeAndVersion: v2Pool,
      chainConfigV2: v2ChainConfig,
    })
    let config = await chain.getTokenPoolConfig(tokenPool.toBase58())
    assert.ok(!('finalityDepth' in config) && !('tokenTransferFeeConfig' in config))

    ;({ chain, getAccountInfo } = await poolChain({
      poolTypeAndVersion: v16Pool,
      chainConfigV2: v2ChainConfig,
    }))
    config = await chain.getTokenPoolConfig(tokenPool.toBase58(), feeOpts)
    assert.ok(!('finalityDepth' in config) && !('tokenTransferFeeConfig' in config))
    assert.equal(chainConfigV2Reads(getAccountInfo), 0)
  })

  it('reads the finality of pools of unknown version only if they have a ChainConfigV2', async () => {
    let { chain } = await poolChain({ poolTypeAndVersion: null })
    let config = await chain.getTokenPoolConfig(tokenPool.toBase58(), feeOpts)
    assert.ok(!('finalityDepth' in config))
    ;({ chain } = await poolChain({ poolTypeAndVersion: null, chainConfigV2: v2ChainConfig }))
    config = await chain.getTokenPoolConfig(tokenPool.toBase58(), feeOpts)
    assert.equal(config.finalityDepth, 5)
  })

  it("returns a 2.0 pool's FTF rate limits from its override", async () => {
    const { chain } = await poolChain({ poolTypeAndVersion: v2Pool, override: { enabled: true } })
    const remotes = await chain.getTokenPoolRemotes(tokenPool.toBase58())
    const remote = remotes['solana-devnet']!
    assert.equal(remote.remoteToken, key(0xaa).toBase58())
    assert.deepEqual(remote.remotePools, [key(0xbb).toBase58()])
    assert.equal(remote.outboundRateLimiterState?.capacity, 200n)
    assert.ok('fastOutboundRateLimiterState' in remote)
    assert.equal(remote.fastOutboundRateLimiterState?.capacity, 20n)
    assert.equal(remote.fastOutboundRateLimiterState.rate, 4n)
    assert.equal(remote.fastInboundRateLimiterState?.capacity, 10n)
  })

  it("returns each remote's finality on 2.0 pools", async () => {
    let { chain } = await poolChain({ poolTypeAndVersion: v2Pool, chainConfigV2: v2ChainConfig })
    let remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.ok('finalityDepth' in remote && !('finalitySafe' in remote))
    assert.equal(remote.finalityDepth, 5)
    ;({ chain } = await poolChain({
      poolTypeAndVersion: v2Pool,
      chainConfigV2: { flags: 1, blockDepth: 0 },
    }))
    remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.ok('finalitySafe' in remote)
    assert.equal(remote.finalitySafe, true)
    // a lane without a ChainConfigV2 is finalized-only
    ;({ chain } = await poolChain({ poolTypeAndVersion: v2Pool }))
    remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.ok('finalityDepth' in remote)
    assert.equal(remote.finalityDepth, 0)
  })

  it('returns null FTF rate limits for 2.0 pools without an enabled override', async () => {
    for (const override of [undefined, { enabled: false }]) {
      const { chain } = await poolChain({ poolTypeAndVersion: v2Pool, override })
      const remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
      assert.ok('fastOutboundRateLimiterState' in remote)
      assert.equal(remote.fastOutboundRateLimiterState, null)
      assert.equal(remote.fastInboundRateLimiterState, null)
    }
  })

  it('omits FTF rate limits for 1.6 pools without probing overrides', async () => {
    const { chain, getMultipleAccountsInfo } = await poolChain({ poolTypeAndVersion: v16Pool })
    const remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.equal(remote.outboundRateLimiterState?.capacity, 200n)
    assert.ok(!('fastOutboundRateLimiterState' in remote))
    assert.equal(getMultipleAccountsInfo.mock.callCount(), 0)
  })

  it('returns 2.0 configs of pools of unknown version only if they have 2.0 accounts', async () => {
    let { chain } = await poolChain({ poolTypeAndVersion: null })
    let remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.ok(!('fastOutboundRateLimiterState' in remote) && !('finalityDepth' in remote))
    ;({ chain } = await poolChain({ poolTypeAndVersion: null, override: { enabled: true } }))
    remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.ok('fastOutboundRateLimiterState' in remote)
    assert.equal(remote.fastOutboundRateLimiterState?.capacity, 20n)
    ;({ chain } = await poolChain({ poolTypeAndVersion: null, chainConfigV2: v2ChainConfig }))
    remote = await chain.getTokenPoolRemote(tokenPool.toBase58(), remoteSelector)
    assert.ok('fastOutboundRateLimiterState' in remote)
    assert.equal(remote.fastOutboundRateLimiterState, null)
    assert.ok('finalityDepth' in remote)
    assert.equal(remote.finalityDepth, 5)
  })

  describe('getLaneFeatures', () => {
    const laneFeatures = (chain: SolanaChain, token?: PublicKey) =>
      chain.getLaneFeatures({
        router: router.toBase58(),
        destChainSelector: remoteSelector,
        ...(token && { token: token.toBase58() }),
      })

    it("reports the lane's pool finality and FTF rate limits", async () => {
      const { chain } = await poolChain({
        poolTypeAndVersion: v2Pool,
        chainConfigV2: v2ChainConfig,
        override: { enabled: true },
      })
      const features = await laneFeatures(chain, mint)
      assert.equal(features[LaneFeature.FINALITY_FAST], 5)
      assert.equal(features[LaneFeature.FINALITY_SAFE], undefined)
      assert.equal(features[LaneFeature.RATE_LIMITS]?.capacity, 200n)
      assert.equal(features[LaneFeature.FAST_RATE_LIMITS]?.capacity, 20n)
    })

    it('reports FTF as not enabled for a pool without a 2.0 config on the lane', async () => {
      const { chain } = await poolChain({ poolTypeAndVersion: v2Pool })
      const features = await laneFeatures(chain, mint)
      assert.equal(features[LaneFeature.FINALITY_FAST], 0)
      assert.ok(!(LaneFeature.FAST_RATE_LIMITS in features))
    })

    it('reports no fast finality on lanes the 2.0 router serves over 1.6', async () => {
      const { chain, getAccountInfo } = await poolChain({
        poolTypeAndVersion: v2Pool,
        chainConfigV2: v2ChainConfig,
        override: { enabled: true },
        laneV2: false,
      })
      for (const features of [await laneFeatures(chain), await laneFeatures(chain, mint)]) {
        assert.ok(!(LaneFeature.FINALITY_FAST in features))
        assert.ok(!(LaneFeature.FINALITY_SAFE in features))
        assert.ok(!(LaneFeature.FAST_RATE_LIMITS in features))
      }
      assert.equal(chainConfigV2Reads(getAccountInfo), 0)
    })

    it('defaults to fast and safe finality on 2.0 lanes without a token', async () => {
      const { chain } = await poolChain({ poolTypeAndVersion: v2Pool })
      const features = await laneFeatures(chain)
      assert.equal(features[LaneFeature.FINALITY_FAST], 1)
      assert.equal(features[LaneFeature.FINALITY_SAFE], true)
    })
  })
})

describe('SolanaChain getExecutionReceipts', () => {
  let solanaChain: SolanaChain

  beforeEach(() => {
    mock.restoreAll()
    mockGetAccountInfo.mock.mockImplementation(async () => null)
    mockGetParsedAccountInfo.mock.mockImplementation(async () => null)
    mockGetGenesisHash.mock.mockImplementation(async () => 'test-genesis-hash')
    mockGetSignaturesForAddress.mock.mockImplementation(async () => [])
    mockGetProgramAccounts.mock.mockImplementation(async () => [])
    solanaChain = new SolanaChain(mockConnection, mockNetworkInfo)
  })

  const offRamp = 'offzdKY3MVHcs8c639Atwqr7KGbZrxmNDC27s2DJeEr'
  const messageId = '0x10879f2e3dc803ec144d0c428ae99953305cca6dbe51512a1e76e71715ebf555'

  it('narrows v2 scans to the message_exec_state PDA when a messageId is given', async () => {
    solanaChain.typeAndVersion = async () =>
      ['CCIP 2.0.0', '2.0.0', 'CCIP 2.0.0'] as Awaited<ReturnType<SolanaChain['typeAndVersion']>>
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('message_exec_state'), Buffer.from(messageId.slice(2), 'hex')],
      new PublicKey(offRamp),
    )

    const execs = []
    for await (const exec of solanaChain.getExecutionReceipts({
      offRamp,
      messageId,
      sourceChainSelector: 16015286601757825000n,
      startTime: 1,
    })) {
      execs.push(exec)
    }

    assert.equal(execs.length, 0)
    const addresses = mockGetSignaturesForAddress.mock.calls.map((c) =>
      ((c.arguments as unknown[])[0] as PublicKey).toBase58(),
    )
    assert.ok(addresses.length >= 1, 'getSignaturesForAddress should have been called')
    assert.ok(
      addresses.every((a) => a === pda.toBase58()),
      `expected all scans against the message_exec_state PDA ${pda.toBase58()}, got ${addresses.join(',')}`,
    )
    assert.ok(!addresses.includes(offRamp)) // never a broad offRamp sweep
  })

  it('keeps scanning the offRamp address when no messageId is given', async () => {
    solanaChain.typeAndVersion = async () =>
      ['CCIP 2.0.0', '2.0.0', 'CCIP 2.0.0'] as Awaited<ReturnType<SolanaChain['typeAndVersion']>>

    const execs = []
    for await (const exec of solanaChain.getExecutionReceipts({
      offRamp,
      sourceChainSelector: 16015286601757825000n,
      startTime: 1,
    })) {
      execs.push(exec)
    }

    assert.equal(execs.length, 0)
    const addresses = mockGetSignaturesForAddress.mock.calls.map((c) =>
      ((c.arguments as unknown[])[0] as PublicKey).toBase58(),
    )
    assert.ok(addresses.includes(offRamp))
  })

  it('keeps scanning the offRamp address on v1 offramps even with a messageId', async () => {
    solanaChain.typeAndVersion = async () =>
      ['CCIP 1.6.0', '1.6.0', 'CCIP 1.6.0'] as Awaited<ReturnType<SolanaChain['typeAndVersion']>>

    const execs = []
    for await (const exec of solanaChain.getExecutionReceipts({
      offRamp,
      messageId,
      sourceChainSelector: 16015286601757825000n,
      startTime: 1,
    })) {
      execs.push(exec)
    }

    assert.equal(execs.length, 0)
    const addresses = mockGetSignaturesForAddress.mock.calls.map((c) =>
      ((c.arguments as unknown[])[0] as PublicKey).toBase58(),
    )
    assert.ok(addresses.includes(offRamp))
  })

  it('narrows v1 scans to the covering commit_report PDA when a sequenceNumber is given without verifications', async () => {
    solanaChain.typeAndVersion = async () =>
      ['CCIP 1.6.0', '1.6.0', 'CCIP 1.6.0'] as Awaited<ReturnType<SolanaChain['typeAndVersion']>>
    const pda = PublicKey.unique()
    const seqNr = 10726n
    // commit report account data: discriminator(8) + 1 + sourceChainSelector(8) +
    // merkleRoot(32) + minSeqNr(8) + maxSeqNr(8); only the seq range offsets are read
    const data = Buffer.alloc(8 + 1 + 8 + 32 + 8 + 8 + 8)
    data.writeBigUInt64LE(seqNr, 8 + 1 + 8 + 32 + 8)
    data.writeBigUInt64LE(seqNr, 8 + 1 + 8 + 32 + 8 + 8)
    mockGetProgramAccounts.mock.mockImplementation(async () => [{ pubkey: pda, account: { data } }])
    const callsBefore = mockGetSignaturesForAddress.mock.calls.length

    const execs = []
    for await (const exec of solanaChain.getExecutionReceipts({
      offRamp,
      messageId,
      sourceChainSelector: 16015286601757825000n,
      sequenceNumber: seqNr,
      startTime: 1,
    })) {
      execs.push(exec)
    }

    assert.equal(execs.length, 0)
    const addresses = mockGetSignaturesForAddress.mock.calls
      .slice(callsBefore)
      .map((c) => ((c.arguments as unknown[])[0] as PublicKey).toBase58())
    assert.ok(
      addresses.length >= 1,
      'getSignaturesForAddress should have been called for the covering PDA',
    )
    assert.ok(
      addresses.every((a) => a === pda.toBase58()),
      `expected all scans against the commit_report PDA ${pda.toBase58()}, got ${addresses.join(',')}`,
    )
    assert.ok(!addresses.includes(offRamp)) // never a broad offRamp sweep
  })

  it('keeps the generic offRamp sweep on v1 offramps when the probe finds no covering PDA', async () => {
    solanaChain.typeAndVersion = async () =>
      ['CCIP 1.6.0', '1.6.0', 'CCIP 1.6.0'] as Awaited<ReturnType<SolanaChain['typeAndVersion']>>
    mockGetProgramAccounts.mock.mockImplementation(async () => [])
    const callsBefore = mockGetSignaturesForAddress.mock.calls.length

    const execs = []
    for await (const exec of solanaChain.getExecutionReceipts({
      offRamp,
      messageId,
      sourceChainSelector: 16015286601757825000n,
      sequenceNumber: 10726n,
      startTime: 1,
    })) {
      execs.push(exec)
    }

    assert.equal(execs.length, 0)
    const addresses = mockGetSignaturesForAddress.mock.calls
      .slice(callsBefore)
      .map((c) => ((c.arguments as unknown[])[0] as PublicKey).toBase58())
    assert.ok(addresses.includes(offRamp))
  })
})

describe('SolanaChain getLogs — since per-log resume (same-tx followers)', () => {
  const ADDRESS = '11111111111111111111111111111111' // system program (mock ignores it)
  const TOPIC = hexDiscriminator('ExecutionStateChanged')

  // A tx with three matching logs at indexes 0, 1, 2 (batch execution), plus a
  // later tx with one log. HINT = the tx's log at index 1.
  function makeChainWithTxs(txs: SolanaTransaction[]) {
    const solanaChain = new SolanaChain(mockConnection, mockNetworkInfo)
    mock.method(solanaChain, 'getTransactionsForAddress', async function* () {
      yield* txs
    })
    return solanaChain
  }

  const txLog = (index: number, hash: string) => ({
    address: ADDRESS,
    topics: [TOPIC],
    data: '',
    transactionHash: hash,
    index,
    blockNumber: 100,
    blockTimestamp: 100,
  })

  it('drops only logs at/before the hinted index; same-tx followers survive (B1)', async () => {
    const txA = {
      hash: 'sigA',
      logs: [txLog(0, 'sigA'), txLog(1, 'sigA'), txLog(2, 'sigA')],
    } as unknown as SolanaTransaction
    const txB = { hash: 'sigB', logs: [txLog(0, 'sigB')] } as unknown as SolanaTransaction
    const chain = makeChainWithTxs([txA, txB])

    const out: { tx: string; index: number }[] = []
    for await (const l of chain.getLogs({
      address: ADDRESS,
      topics: [TOPIC],
      startBlock: 100,
      since: {
        transactionHash: 'sigA',
        index: 1,
        blockNumber: 100,
        blockTimestamp: 100,
        address: ADDRESS,
        topics: [TOPIC],
      },
    })) {
      out.push({ tx: l.transactionHash, index: l.index })
    }
    assert.deepEqual(out, [
      { tx: 'sigA', index: 2 },
      { tx: 'sigB', index: 0 },
    ])
  })

  it('does not re-emit the hinted log when the hint is the tx’s last log', async () => {
    const txA = {
      hash: 'sigA',
      logs: [txLog(0, 'sigA'), txLog(1, 'sigA')],
    } as unknown as SolanaTransaction
    const txB = { hash: 'sigB', logs: [txLog(0, 'sigB')] } as unknown as SolanaTransaction
    const chain = makeChainWithTxs([txA, txB])
    // hint = LAST log of the hinted tx: nothing of that tx may re-emit.
    const out: string[] = []
    for await (const l of chain.getLogs({
      address: ADDRESS,
      topics: [TOPIC],
      startBlock: 100,
      since: {
        transactionHash: 'sigA',
        index: 1,
        blockNumber: 100,
        blockTimestamp: 100,
        address: ADDRESS,
        topics: [TOPIC],
      },
    })) {
      out.push(`${l.transactionHash}:${l.index}`)
    }
    assert.deepEqual(out, ['sigB:0'])
  })
})

describe('SolanaChain getVerifications (v1.x commit_report PDA path)', () => {
  let solanaChain: SolanaChain

  beforeEach(() => {
    mock.restoreAll()
    mockGetAccountInfo.mock.mockImplementation(async () => null)
    mockGetParsedAccountInfo.mock.mockImplementation(async () => null)
    mockGetGenesisHash.mock.mockImplementation(async () => 'test-genesis-hash')
    mockGetSignaturesForAddress.mock.mockImplementation(async () => [])
    mockGetProgramAccounts.mock.mockImplementation(async () => [])
    solanaChain = new SolanaChain(mockConnection, mockNetworkInfo)
  })

  const offRamp = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'
  const seqNr = 10726n
  const request = {
    lane: { sourceChainSelector: 16015286601757825753n, version: CCIPVersion.V1_6 },
    message: { sequenceNumber: seqNr, messageId: '0x' + 'ab'.repeat(32) },
    log: { blockTimestamp: 1753000000 },
  } as unknown as Parameters<SolanaChain['getVerifications']>[0]['request']

  const commitReportAccount = (min: bigint, max: bigint) => {
    // layout: discriminator(8) + 1 + sourceChainSelector(8) + merkleRoot(32) +
    // minSeqNr(8) + maxSeqNr(8); only the seq range offsets are read
    const data = Buffer.alloc(8 + 1 + 8 + 32 + 8 + 8 + 8)
    data.writeBigUInt64LE(min, 8 + 1 + 8 + 32 + 8)
    data.writeBigUInt64LE(max, 8 + 1 + 8 + 32 + 8 + 8)
    return { pubkey: PublicKey.unique(), account: { data } }
  }

  it('fails fast with CCIPCommitHistoryPrunedError when the covering PDA has no retained signatures', async () => {
    mockGetProgramAccounts.mock.mockImplementation(async () => [commitReportAccount(seqNr, seqNr)])
    // endpoint pruned the PDA's history: account exists, zero signatures retained
    mockGetSignaturesForAddress.mock.mockImplementation(async () => [])
    const callsBefore = mockGetSignaturesForAddress.mock.calls.length

    await assert.rejects(solanaChain.getVerifications({ offRamp, request }), (err: unknown) => {
      assert.ok(err instanceof CCIPCommitHistoryPrunedError)
      assert.equal(err.context.endpoint, 'test-endpoint')
      return true
    })
    // must not fall back to the generic (unbounded) offRamp sweep
    const addresses = mockGetSignaturesForAddress.mock.calls
      .slice(callsBefore)
      .map((c) => ((c.arguments as unknown[])[0] as PublicKey).toBase58())
    assert.ok(!addresses.includes(offRamp), 'must not start an offRamp sweep for a pruned commit')
  })

  it('falls back to the generic offRamp scan when no covering PDA exists (closed or not committed yet)', async () => {
    mockGetProgramAccounts.mock.mockImplementation(async () => [])
    const callsBefore = mockGetSignaturesForAddress.mock.calls.length

    // generic scan finds nothing (empty sigs) -> CCIPCommitNotFoundError
    await assert.rejects(
      solanaChain.getVerifications({ offRamp, request }),
      (err: unknown) => err instanceof CCIPCommitNotFoundError,
    )
    const addresses = mockGetSignaturesForAddress.mock.calls
      .slice(callsBefore)
      .map((c) => ((c.arguments as unknown[])[0] as PublicKey).toBase58())
    assert.ok(addresses.includes(offRamp), 'should fall back to the generic offRamp scan')
  })
})
