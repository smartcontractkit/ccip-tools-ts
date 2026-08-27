import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Connection } from '@solana/web3.js'

import { getTransactionsForAddress } from './logs.ts'
import type { SolanaTransaction } from './index.ts'

describe('Solana getTransactionsForAddress since hint', () => {
  const ADDRESS = '11111111111111111111111111111111' // system program (mock ignores it)

  // Fixed account history: one signature per slot, slots 100..110 (newest first,
  // like the RPC). Signatures are opaque strings to the walk.
  const SIGS = Array.from({ length: 11 }, (_, i) => {
    const slot = 110 - i
    return { signature: `sig${slot}`, slot, blockTime: slot, err: null, memo: null }
  })

  // A connection faithfully modeling (limit, before, until) cursor pagination over
  // `sigs`, counting RPC round-trips and recording the `until` of each request.
  function makeConnection(sigs: typeof SIGS) {
    const state = { rpc: 0, untils: [] as (string | undefined)[] }
    const connection = {
      getSignaturesForAddress: async (
        _pk: unknown,
        opts: { limit?: number; before?: string; until?: string },
        _commitment?: unknown,
      ) => {
        state.rpc++
        state.untils.push(opts.until)
        let start = 0
        if (opts.before != null) {
          const at = sigs.findIndex((s) => s.signature === opts.before)
          if (at >= 0) start = at + 1 // strictly older than the cursor
        }
        let end = sigs.length
        if (opts.until != null) {
          const at = sigs.findIndex((s) => s.signature === opts.until)
          if (at >= start && at < end) end = at // stop at (excluding) the until sig
        }
        return sigs.slice(start, Math.min(end, start + (opts.limit ?? 1000)))
      },
    } as unknown as Connection
    return { connection, state }
  }

  const getTransaction = (signature: string) =>
    Promise.resolve({ hash: signature, logs: [] } as unknown as SolanaTransaction)

  async function collectHashes(opts: Record<string, unknown>, sigs = SIGS) {
    const { connection, state } = makeConnection(sigs)
    const hashes: string[] = []
    for await (const tx of getTransactionsForAddress(
      { address: ADDRESS, ...opts },
      {
        connection,
        getTransaction,
      },
    )) {
      hashes.push(tx.hash)
    }
    return { hashes, rpc: state.rpc, untils: state.untils }
  }

  it('walks by the hint slot floor, streaming the hinted tx whole', async () => {
    // B1: the node's `until` cursor is transaction-granular — passing the hint's
    // signature would drop the WHOLE hinted tx, including same-tx logs after the
    // hint's index. The walk therefore pages to the absolute slot floor and
    // INCLUDES the hinted sig (like EVM fetching its hinted block whole); the
    // per-log (transactionHash, index) exclusion happens in SolanaChain.getLogs.
    const res = await collectHashes({
      startBlock: 100,
      page: 2,
      since: { transactionHash: 'sig108', blockNumber: 108, address: ADDRESS },
    })
    assert.deepEqual(res.hashes, ['sig108', 'sig109', 'sig110'], 'the hinted tx is re-streamed')
    assert.equal(res.rpc, 2, 'the backward walk stops once paging reaches the floor')
  })

  it('falls back to the hint blockNumber floor when the node does not know the hint sig', async () => {
    // `until` is only honored when the queried node has the signature; when it
    // doesn't (pruned, or not yet indexed there), the hint's blockNumber is the
    // absolute floor keeping older sigs out.
    const nodeSigs = SIGS.filter((s) => s.signature !== 'sig108')
    const res = await collectHashes(
      {
        startBlock: 100,
        page: 2,
        since: { transactionHash: 'sig108', blockNumber: 108, address: ADDRESS },
      },
      nodeSigs,
    )
    assert.deepEqual(
      res.hashes,
      ['sig109', 'sig110'],
      'slots older than the hint are never included',
    )
    assert.equal(res.rpc, 2, 'walk stops once paging reaches the floor')
  })

  it('walks to the usual floor when the hint is never found', async () => {
    const res = await collectHashes({
      startBlock: 105,
      page: 2,
      since: { transactionHash: 'sig-does-not-exist', blockNumber: 102, address: ADDRESS },
    })
    assert.deepEqual(
      res.hashes,
      ['sig105', 'sig106', 'sig107', 'sig108', 'sig109', 'sig110'],
      'a stale/pruned hint degrades to the startBlock floor',
    )
  })

  it('never scans below the startBlock floor even when the hint is older', async () => {
    const res = await collectHashes({
      startBlock: 105,
      page: 2,
      since: { transactionHash: 'sig102', blockNumber: 102, address: ADDRESS },
    })
    assert.deepEqual(
      res.hashes,
      ['sig105', 'sig106', 'sig107', 'sig108', 'sig109', 'sig110'],
      'the floor truncation wins over an older hint',
    )
  })

  it('watch mode resumes from the newest scanned sig when the initial scan is empty', async () => {
    // Every existing sig predates the floor, so the scan collects nothing; the
    // first poll must still be bounded — by the newest sig seen while scanning —
    // instead of restarting from the unbounded head and re-emitting old sigs.
    const abort = new AbortController()
    const { connection, state } = makeConnection(SIGS)
    const orig = connection.getSignaturesForAddress.bind(connection)
    let calls = 0
    connection.getSignaturesForAddress = async (...args: unknown[]) => {
      if (++calls === 2) abort.abort() // scan + exactly one poll
      return orig(...(args as Parameters<typeof orig>))
    }

    const hashes: string[] = []
    for await (const tx of getTransactionsForAddress(
      { address: ADDRESS, startBlock: 200, page: 2, watch: abort.signal },
      { connection, getTransaction },
    )) {
      hashes.push(tx.hash)
    }
    assert.deepEqual(hashes, [], 'no below-floor sig is emitted')
    assert.equal(
      state.untils[1],
      'sig110',
      'the poll resumes from the newest sig seen during the scan',
    )
  })

  it('since alone satisfies the start requirement', async () => {
    // No startBlock/startTime: the hint's slot is the floor; the hinted tx itself
    // is walked (its per-log exclusion is applied at getLogs level).
    const res = await collectHashes({
      page: 2,
      since: { transactionHash: 'sig108', blockNumber: 108, blockTimestamp: 108 },
    })
    assert.deepEqual(res.hashes, ['sig108', 'sig109', 'sig110'])
    assert.equal(res.rpc, 2)
  })

  it('since.blockTimestamp alone satisfies the start requirement and floors by time', async () => {
    const res = await collectHashes({ page: 2, since: { blockTimestamp: 105 } })
    assert.deepEqual(
      res.hashes,
      ['sig105', 'sig106', 'sig107', 'sig108', 'sig109', 'sig110'],
      'blockTimestamp stands in for startTime (blockTime == slot in this fixture)',
    )
  })

  it('takes the larger of startBlock and since.blockNumber', async () => {
    const res = await collectHashes({
      startBlock: 109,
      page: 2,
      since: { transactionHash: 'sig108', blockNumber: 108, blockTimestamp: 108 },
    })
    assert.deepEqual(res.hashes, ['sig109', 'sig110'], 'the explicit startBlock wins')
  })
})
