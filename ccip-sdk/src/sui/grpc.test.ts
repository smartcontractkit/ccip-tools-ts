import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SuiGrpcClient } from '@mysten/sui/grpc'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { SuiGrpcChainClient } from './grpc.ts'

/**
 * Mock-based unit tests for the gRPC adapter's pagination cursors, option
 * masks, error typing and descriptor-cache recovery — structural stand-ins
 * for SuiGrpcClient (no transport, no network), asserting the request/response
 * contract the SDK's consumers rely on.
 */

/** Wraps a payload as the client option, bypassing the SuiGrpcClient class. */
const clientWith = (methods: Record<string, unknown>): SuiGrpcChainClient =>
  SuiGrpcChainClient.from({ client: methods as unknown as SuiGrpcClient })

const decodeCursor = (cursor: string | null | undefined): unknown =>
  cursor == null ? null : JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))

// ── getCheckpoints ──

/** Canned checkpoint stream: seqs 0..300, streamed ascending between bounds. */
function checkpointLedger() {
  const requests: { startCheckpoint?: bigint; endCheckpoint?: bigint }[] = []
  const frames = (start?: bigint, end?: bigint) =>
    (async function* () {
      const last = end ?? TOTAL + 1n
      for (let seq = start ?? 0n; seq < last; seq++) {
        yield {
          checkpoint: {
            sequenceNumber: seq,
            digest: `digest-${seq}`,
            summary: { epoch: 1n, timestamp: { seconds: 1700000000n + seq, nanos: 0 } },
            transactions: [{ digest: `tx-${seq}` }],
          },
        }
      }
    })()
  const TOTAL = 300n
  return {
    requests,
    ledgerService: {
      getServiceInfo: async () => ({ response: { checkpointHeight: TOTAL } }),
      listCheckpoints: (input: { startCheckpoint?: bigint; endCheckpoint?: bigint }) => {
        requests.push({
          startCheckpoint: input.startCheckpoint,
          endCheckpoint: input.endCheckpoint,
        })
        return { responses: frames(input.startCheckpoint, input.endCheckpoint) }
      },
    },
  }
}

