import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

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
        mintAuthority: mintAuthority.toBase58(),
        freezeAuthority: null,
      })
      assert.equal(received, tokenAddress)
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
