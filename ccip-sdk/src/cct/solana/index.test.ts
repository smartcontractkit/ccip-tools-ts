import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Connection } from '@solana/web3.js'

import { SolanaTokenManager } from './index.ts'
import { SolanaChain } from '../../solana/index.ts'

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

describe('SolanaTokenManager (cct/solana)', () => {
  it('fromChain exposes flat Solana CCT operations', () => {
    const chain = stubChain()
    const cct = SolanaTokenManager.fromChain(chain)
    assert.equal(cct.chain, chain)
    assert.equal(cct.provider, chain.connection)
    assert.equal(typeof cct.generateUnsignedDeployToken, 'function')
    assert.equal(typeof cct.deployToken, 'function')
    assert.equal(typeof cct.generateUnsignedCreateTokenAccount, 'function')
    assert.equal(typeof cct.createTokenAccount, 'function')
    assert.equal(typeof cct.generateUnsignedDeployTokenPool, 'function')
    assert.equal(typeof cct.deployTokenPool, 'function')
    assert.equal(typeof cct.generateUnsignedCreateLookupTable, 'function')
    assert.equal(typeof cct.createLookupTable, 'function')
    assert.equal(typeof cct.generateUnsignedAppendToLookupTable, 'function')
    assert.equal(typeof cct.appendToLookupTable, 'function')
    assert.equal(typeof cct.generateUnsignedSetPool, 'function')
    assert.equal(typeof cct.setPool, 'function')
    assert.equal(typeof cct.getTokenPoolState, 'function')
  })

  it('creates from a connection provider', async (t) => {
    const chain = stubChain()
    const connection = new Connection('http://localhost:8899')
    t.mock.method(SolanaChain, 'fromConnection', async (provider: Connection) => {
      assert.equal(provider, connection)
      return chain
    })

    const cct = await SolanaTokenManager.fromProvider(connection)

    assert.equal(cct.chain, chain)
  })

  it('creates from an RPC URL', async (t) => {
    const chain = stubChain()
    t.mock.method(SolanaChain, 'fromUrl', async (url: string) => {
      assert.equal(url, 'http://localhost:8899')
      return chain
    })

    const cct = await SolanaTokenManager.fromUrl('http://localhost:8899')

    assert.equal(cct.chain, chain)
  })
})