describe('SuiGrpcChainClient.getCheckpoints', () => {
  it('descending pages resume strictly BEFORE the previous page (no overlap)', async () => {
    const ledger = checkpointLedger()
    const client = clientWith(ledger)

    const page1 = await client.getCheckpoints({ limit: 100, descendingOrder: true })
    assert.equal(page1.data.length, 100)
    assert.equal(page1.data[0]!.sequenceNumber, '300')
    assert.equal(page1.data[99]!.sequenceNumber, '201')
    assert.equal(page1.hasNextPage, true)
    const seq1 = (decodeCursor(page1.nextCursor) as { a?: string }).a
    assert.equal(seq1, '201')

    const page2 = await client.getCheckpoints({
      cursor: page1.nextCursor,
      limit: 100,
      descendingOrder: true,
    })
    // exclusive resume: the anchored checkpoint (201) must NOT repeat
    assert.equal(page2.data[0]!.sequenceNumber, '200')
    assert.equal(page2.data[99]!.sequenceNumber, '101')
    assert.deepEqual(ledger.requests[1], { startCheckpoint: 101n, endCheckpoint: 201n })
  })

  it('descending walk terminates at genesis', async () => {
    const ledger = checkpointLedger()
    const client = clientWith(ledger)
    const seen: string[] = []
    let cursor: string | null | undefined
    for (let page = 0; page < 10; page++) {
      const res = await client.getCheckpoints({
        ...(cursor ? { cursor } : {}),
        limit: 100,
        descendingOrder: true,
      })
      for (const checkpoint of res.data) seen.push(checkpoint.sequenceNumber)
      if (!res.hasNextPage) break
      cursor = res.nextCursor
    }
    // every checkpoint exactly once, newest to oldest
    assert.equal(seen.length, 301)
    assert.equal(seen[0], '300')
    assert.equal(seen[300], '0')
    assert.equal(new Set(seen).size, seen.length)
  })

  it('ascending pages resume strictly AFTER the previous page', async () => {
    const ledger = checkpointLedger()
    const client = clientWith(ledger)

    const page1 = await client.getCheckpoints({ limit: 100, descendingOrder: false })
    assert.equal(page1.data[0]!.sequenceNumber, '0')
    assert.equal(page1.data[99]!.sequenceNumber, '99')

    const page2 = await client.getCheckpoints({
      cursor: page1.nextCursor,
      limit: 100,
      descendingOrder: false,
    })
    assert.equal(page2.data[0]!.sequenceNumber, '100')
    assert.deepEqual(ledger.requests[1], { startCheckpoint: 100n, endCheckpoint: 200n })
  })

  it('caps ascending pages at the indexed tip and terminates there', async () => {
    const ledger = checkpointLedger()
    const client = clientWith(ledger)
    const page = await client.getCheckpoints({ cursor: '201', limit: 100 })
    assert.equal(page.data.length, 100)
    assert.equal(page.data[99]!.sequenceNumber, '300')
    assert.equal(page.hasNextPage, false)
    assert.deepEqual(ledger.requests[0], { startCheckpoint: 201n, endCheckpoint: 301n })

    const beyond = await client.getCheckpoints({ cursor: page.nextCursor, limit: 100 })
    assert.deepEqual(beyond, { data: [], hasNextPage: false, nextCursor: null })
    assert.equal(ledger.requests.length, 1, 'no server stream starts past the tip')

    const tail = await client.getCheckpoints({ cursor: '290', limit: 100 })
    assert.equal(tail.data.length, 11)
    assert.equal(tail.hasNextPage, false)
    assert.deepEqual(ledger.requests[1], { startCheckpoint: 290n, endCheckpoint: 301n })
  })

  it('accepts a bare sequence-number cursor as an inclusive start', async () => {
    // the SDK's checkpoint walk passes String(fromCheckpoint): the first page
    // must include that checkpoint
    const ledger = checkpointLedger()
    const client = clientWith(ledger)
    const page = await client.getCheckpoints({ cursor: '120', limit: 100, descendingOrder: false })
    assert.equal(page.data[0]!.sequenceNumber, '120')
    assert.equal(page.data[99]!.sequenceNumber, '219')
    assert.deepEqual(ledger.requests[0], { startCheckpoint: 120n, endCheckpoint: 220n })
  })

  it('resumes when the server caps a page below the requested range', async () => {
    // public fullnodes cap ListCheckpoints (50 items) and end the stream with
    // ITEM_LIMIT; the length-based heuristic must not stop the walk early
    const requests: { options?: { limit?: number } }[] = []
    const client = clientWith({
      ledgerService: {
        getServiceInfo: async () => ({ response: { checkpointHeight: 400n } }),
        listCheckpoints: (input: { startCheckpoint?: bigint; options?: { limit?: number } }) => {
          requests.push(input)
          return {
            responses: (async function* () {
              const start = input.startCheckpoint ?? 0n
              for (let seq = start; seq < start + 10n; seq++)
                yield { checkpoint: { sequenceNumber: seq, digest: `digest-${seq}` } }
              yield { end: { reason: 1 /* ITEM_LIMIT */ } }
            })(),
          }
        },
      },
    })
    const page = await client.getCheckpoints({ cursor: '100', limit: 100 })
    assert.equal(requests[0]!.options?.limit, 100)
    assert.equal(page.data.length, 10)
    assert.equal(page.hasNextPage, true)
    assert.equal((decodeCursor(page.nextCursor) as { a?: string }).a, '109')
  })
})

// ── queryTransactionBlocks ──

