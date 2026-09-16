import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { CCIPTokenDataParseError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { GetTokenInfo } from './get-token-info.ts'

const tokenAddress = Keypair.generate().publicKey.toBase58()
const mintAuthority = Keypair.generate().publicKey

function mintData(): Buffer {
  const data = Buffer.alloc(MINT_SIZE)
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority,
      supply: 1_000_000n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  )
  return data
}

describe('GetTokenInfo (cct/solana)', () => {
  describe('query', () => {
    it('delegates metadata to SolanaChain.getTokenInfo and reads mint state', async () => {
      const metadata = { symbol: 'TKN', decimals: 6, name: 'Token' }
      let received: string | undefined
      const chain = {
        connection: {
          getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID, data: mintData() }),
        },
        getTokenInfo: async (token: string) => {
          received = token
          return metadata
        },
      } as unknown as SolanaChain

      assert.deepEqual(await new GetTokenInfo().query(chain, { tokenAddress }), {
        ...metadata,
        tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
        supply: 1_000_000n,
        isInitialized: true,
        mintAuthority: mintAuthority.toBase58(),
        freezeAuthority: null,
      })
      assert.equal(received, tokenAddress)
    })

    it('rejects non-mint SPL accounts before fetching metadata', async () => {
      let metadataCalls = 0
      const chain = {
        connection: {
          getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(1) }),
        },
        getTokenInfo: async () => {
          metadataCalls++
          return { symbol: 'TKN', decimals: 6 }
        },
      } as unknown as SolanaChain

      await assert.rejects(new GetTokenInfo().query(chain, { tokenAddress }), (error: unknown) => {
        assert.ok(error instanceof CCIPTokenDataParseError)
        assert.equal(error.context.token, tokenAddress)
        assert.ok(error.cause instanceof Error)
        return true
      })
      assert.equal(metadataCalls, 0)
    })
  })

  describe('validation', () => {
    it('validates the mint address before querying', async () => {
      await assert.rejects(
        new GetTokenInfo().query({} as SolanaChain, { tokenAddress: 'not-a-public-key' }),
      )
    })
  })
})
