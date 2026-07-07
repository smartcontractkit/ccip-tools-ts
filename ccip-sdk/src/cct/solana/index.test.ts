import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import { SolanaTokenManager } from './index.ts'
import type { SolanaChain } from '../../solana/index.ts'

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

describe('SolanaTokenManager (cct/solana)', () => {
  it('fromChain exposes grouped TokenAdminRegistry operations', () => {
    const chain = stubChain()
    const cct = SolanaTokenManager.fromChain(chain)
    assert.equal(cct.chain, chain)
    assert.equal(cct.tokenAdminRegistry.chain, chain)
  })

  it('serializes unsigned Solana txs on demand', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: KEY,
      routerAddress: KEY,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    const base58 = await cct.serializeUnsignedTx(unsigned, KEY)
    const hex = await cct.serializeUnsignedTx(unsigned, KEY, 'hex')

    assert.match(base58, /^[1-9A-HJ-NP-Za-km-z]+$/)
    assert.match(hex, /^[0-9a-f]+$/)
    await assert.rejects(
      () => cct.serializeUnsignedTx(unsigned, KEY, 'base32' as never),
      /unsupported Solana transaction encoding: base32/,
    )
  })
})