describe('SuiGrpcChainClient.queryTransactionBlocks', () => {
  it('passes the caller limit through and resumes from the page end cursor', async () => {
    const requests: Record<string, unknown>[] = []
    const makeTx = (digest: string) => ({ Transaction: { digest, checkpoint: '10' } })
    let call = 0
    const client = clientWith({
      listTransactions: async (input: Record<string, unknown>) => {
        requests.push(input)
        call++
        return call === 1
          ? {
              transactions: [makeTx('d1'), makeTx('d2'), makeTx('d3')],
              hasNextPage: true,
              startCursor: 'start-1',
              endCursor: 'anchor-1',
            }
          : {
              transactions: [makeTx('d4'), makeTx('d5')],
              hasNextPage: false,
              startCursor: 'anchor-1',
              endCursor: 'anchor-2',
            }
      },
    })

    const page1 = await client.queryTransactionBlocks({
      filter: { MoveFunction: { package: '0xp', module: 'offramp', function: 'execute' } },
      options: { showEffects: true },
      limit: 3,
      order: 'descending',
    })
    // the library does its own lookahead: no limit+1 on top of it
    assert.equal(requests[0]!.limit, 3)
    assert.equal(requests[0]!.order, 'descending')
    assert.deepEqual(
      page1.data.map((tx) => tx.digest),
      ['d1', 'd2', 'd3'],
    )
    assert.equal(page1.hasNextPage, true)
    // the cursor envelope carries the library's end anchor verbatim
    assert.deepEqual(decodeCursor(page1.nextCursor), { a: 'anchor-1' })

    const page2 = await client.queryTransactionBlocks({
      filter: { MoveFunction: { package: '0xp', module: 'offramp', function: 'execute' } },
      options: { showEffects: true },
      cursor: page1.nextCursor,
      limit: 3,
      order: 'descending',
    })
    // resuming decodes the envelope back to the anchor
    assert.equal(requests[1]!.before, 'anchor-1')
    assert.deepEqual(
      page2.data.map((tx) => tx.digest),
      ['d4', 'd5'],
    )
    assert.equal(page2.hasNextPage, false)
  })
})

// ── queryTransactionBlocks' InputObject path (raw ledger service) ──

describe('SuiGrpcChainClient.queryTransactionBlocks (InputObject)', () => {
  const framesOf = (digests: string[], endReason?: number) =>
    (async function* () {
      for (const digest of digests) {
        yield {
          transaction: { digest, checkpoint: 5n },
          watermark: { cursor: new Uint8Array([1, 2, 3]) },
        }
      }
      if (endReason != null) yield { end: { reason: endReason } }
    })()

  it('stops the limit+1 lookahead at the page edge without skipping it', async () => {
    const requests: Record<string, unknown>[] = []
    const client = clientWith({
      ledgerService: {
        listTransactions: (input: Record<string, unknown>) => {
          requests.push(input)
          return { responses: framesOf(['t1', 't2', 't3', 't4', 't5']) }
        },
      },
    })

    const page1 = await client.queryTransactionBlocks({
      filter: { InputObject: '0xref' },
      options: { showEffects: true },
      limit: 3,
      order: 'ascending',
    })
    assert.deepEqual(
      page1.data.map((tx) => tx.digest),
      ['t1', 't2', 't3'],
    )
    assert.equal(page1.hasNextPage, true)
    // the lookahead item (t4) must be reachable on resume: the cursor stays at
    // the last ACCEPTED item's watermark (bytes 1,2,3 → 'AQID')
    assert.equal((decodeCursor(page1.nextCursor) as { a?: string }).a, 'AQID')

    await client.queryTransactionBlocks({
      filter: { InputObject: '0xref' },
      options: { showEffects: true },
      cursor: page1.nextCursor,
      limit: 3,
      order: 'ascending',
    })
    const options2 = requests[1]!.options as Record<string, unknown>
    // exclusive resume from the same anchor bytes
    assert.deepEqual(Array.from(options2.after as Uint8Array), [1, 2, 3])
  })

  it('reports no next page when the scan ends at its bound', async () => {
    const client = clientWith({
      ledgerService: {
        listTransactions: () => ({ responses: framesOf(['t1', 't2'], 3 /* CHECKPOINT_BOUND */) }),
      },
    })
    const page = await client.queryTransactionBlocks({
      filter: { InputObject: '0xref' },
      limit: 3,
      order: 'ascending',
    })
    assert.equal(page.data.length, 2)
    assert.equal(page.hasNextPage, false)
  })

  it('reports a next page when the scan hits the item limit', async () => {
    const client = clientWith({
      ledgerService: {
        listTransactions: () => ({ responses: framesOf(['t1', 't2', 't3'], 1 /* ITEM_LIMIT */) }),
      },
    })
    const page = await client.queryTransactionBlocks({
      filter: { InputObject: '0xref' },
      limit: 3,
      order: 'ascending',
    })
    assert.equal(page.data.length, 3)
    assert.equal(page.hasNextPage, true)
  })
})

// ── queryEvents ──

