import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type ChainTransaction,
  CCIPTransactionNotFoundError,
  ChainFamily,
  networkInfo,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'

import { fetchChainsFromRpcs } from './index.ts'
import type { Ctx } from '../commands/index.ts'

describe('fetchChainsFromRpcs', () => {
  it('lets duplicate tx-hash race endpoints query before aborting losers', async () => {
    const originalEvm = supportedChains[ChainFamily.EVM]
    const attempts: string[] = []
    const aborts: string[] = []
    const txHash = '0x'.padEnd(66, '1')

    class FakeEvmChain {
      static family = ChainFamily.EVM
      static isTxHash = () => true

      network = networkInfo('ethereum-testnet-sepolia')
      url = ''

      constructor(url: string) {
        this.url = url
      }

      static async fromUrl(url: string, ctx?: { abort?: AbortSignal }) {
        ctx?.abort?.addEventListener('abort', () => aborts.push(url), { once: true })
        await new Promise((resolve) => setTimeout(resolve, url.includes('first') ? 0 : 10))
        return new FakeEvmChain(url)
      }

      async getTransaction(hash: string): Promise<ChainTransaction> {
        attempts.push(this.url)
        if (!this.url.includes('second')) throw new CCIPTransactionNotFoundError(hash)
        return {
          hash,
          logs: [],
          blockNumber: 1,
          timestamp: 1,
          from: '0x0000000000000000000000000000000000000000',
        }
      }
    }

    const ac = new AbortController()
    const ctx: Ctx = {
      abort: ac.signal,
      output: { write: () => {}, table: () => {} },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }

    try {
      supportedChains[ChainFamily.EVM] = FakeEvmChain as never

      const [, tx$] = fetchChainsFromRpcs(
        ctx,
        { rpcs: ['http://first.example', 'http://second.example'], rpcsFile: '', api: false },
        txHash,
      )

      const [chain, tx] = await tx$
      assert.equal((chain as unknown as FakeEvmChain).url, 'http://second.example')
      assert.equal(tx.hash, txHash)
      assert.deepEqual(attempts, ['http://first.example', 'http://second.example'])
    } finally {
      supportedChains[ChainFamily.EVM] = originalEvm
      ac.abort()
    }

    assert.ok(aborts.includes('http://first.example'))
  })
})
