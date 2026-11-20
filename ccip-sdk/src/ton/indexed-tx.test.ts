import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import {
  type Cell,
  type Message,
  Address,
  ExternalAddress,
  beginCell,
  storeMessage,
} from '@ton/core'

import { CCIPHttpError } from '../errors/index.ts'
import {
  type TonV3LogMessage,
  TOPIC_COMMIT_REPORT_ACCEPTED,
  TOPIC_EXECUTION_STATE_CHANGED,
  fetchIndexedTransaction,
  indexRowsByPrefix,
  indexedTransactionFromRow,
  offRampBodyPrefix,
  verifiedLogTopic,
  withIndexRetries,
} from './indexed-tx.ts'
import { crc32 } from './utils.ts'

const SELECTOR = 16015286601757825753n
const SENDER = Address.parse('EQDioi9PI32Wo1oBwkUp0pj1AhwvAHiKiZCfgrr0iDqu3lTA')

const executionBody = (state: number) =>
  beginCell()
    .storeUint(SELECTOR, 64)
    .storeUint(5, 64)
    .storeUint(7, 256)
    .storeUint(state, 8)
    .endCell()

const ocr3Body = (type: number) =>
  beginCell().storeUint(type, 16).storeUint(9, 256).storeUint(3, 64).endCell()

/** An index row of a log message `topic` (a 256-bit external destination, as
 * chainlink-ton emits it), with the hash of the full message cell. */
const logRow = (
  topic: string,
  body: Cell,
  {
    source = SENDER.toRawString().toUpperCase(),
    createdLt = '110048859000029',
    createdAt = '1794803510',
    forceRef = false,
  } = {},
) => {
  const message: Message = {
    info: {
      type: 'external-out',
      src: Address.parse(source),
      dest: new ExternalAddress(BigInt(topic), 256),
      createdLt: BigInt(createdLt),
      createdAt: Number(createdAt),
    },
    body,
  }
  return {
    hash: beginCell()
      .store(storeMessage(message, { forceRef }))
      .endCell()
      .hash()
      .toString('base64'),
    source,
    destination: null,
    created_lt: createdLt,
    created_at: createdAt,
    message_content: { body: body.toBoc().toString('base64') },
  }
}

/** Index rows read from ton-testnet (2026-11-20), as the index serves them. */
const LIVE_ROWS = {
  onRampSent: {
    source: '0:E2A22F4F237D96A35A01C24529D298F5021C2F00788A89909F82BAF4883AAEDE',
    created_lt: '110910028000024',
    created_at: '1795147448',
    hash: 'ruCT6m0vtLmK/zpcyo6J1bDi7Y42V9nYIxc6QYsNbHI=',
    body: 'te6cckECBgEAAUUAAdt5Xm1I1YyvGlTdvGPXdAS4Ir7y1nwfHhHxzioIO7r1LRNrUM2DxpLo3kG6T8nZGtkAAAAAAAApUwAAAAAAAAAAgANDmgInwbFXN9ygmJ3jyfiXyZMxTtYCJxGZC5wyAb2uAAAAAAAAAAAAvJXTMAEEg4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGbwNhcAIDBAUAQiAAAAAAAAAAAAAAAACM6Nm2Jpx2hw7ra1nOn7IPTYjFCgB8AgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAACB0ndJKv2JDiMWfa/uG4SnVD95yUASRgdzxCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAehIGAAAKTGB90=',
  },
  /** A price-only commit: a 2-bit body with a ref, which the contract stores as a ref. */
  priceOnlyCommit: {
    source: '0:CFB90D27C9D457C903D616BFDDE30FADCDF40C5F0A2F91ED136883CB94205D80',
    created_lt: '110979873000008',
    created_at: '1795175345',
    hash: 'omrszyLXt/TMxVNshEyaPmgL3ITZQs5n6EjjoQqISqw=',
    body: 'te6cckEBBAEAeAABAWABAgACAwAAANgwRhG2r/unagAAAAAAAAAAAA+PW0FMAAAAAAAAAAAAAAAFsJLeQbpPydka2QAAAAAAAAAAABRWtLaEAAAAAAAAAAAAAAAAAADj7MfilOM33wAAAAAAAAAAAAAAARtfAAAAAAAAAAAAAAAAAACxlaWq',
  },
  ocr3: {
    source: '0:CFB90D27C9D457C903D616BFDDE30FADCDF40C5F0A2F91ED136883CB94205D80',
    created_lt: '110979873000007',
    created_at: '1795175345',
    hash: 'WNugkCDPohFZkNNPLI5R8FoBBvP9TfupsWx3f8mpSC0=',
    body: 'te6cckEBAQEALAAAVAAAAArxG294OWyOwb6d6skjO2NWhvobi42T2OeM9jpFcJQAAAAAABSTJwFMZRk=',
  },
}
const live = (row: (typeof LIVE_ROWS)[keyof typeof LIVE_ROWS]): TonV3LogMessage => ({
  hash: row.hash,
  source: row.source,
  created_lt: row.created_lt,
  created_at: row.created_at,
  message_content: { body: row.body },
})