describe('SuiGrpcChainClient.queryEvents', () => {
  it('round-trips the ledger anchor through the EventId cursor', async () => {
    const requests: Record<string, unknown>[] = []
    const makeEvent = (index: number) => ({
      packageId: '0xp',
      module: 'offramp',
      sender: '0xs',
      eventType: '0xp::offramp::CCIPMessageSent',
      json: { sequence_number: String(index) },
      bcs: null,
      checkpoint: '10',
      transactionDigest: `tx-${index}`,
      eventIndex: index,
    })
    let call = 0
    const client = clientWith({
      // unresolvable package descriptors: the render walk leaves event.json
      // untouched (the poisoned-cache fallback path)
      movePackageService: {
        getPackage: async () => {
          throw new Error('package lookup unavailable')
        },
      },
      listEvents: async (input: Record<string, unknown>) => {
        requests.push(input)
        call++
        return call === 1
          ? { events: [makeEvent(2), makeEvent(1)], hasNextPage: true, endCursor: 'anchor-e1' }
          : { events: [], hasNextPage: false, endCursor: null }
      },
    })

    const page1 = await client.queryEvents({
      query: { MoveEventType: '0xp::offramp::CCIPMessageSent' },
      limit: 2,
      order: 'descending',
    })
    assert.equal(requests[0]!.limit, 2)
    assert.deepEqual(
      page1.data.map((event) => event.id.txDigest),
      ['tx-2', 'tx-1'],
    )
    const parsed = page1.data[0]!.parsedJson as { sequence_number?: string }
    assert.equal(parsed.sequence_number, '2')
    // the anchor envelope rides in the txDigest slot
    assert.equal(page1.nextCursor!.txDigest, 'grpc:anchor-e1')
    assert.equal(page1.nextCursor!.eventSeq, '1')

    const page2 = await client.queryEvents({
      query: { MoveEventType: '0xp::offramp::CCIPMessageSent' },
      cursor: page1.nextCursor,
      limit: 2,
      order: 'descending',
    })
    // descending resume: strictly BEFORE the anchored position
    assert.equal(requests[1]!.before, 'anchor-e1')
    assert.equal(page2.hasNextPage, false)
  })

  it('ends pagination on an empty page even when the backend claims more', async () => {
    // a zero-event page cannot advance the cursor: passing the backend's
    // hasNextPage through would strand a !hasNextPage caller on the same
    // cursor forever
    const client = clientWith({
      listEvents: async () => ({ events: [], hasNextPage: true, endCursor: 'anchor-e1' }),
    })

    const page = await client.queryEvents({
      query: { MoveEventType: '0xp::m::E' },
      cursor: { txDigest: 'grpc:anchor-e0', eventSeq: '0' },
      limit: 2,
    })
    assert.equal(page.data.length, 0)
    assert.equal(page.hasNextPage, false)
    // the (unadvanced) input cursor is threaded through unchanged
    assert.equal(page.nextCursor!.txDigest, 'grpc:anchor-e0')
  })
})

// ── transaction events ──

describe('SuiGrpcChainClient.getTransactionBlock', () => {
  it('fills the enclosing digest on events embedded in a transaction', async () => {
    // a transaction response's events carry no digest of their own; the
    // checkpoint walk's logs need the enclosing tx's digest as transactionHash
    const client = clientWith({
      ledgerService: {
        getTransaction: async () => ({
          response: {
            transaction: {
              digest: 'd1',
              checkpoint: 1n,
              events: { events: [{ eventType: '0xp::m::E', transactionDigest: '' }] },
            },
          },
        }),
      },
    })
    const tx = await client.getTransactionBlock({ digest: 'd1', options: { showEvents: true } })
    const events = (tx as unknown as { events: { id: { txDigest: string } }[] }).events
    assert.equal(events[0]!.id.txDigest, 'd1')
  })
})

// ── getOwnedObjects ──

