import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SolanaChain } from '../../../../solana/index.ts'
import { SolanaTokenAdminRegistryClient } from '../index.ts'

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

describe('SolanaTokenAdminRegistryClient', () => {
  it('wraps an existing Solana chain', () => {
    const chain = stubChain()
    const client = new SolanaTokenAdminRegistryClient(chain)

    assert.equal(client.chain, chain)
  })
})