describe('verifiedLogTopic', () => {
  it('proves the topics of live log rows from their message hash', () => {
    assert.equal(verifiedLogTopic(live(LIVE_ROWS.onRampSent)), crc32('CCIPMessageSent'))
    assert.equal(verifiedLogTopic(live(LIVE_ROWS.priceOnlyCommit)), TOPIC_COMMIT_REPORT_ACCEPTED)
    assert.equal(verifiedLogTopic(live(LIVE_ROWS.ocr3)), crc32('OCR3Base_Transmitted'))
  })

  it('tries only the given candidates', () => {
    const row = live(LIVE_ROWS.onRampSent)
    assert.equal(verifiedLogTopic(row, [TOPIC_EXECUTION_STATE_CHANGED]), undefined)
    assert.equal(verifiedLogTopic(row, [crc32('CCIPMessageSent')]), crc32('CCIPMessageSent'))
  })

  it('matches a body stored inline or as a ref', () => {
    const body = executionBody(2)
    for (const forceRef of [false, true])
      assert.equal(
        verifiedLogTopic(logRow(TOPIC_EXECUTION_STATE_CHANGED, body, { forceRef })),
        TOPIC_EXECUTION_STATE_CHANGED,
      )
  })

  it('finds no topic for an unknown event or a row that does not hash to its fields', () => {
    assert.equal(verifiedLogTopic(logRow(crc32('NotAnEvent'), executionBody(2))), undefined)
    const row = live(LIVE_ROWS.ocr3)
    assert.equal(verifiedLogTopic({ ...row, created_lt: '110979873000006' }), undefined)
    assert.equal(verifiedLogTopic({ ...row, created_at: '1795175346' }), undefined)
    assert.equal(verifiedLogTopic({ ...row, source: SENDER.toRawString() }), undefined)
    assert.equal(verifiedLogTopic({ ...row, message_content: { body: null } }), undefined)
    assert.equal(verifiedLogTopic({ ...row, source: null }), undefined)
  })
})

describe('offRampBodyPrefix', () => {
  it('matches the prefixes observed live for sepolia', () => {
    assert.equal(offRampBodyPrefix.execution(SELECTOR), '0xde41ba4f')
    assert.equal(offRampBodyPrefix.rootedCommit(SELECTOR), '0xef20dd27')
  })
  it('zero-pads a small selector to 10 characters', () => {
    assert.equal(offRampBodyPrefix.execution(1n), '0x00000000')
    assert.equal(offRampBodyPrefix.rootedCommit(1n), '0x80000000')
  })
})

describe('withIndexRetries', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] })
  })
  afterEach(() => {
    mock.timers.reset()
  })

  /** Ticks the mocked clock until `promise` settles. */
  const settle = async <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> => {
    let done: PromiseSettledResult<T> | undefined
    void promise.then(
      (value) => (done = { status: 'fulfilled', value }),
      (reason) => (done = { status: 'rejected', reason }),
    )
    for (let i = 0; i < 50 && !done; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      mock.timers.tick(6_000)
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.ok(done, 'promise did not settle')
    return done
  }

  it('returns the value on success', async () => {
    const read = mock.fn(() => Promise.resolve(42))
    assert.equal(await withIndexRetries(read), 42)
    assert.equal(read.mock.calls.length, 1)
  })

  it('retries a transient CCIPError, then returns', async () => {
    const transient = new CCIPHttpError(429, 'x')
    assert.equal(transient.isTransient, true)
    let n = 0
    const read = mock.fn(() => (++n < 3 ? Promise.reject(transient) : Promise.resolve('ok')))
    const res = await settle(withIndexRetries(read))
    assert.deepEqual(res, { status: 'fulfilled', value: 'ok' })
    assert.equal(read.mock.calls.length, 3)
  })

  it('rethrows a non-transient error at once', async () => {
    const err = new CCIPHttpError(400, 'bad')
    assert.equal(err.isTransient, false)
    const read = mock.fn(() => Promise.reject(err))
    await assert.rejects(withIndexRetries(read), err)
    assert.equal(read.mock.calls.length, 1)
  })

  it('rethrows after the retries run out (4 calls)', async () => {
    const err = new CCIPHttpError(429, 'x')
    const read = mock.fn(() => Promise.reject(err))
    const res = await settle(withIndexRetries(read))
    assert.equal(res.status, 'rejected')
    assert.equal((res as PromiseRejectedResult).reason, err)
    assert.equal(read.mock.calls.length, 4)
  })
})