describe('SuiGrpcChainClient.getOwnedObjects', () => {
  it('passes the server cursor through and refuses unsupported filters', async () => {
    const requests: Record<string, unknown>[] = []
    const client = clientWith({
      listOwnedObjects: async (input: Record<string, unknown>) => {
        requests.push(input)
        return {
          objects: [{ objectId: '0xo1', version: '2', digest: 'd', type: '0xp::m::T' }],
          cursor: 'token-2',
          hasNextPage: true,
        }
      },
    })

    const page = await client.getOwnedObjects({
      owner: '0xowner',
      filter: { StructType: '0x2::package::UpgradeCap' },
      options: { showType: true },
      limit: 1,
    })
    assert.equal(requests[0]!.limit, 1)
    assert.equal(requests[0]!.type, '0x2::package::UpgradeCap')
    assert.equal(page.data.length, 1)
    assert.equal(page.data[0]!.data!.objectId, '0xo1')
    assert.equal(page.hasNextPage, true)
    // the server's page token IS the next cursor (no envelope)
    assert.equal(page.nextCursor, 'token-2')

    await assert.rejects(
      client.getOwnedObjects({ owner: '0xowner', filter: { Package: '0xp' } as never }),
      /Unsupported Sui object filter/,
    )
  })
})

// ── error typing: CCIPError codes with message semantics preserved ──

describe('SuiGrpcChainClient error typing', () => {
  it('rephrases NOT_FOUND lookups as typed, transient transaction errors', async () => {
    // the transport's RpcError carries the status-code STRING ('NOT_FOUND')
    const notFound = Object.assign(new Error('nope'), { code: 'NOT_FOUND' })
    const client = clientWith({
      ledgerService: {
        getTransaction: async () => {
          throw notFound
        },
      },
    })
    await assert.rejects(
      client.getTransactionBlock({ digest: 'd1', options: {} }),
      (error: unknown) => {
        assert.ok(error instanceof CCIPError)
        assert.equal(error.code, CCIPErrorCode.TRANSACTION_NOT_FOUND)
        assert.equal(error.isTransient, true)
        // the SDK's retry regex (withLookupRetry) matches on message
        assert.match(error.message, /could not find the referenced transaction/i)
        return true
      },
    )
  })

  for (const [code, message, pruned] of [
    ['NOT_FOUND', 'pruned', true],
    [
      'OUT_OF_RANGE',
      'requested data below earliest available; lowest available checkpoint is 394032323',
      true,
    ],
    ['OUT_OF_RANGE', 'invalid page token', false],
  ] as const) {
    it(`handles the event query error ${code}: ${message}`, async () => {
      const failure = Object.assign(new Error(message), { code })
      const client = clientWith({
        listEvents: async () => {
          throw failure
        },
      })
      await assert.rejects(
        client.queryEvents({ query: { MoveEventType: '0xp::m::E' }, limit: 1 }),
        (error: unknown) => {
          if (!pruned) return error === failure
          assert.ok(error instanceof CCIPError)
          assert.equal(error.code, CCIPErrorCode.TRANSACTION_NOT_FOUND)
          assert.match(error.message, /could not find the referenced transaction events/i)
          return true
        },
      )
    })
  }

  it('keeps the unsupported-filter messages the discovery fallback matches', async () => {
    const client = clientWith({})
    await assert.rejects(
      client.queryTransactionBlocks({
        filter: { ToAddress: '0xrecipient' } as never,
        limit: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CCIPError)
        assert.equal(error.code, CCIPErrorCode.METHOD_UNSUPPORTED)
        // the gRPC layer rejects filters the normalized client can't express
        // (InputObject is handled upstream via the affected-object query)
        assert.match(error.message, /Unsupported Sui transaction filter/)
        return true
      },
    )
  })
})

// ── descriptor negative cache: transient failures must recover ──

