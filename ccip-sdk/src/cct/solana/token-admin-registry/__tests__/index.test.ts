import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { SolanaTokenAdminRegistryClient } from '../index.ts'

const KEY = PublicKey.default.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getLatestBlockhash: async () => ({ blockhash: KEY, lastValidBlockHeight: 0 }),
    },
  } as unknown as SolanaChain
}

describe('SolanaTokenAdminRegistryClient', () => {
  it('wraps an existing Solana chain', () => {
    const chain = stubChain()
    const client = new SolanaTokenAdminRegistryClient(chain)

    assert.equal(client.chain, chain)
  })

  it('exposes TokenAdminRegistry operations', async () => {
    const client = new SolanaTokenAdminRegistryClient(stubChain())
    const unsigned = await client.generateUnsignedSetPool({
      tokenAddress: KEY,
      routerAddress: KEY,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    assert.equal(unsigned.instructions.length, 1)
    assert.equal(unsigned.mainIndex, 0)
  })
})