describe('indexRowsByPrefix', () => {
  const account = SENDER
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const row = (i: number, createdAt: number, createdLt = String(1000 + i)) => ({
    hash: `h${i}`,
    source: account.toRawString(),
    destination: null,
    created_lt: createdLt,
    created_at: String(createdAt),
    out_msg_tx_hash: `t${i}`,
    message_content: { body: 'te6cckEBAQEAAgAAAEysuc0=' },
  })
  const makeCtx = (pages: Response[]) => {
    const urls: URL[] = []
    const rateLimitedFetch = mock.fn((input: string | URL) => {
      urls.push(new URL(String(input)))
      const next = pages.shift()
      assert.ok(next, 'unexpected extra request')
      return Promise.resolve(next)
    }) as unknown as typeof fetch
    return { ctx: { rateLimitedFetch, v3BaseUrl: 'http://mock/api/v3' }, urls }
  }
  const collect = async (gen: AsyncGenerator<any>) => {
    const out: any[] = []
    for await (const r of gen) out.push(r)
    return out
  }

  it('yields a short page sorted by created_lt, in one request', async () => {
    const { ctx, urls } = makeCtx([
      json({ messages: [row(3, 50, '1003'), row(1, 50, '1001'), row(2, 51, '1002')] }),
    ])
    const rows = await collect(indexRowsByPrefix(ctx, account, '0xde41ba4f', 40))
    assert.deepEqual(
      rows.map((r) => r.created_lt),
      ['1001', '1002', '1003'],
    )
    assert.equal(urls.length, 1)
    const q = urls[0]!.searchParams
    assert.equal(urls[0]!.pathname, '/api/v3/messages')
    assert.equal(q.get('source'), account.toRawString())
    assert.equal(q.get('destination'), 'null')
    assert.equal(q.get('direction'), 'out')
    assert.equal(q.get('opcode'), '0xde41ba4f')
    assert.equal(q.get('start_utime'), '40')
    assert.equal(q.get('sort'), 'asc')
    assert.equal(q.get('limit'), '100')
  })

  it('turns a full page by max created_at and skips repeated rows', async () => {
    const first = Array.from({ length: 100 }, (_, i) => row(i, i < 98 ? 10 : 11))
    const second = [row(98, 11), row(99, 11), row(100, 12)]
    const { ctx, urls } = makeCtx([json({ messages: first }), json({ messages: second })])
    const rows = await collect(indexRowsByPrefix(ctx, account, '0xef20dd27', 5))
    assert.equal(rows.length, 101)
    assert.equal(new Set(rows.map((r) => r.hash)).size, 101)
    assert.equal(urls.length, 2)
    assert.equal(urls[1]!.searchParams.get('start_utime'), '11')
  })

  it('drains a second holding more than a page of rows by offset', async () => {
    // 101 rows share second 11: the turn re-reads the same 100, then the offset read
    // skips exactly those and returns the 101st.
    const full = Array.from({ length: 100 }, (_, i) => row(i, 11))
    const { ctx, urls } = makeCtx([
      json({ messages: full }),
      json({ messages: full }),
      json({ messages: [row(100, 11)] }),
    ])
    const rows = await collect(indexRowsByPrefix(ctx, account, '0xef20dd27', 5))
    assert.equal(rows.length, 101)
    assert.equal(new Set(rows.map((r) => r.hash)).size, 101)
    assert.equal(urls.length, 3)
    assert.equal(urls[2]!.searchParams.get('start_utime'), '11')
    assert.equal(urls[2]!.searchParams.get('offset'), '100')
  })

  it('advances start_utime by one once the boundary second is drained', async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(i, 11))
    const { ctx, urls } = makeCtx([
      json({ messages: full }),
      json({ messages: full }),
      json({ messages: [] }),
      json({ messages: [] }),
    ])
    const rows = await collect(indexRowsByPrefix(ctx, account, '0xef20dd27', 5))
    assert.equal(rows.length, 100)
    assert.equal(urls.length, 4)
    assert.equal(urls[1]!.searchParams.get('start_utime'), '11')
    assert.equal(urls[2]!.searchParams.get('offset'), '100')
    assert.equal(urls[3]!.searchParams.get('start_utime'), '12')
    assert.equal(urls[3]!.searchParams.get('offset'), null)
  })

  it('waits out a transient 429, then yields the rows', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const { ctx, urls } = makeCtx([
        new Response('slow down', { status: 429 }),
        json({ messages: [row(1, 10)] }),
      ])
      const pending = collect(indexRowsByPrefix(ctx, account, '0xde41ba4f', 5))
      let rows: any[] | undefined
      void pending.then((r) => (rows = r))
      for (let i = 0; i < 20 && !rows; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        mock.timers.tick(1_500)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
      assert.equal(rows?.length, 1)
      assert.equal(urls.length, 2)
    } finally {
      mock.timers.reset()
    }
  })
})