describe('SuiGrpcChainClient descriptor cache', () => {
  it('recovers event rendering after a transient package-descriptor failure', async () => {
    // getPackage fails ONCE, then serves the descriptors: the second render
    // (after the negative TTL) must succeed — the old code cached the failure
    // forever
    const datatype = {
      typeName: '0x1234::msg::Message',
      fields: [{ name: 'bytes', type: { type: 9, typeParameterInstantiation: [{ type: 3 }] } }],
    }
    let failures = 0
    const client = SuiGrpcChainClient.from({
      client: {
        movePackageService: {
          getPackage: async () => {
            if (failures++ === 0) throw new Error('backend not synced yet')
            return { response: { package: { modules: [{ name: 'msg', datatypes: [datatype] }] } } }
          },
        },
        listEvents: async () => ({
          events: [
            {
              packageId: '0x1234',
              module: 'msg',
              sender: '0xs',
              eventType: '0x1234::msg::Message',
              json: { bytes: 'AQID' },
              bcs: new Uint8Array([3, 1, 2, 3]), // { bytes: vector<u8> [1, 2, 3] }
              transactionDigest: 'tx-1',
              eventIndex: 0,
            },
          ],
          hasNextPage: false,
          endCursor: null,
        }),
      } as unknown as SuiGrpcClient,
      descriptorNegativeTtlMs: 10, // cross the negative window in the test
    })

    // first call: descriptors unavailable — the raw json passes through
    const page1 = await client.queryEvents({
      query: { MoveEventType: '0x1234::msg::Message' },
      limit: 1,
    })
    assert.deepEqual(page1.data[0]!.parsedJson, { bytes: 'AQID' })

    // past the negative window: the fetch retries, succeeds, the render applies
    await new Promise((resolve) => setTimeout(resolve, 25))
    const page2 = await client.queryEvents({
      query: { MoveEventType: '0x1234::msg::Message' },
      limit: 1,
    })
    assert.deepEqual(page2.data[0]!.parsedJson, { bytes: [1, 2, 3] })

    // third call: served from the cache (no further fetches)
    const fetchesAfterRecovery = failures
    const page3 = await client.queryEvents({
      query: { MoveEventType: '0x1234::msg::Message' },
      limit: 1,
    })
    assert.deepEqual(page3.data[0]!.parsedJson, { bytes: [1, 2, 3] })
    assert.equal(failures, fetchesAfterRecovery)
  })
})

// ── injected transport: the adapter runs over any RpcTransport (HTTP or not) ──

describe('SuiGrpcChainClient.from({ transport })', () => {
  it('serves the SDK surface through a caller-built transport (no fetch, no Node gRPC)', async () => {
    // protobuf-ts MethodInfo: {name, localName, I, O, ...}; O.create builds the
    // response message from a plain object. A unary call is a thenable
    // resolving to {headers, response, status, trailers} — core destructures
    // {response}.
    const canned: Record<string, unknown> = {
      // getServiceInfo serves BOTH getChainIdentifier (chainId) and the
      // adapter's getLatestCheckpointSequenceNumber (checkpointHeight)
      getserviceinfo: {
        chainId: '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD',
        checkpointHeight: 987654n,
      },
      getcheckpoint: {
        checkpoint: {
          sequenceNumber: 987654n,
          digest: 'cp-digest',
          summary: { epoch: 42n, timestamp: { seconds: 1792279576n, nanos: 0 } },
          transactions: [{ digest: 'tx-1' }],
        },
      },
    }
    const calls: string[] = []
    const transport = {
      mergeOptions: (options?: Record<string, unknown>) => options ?? {},
      unary: async (method: { name: string; O: { create(value: unknown): unknown } }) => {
        calls.push(method.name)
        const payload = canned[method.name.toLowerCase()]
        if (payload === undefined) throw new Error(`unexpected unary method: ${method.name}`)
        return { response: method.O.create(payload as never) }
      },
      // unused by these calls, but required by the transport contract
      serverStreaming: () => {
        throw new Error('unexpected serverStreaming call')
      },
      clientStreaming: () => {
        throw new Error('unexpected clientStreaming call')
      },
      duplex: () => {
        throw new Error('unexpected duplex call')
      },
    }

    const client = SuiGrpcChainClient.from({ transport: transport as never })

    // chain identifier: the transport's base58 genesis digest → JSON-RPC hex
    assert.equal(await client.getChainIdentifier(), '4c78adac')
    // latest checkpoint seq: from the same service info
    assert.equal(await client.getLatestCheckpointSequenceNumber(), '987654')
    // checkpoint mapping: summary timestamp + digests, JSON-RPC shapes
    const checkpoint = await client.getCheckpoint({ id: '987654' })
    assert.equal(checkpoint.sequenceNumber, '987654')
    assert.equal(checkpoint.epoch, '42')
    assert.equal(checkpoint.timestampMs, '1792279576000')
    assert.deepEqual(checkpoint.transactions, ['tx-1'])
    // the calls went through the injected transport (no fetch transport built)
    assert.ok(calls.length >= 3)
  })

  it('fromBaseUrl builds a client without touching the network', () => {
    const client = SuiGrpcChainClient.fromBaseUrl('https://fullnode.testnet.sui.io:443')
    assert.equal(client.baseUrl, 'https://fullnode.testnet.sui.io:443')
  })
})
