import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Address } from '@ton/core'
import type { TonClient, Transaction } from '@ton/ton'

import { networkInfo } from '../index.ts'
import { TONChain } from './index.ts'

// Regression tests for the per-address transaction window installed on the
// provider by TONChain: long-lived getLogs watch streams used to grow the
// window with the account's full history (each Transaction keeps its parsed
// message cells), which showed up in production as hundreds of MB of retained
// Cell/BitString objects on the workers hosting TON watch activities.
describe('TONChain txCache bounds', () => {
  const net = networkInfo('ton-testnet')

  const addr = (i: number): Address => Address.parse('0:' + String(i).padStart(64, '0'))
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

  function fakeTx(tag: string, lt: bigint, prevLt: bigint, a: Address): Transaction {
    return {
      address: a,
      lt,
      prevTransactionLt: prevLt,
      hash: () => Buffer.from(tag, 'utf8'),
    } as unknown as Transaction
  }

  it('trims the per-address window so the streamed history is not kept indefinitely', async () => {
    // 501 consecutive head pages: the oldest tx must fall out of the 500-tx
    // window, while the newest stays served from cache.
    const a = addr(1)
    let head = 0
    let fetches = 0
    const total = 501
    const txs = Array.from({ length: total }, (_, i) =>
      fakeTx('t' + i, 1_000_000n - BigInt(i), 999_999n - BigInt(i), a),
    )
    const client = {
      getTransactions: async (_a: Address, opts: { hash?: string; limit?: number }) => {
        fetches++
        if (opts.hash) return [] // simulated deep-cursor fetch
        const tx = txs[head++]
        return tx ? [tx] : []
      },
    } as unknown as TonClient

    const chain = new TONChain(client, net)
    const wrapped = chain.provider.getTransactions.bind(chain.provider)
    for (let i = 0; i < total; i++) await wrapped(a, { limit: 1 })

    // Trimmed oldest cursor (the last head page fetched has the smallest lt):
    // it must re-fetch from the RPC.
    const before = fetches
    await wrapped(a, { hash: b64('t' + (total - 1)), limit: 1 })
    assert.equal(fetches, before + 1, 'trimmed cursor should re-fetch')

    // Kept newest cursor: must be served from the window without an RPC call.
    const before2 = fetches
    await wrapped(a, { hash: b64('t0'), limit: 1 })
    assert.equal(fetches, before2, 'cached cursor should not hit the RPC')
  })

  it('evicts the stalest address entry beyond the fan-out cap', async () => {
    const perAddr = new Map<string, number>()
    let fetches = 0
    const client = {
      getTransactions: async (a: Address, opts: { hash?: string; limit?: number }) => {
        fetches++
        if (opts.hash) return []
        const n = perAddr.get(a.toString()) ?? 0
        perAddr.set(a.toString(), n + 1)
        return [
          fakeTx(
            `${a.toString()}:${n}`,
            1_000_000n - BigInt(n) * 10n,
            999_999n - BigInt(n) * 10n,
            a,
          ),
        ]
      },
    } as unknown as TonClient

    const chain = new TONChain(client, net)
    const wrapped = chain.provider.getTransactions.bind(chain.provider)
    const addresses = Array.from({ length: 17 }, (_, i) => addr(i))
    for (const a of addresses) {
      await wrapped(a, { limit: 1 })
      await wrapped(a, { limit: 1 }) // two heads each, so the newest cursor is serveable
    }

    // The first (stalest) address was evicted: its cursor misses the cache.
    const before = fetches
    await wrapped(addresses[0]!, { hash: b64(`${addresses[0]!.toString()}:0`), limit: 1 })
    assert.equal(fetches, before + 1, 'evicted address cursor should re-fetch')

    // The most recent address is still cached and serves without an RPC call
    // (cursor on its newest tx, asking for the one older).
    const before2 = fetches
    await wrapped(addresses[16]!, { hash: b64(`${addresses[16]!.toString()}:0`), limit: 1 })
    assert.equal(fetches, before2, 'cached address cursor should not hit the RPC')
  })
})