describe('fetchIndexedTransaction', () => {
  const rawLower = SENDER.toRawString()
  const rawUpper = rawLower.toUpperCase()
  const other = Address.parse('0:' + '11'.repeat(32)).toRawString()
  const txHashHex = 'ab'.repeat(32)
  const txHashB64 = Buffer.from(txHashHex, 'hex').toString('base64')

  const execution = executionBody(2)
  const ocr3 = ocr3Body(1)
  const unknown = beginCell().storeUint(5, 10).endCell()

  const tx = {
    account: rawUpper,
    hash: txHashB64,
    lt: '110048859000028',
    now: 1794803510,
    mc_block_seqno: 98258637,
    prev_trans_lt: '110048859000020',
    out_msgs: [
      // out of order on purpose: logs must come back sorted by index
      logRow(crc32('OCR3Base_Transmitted'), ocr3, { createdLt: '110048859000031' }),
      logRow(TOPIC_EXECUTION_STATE_CHANGED, execution, { createdLt: '110048859000029' }),
      // an event whose topic is not a known one
      logRow(crc32('NotAnEvent'), unknown, { source: rawLower, createdLt: '110048859000032' }),
      // an internal message, and another account's log: not this account's logs
      {
        ...logRow(TOPIC_EXECUTION_STATE_CHANGED, execution, { createdLt: '110048859000033' }),
        destination: rawUpper,
      },
      logRow(TOPIC_EXECUTION_STATE_CHANGED, execution, {
        source: other,
        createdLt: '110048859000034',
      }),
    ],
  }

  const makeCtx = (res: Response) => {
    const urls: URL[] = []
    const rateLimitedFetch = mock.fn((input: string | URL) => {
      urls.push(new URL(String(input)))
      return Promise.resolve(res)
    }) as unknown as typeof fetch
    return { ctx: { rateLimitedFetch, v3BaseUrl: 'http://mock/api/v3' }, urls }
  }

  it('rebuilds the transaction with every log of the account', async () => {
    const { ctx, urls } = makeCtx(new Response(JSON.stringify({ transactions: [tx] })))
    const res = await fetchIndexedTransaction(ctx, SENDER, txHashHex)
    assert.ok(res)
    assert.equal(urls.length, 1)
    assert.equal(urls[0]!.pathname, '/api/v3/transactions')
    assert.equal(urls[0]!.searchParams.get('account'), rawLower)
    assert.equal(urls[0]!.searchParams.get('hash'), txHashHex)
    assert.equal(urls[0]!.searchParams.get('limit'), '1')

    const hash = `${rawLower}:${tx.lt}:${txHashHex}`
    assert.equal(res.hash, hash)
    assert.equal(res.blockNumber, tx.mc_block_seqno)
    assert.equal(res.timestamp, tx.now)
    assert.equal(res.from, rawLower)
    const ext = res as typeof res & { lt: string; prevTransactionLt: string }
    assert.equal(ext.lt, tx.lt)
    assert.equal(ext.prevTransactionLt, tx.prev_trans_lt)

    assert.deepEqual(
      res.logs.map((log) => [log.index, log.topics, log.data]),
      [
        [110048859000029, [TOPIC_EXECUTION_STATE_CHANGED], execution.toBoc().toString('base64')],
        [110048859000031, [crc32('OCR3Base_Transmitted')], ocr3.toBoc().toString('base64')],
        [110048859000032, [], unknown.toBoc().toString('base64')],
      ],
      'sorted by index; the unknown event kept without a topic',
    )
    for (const log of res.logs) {
      assert.equal(log.transactionHash, hash)
      assert.equal(log.blockNumber, tx.mc_block_seqno)
      assert.equal(log.blockTimestamp, tx.now)
      assert.equal(log.address, rawLower)
      assert.equal(log.tx, res)
    }
    assert.deepEqual(indexedTransactionFromRow(tx).logs.length, 3, 'the same rebuild from a row')
  })

  it('returns undefined when the index has no such transaction', async () => {
    const { ctx } = makeCtx(new Response(JSON.stringify({ transactions: [] })))
    assert.equal(await fetchIndexedTransaction(ctx, SENDER, txHashHex), undefined)
  })

  it('rejects with CCIPHttpError on a non-transient failure', async () => {
    const { ctx, urls } = makeCtx(new Response('boom', { status: 400 }))
    await assert.rejects(fetchIndexedTransaction(ctx, SENDER, txHashHex), (err) => {
      assert.ok(err instanceof CCIPHttpError)
      assert.match(err.message, /boom/)
      return true
    })
    assert.equal(urls.length, 1)
  })
})
