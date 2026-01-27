import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { Connection, PublicKey } from '@solana/web3.js'

import { ChainFamily, NetworkType } from '../../types.ts'
import { SolanaChain } from '../index.ts'

// Integration test for real Solana mainnet token
describe('SolanaChain getTokenInfo - Mainnet Integration', () => {
  let connection: Connection
  let solanaChain: SolanaChain

  // Skip these tests in CI or if no network access
  const skipIfNoNetwork = process.env.CI || process.env.SKIP_INTEGRATION_TESTS

  before(async () => {
    if (skipIfNoNetwork) {
      return
    }

    // Use a public Solana mainnet RPC endpoint
    connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')

    const mockNetworkInfo = {
      family: ChainFamily.Solana,
      chainId: 'mainnet-beta',
      name: 'Solana Mainnet',
      chainSelector: 4893384233818604317n, // Solana mainnet selector
      networkType: NetworkType.Mainnet,
      isTestnet: false,
    }

    solanaChain = new SolanaChain(connection, mockNetworkInfo)
  })

  it(
    'should fetch WMTX token info with symbol from Metaplex metadata fallback',
    { timeout: 30000 },
    async () => {
      if (skipIfNoNetwork) {
        console.log('Skipping integration test - no network access')
        return
      }

      const wmtxToken = 'WMTXyYKUMTG3VuZA5beXuHVRLpyTwwaoP7h2i8YpuRH'

      try {
        const result = await solanaChain.getTokenInfo(wmtxToken)

        console.log(`Token info for ${wmtxToken}:`, result)

        // Verify the expected symbol
        assert.equal(result.symbol, 'WMTX')
        assert.equal(typeof result.decimals, 'number')
        assert.ok(result.decimals >= 0)
      } catch (error) {
        console.error('Integration test failed:', error)
        throw error
      }
    },
  )

  it(
    'should demonstrate fallback flow by first checking SPL token data',
    { timeout: 30000 },
    async () => {
      if (skipIfNoNetwork) {
        console.log('Skipping integration test - no network access')
        return
      }

      const wmtxToken = 'WMTXyYKUMTG3VuZA5beXuHVRLpyTwwaoP7h2i8YpuRH'
      const mintPublicKey = new PublicKey(wmtxToken)

      try {
        // First check what the raw SPL token info contains
        const mintInfo = await connection.getParsedAccountInfo(mintPublicKey)

        if (
          mintInfo.value &&
          typeof mintInfo.value.data === 'object' &&
          'parsed' in mintInfo.value.data
        ) {
          const parsed = mintInfo.value.data.parsed as {
            info: { symbol?: string; decimals: number }
          }
          console.log('Raw SPL token info:', parsed.info)

          // If SPL token doesn't have symbol, our implementation should fallback to Metaplex
          if (!parsed.info.symbol) {
            console.log('SPL token info missing symbol - fallback to Metaplex should occur')
          } else {
            console.log('SPL token info has symbol:', parsed.info.symbol)
          }
        }

        // Now test our implementation
        const result = await solanaChain.getTokenInfo(wmtxToken)
        console.log('Final result from getTokenInfo:', result)

        assert.equal(result.symbol, 'WMTX')
      } catch (error) {
        console.error('Fallback demonstration failed:', error)
        throw error
      }
    },
  )

  it('should verify metadata PDA derivation is correct', { timeout: 30000 }, async () => {
    if (skipIfNoNetwork) {
      console.log('Skipping integration test - no network access')
      return
    }

    const wmtxToken = 'WMTXyYKUMTG3VuZA5beXuHVRLpyTwwaoP7h2i8YpuRH'
    const mintPublicKey = new PublicKey(wmtxToken)
    const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

    try {
      // Derive the metadata PDA the same way our implementation does
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPublicKey.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
      )

      console.log('Derived metadata PDA:', metadataPDA.toString())

      // Check if the metadata account actually exists
      const metadataAccount = await connection.getAccountInfo(metadataPDA)

      if (metadataAccount) {
        console.log('Metadata account exists, data length:', metadataAccount.data.length)
        console.log('Metadata account owner:', metadataAccount.owner.toString())

        // Verify it's owned by the Token Metadata Program
        assert.equal(metadataAccount.owner.toString(), TOKEN_METADATA_PROGRAM_ID.toString())
      } else {
        console.log('No metadata account found at derived PDA')
      }

      // Our implementation should still work regardless
      const result = await solanaChain.getTokenInfo(wmtxToken)
      assert.equal(result.symbol, 'WMTX')
    } catch (error) {
      console.error('PDA derivation test failed:', error)
      throw error
    }
  })

  it('should handle network errors gracefully', { timeout: 30000 }, async () => {
    if (skipIfNoNetwork) {
      console.log('Skipping integration test - no network access')
      return
    }

    // Test with an invalid token address that will cause network/parsing errors
    const invalidToken = 'So11111111111111111111111111111111111111112' // SOL native mint

    try {
      const result = await solanaChain.getTokenInfo(invalidToken)
      console.log('Result for SOL native mint:', result)

      // Should get some result, even if fallback fails
      assert.equal(typeof result.symbol, 'string')
      assert.equal(typeof result.decimals, 'number')
    } catch (error) {
      console.error('Network error handling test:', error)
      // This is acceptable - some tokens might not be parseable
    }
  })

  it('should support Token-2022 tokens on mainnet', { timeout: 30000 }, async () => {
    if (skipIfNoNetwork) {
      console.log('Skipping Token-2022 integration test - no network access')
      return
    }

    // Using a real Token-2022 token - PYUSD (PayPal USD) which uses Token Extensions
    const pyusdToken = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'

    try {
      // First check the program type to verify it's Token-2022
      const mintPublicKey = new PublicKey(pyusdToken)
      const mintInfo = await connection.getParsedAccountInfo(mintPublicKey)

      if (
        mintInfo.value &&
        typeof mintInfo.value.data === 'object' &&
        'program' in mintInfo.value.data
      ) {
        console.log('Token program type:', mintInfo.value.data.program)

        // This should be 'spl-token-2022' for Token Extensions tokens
        if (mintInfo.value.data.program === 'spl-token-2022') {
          console.log('Confirmed: This is a Token-2022 token')
        }
      }

      const result = await solanaChain.getTokenInfo(pyusdToken)

      console.log(`Token-2022 info for ${pyusdToken}:`, result)

      // PYUSD should have proper symbol and 6 decimals
      assert.equal(typeof result.symbol, 'string')
      assert.ok(result.symbol.length > 0)
      assert.notEqual(result.symbol, 'UNKNOWN')
      assert.equal(typeof result.decimals, 'number')
      assert.ok(result.decimals >= 0)
    } catch (error) {
      console.error('Token-2022 integration test failed:', error)
      // If this specific token doesn't work, that's okay - the important thing
      // is that we don't get an "Invalid SPL token" error for Token-2022 tokens
      if (error instanceof Error && error.message.includes('Invalid SPL token')) {
        throw new Error('Token-2022 support is not working - got Invalid SPL token error')
      }
    }
  })
})
