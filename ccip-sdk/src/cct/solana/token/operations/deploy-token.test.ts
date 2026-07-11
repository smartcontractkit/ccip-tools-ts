import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { SolanaTokenManager } from '../../index.ts'

const BLOCKHASH = PublicKey.default.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const METAPLEX_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      rpcEndpoint: 'http://localhost:8899',
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getMinimumBalanceForRentExemption: async () => 123,
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 0 }),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedDeployToken({
    decimals: 9,
    tokenProgram: 'spl-token',
    withMetaplex: false,
    payer: PAYER,
    ...opts,
  })
}

describe('Solana token deployToken', () => {
  it('builds unsigned SPL mint create instructions without minting supply', async () => {
    const unsigned = await generate()
    const [createAccountIx, initializeMintIx] = unsigned.instructions

    assert.ok(createAccountIx)
    assert.ok(initializeMintIx)
    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.match(unsigned.tokenAddress, /^[1-9A-HJ-NP-Za-km-z]+$/)
    assert.equal('seed' in unsigned, false)
    assert.equal(unsigned.instructions.length, 2)
    assert.equal(createAccountIx.programId.toBase58(), SystemProgram.programId.toBase58())
    assert.equal(initializeMintIx.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
    assert.equal(initializeMintIx.data[0], 0) // InitializeMint, not MintTo
  })

  it('adds Metaplex metadata when requested', async () => {
    const unsigned = await generate({
      withMetaplex: true,
      name: 'My Token',
      symbol: 'MTK',
    })

    assert.equal(unsigned.instructions.length, 3)
    assert.equal(unsigned.instructions[2]!.programId.toBase58(), METAPLEX_PROGRAM)
    assert.equal(unsigned.instructions[2]!.data[0], 42) // createV1
  })

  it('uses Token-2022 program for mint and metadata', async () => {
    const unsigned = await generate({
      tokenProgram: 'token-2022',
      withMetaplex: true,
      name: 'My Token',
      symbol: 'MTK',
    })

    assert.equal(unsigned.instructions[1]!.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
    assert.ok(
      unsigned.instructions[2]!.keys.some(
        (key) => key.pubkey.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58(),
      ),
    )
  })
})
