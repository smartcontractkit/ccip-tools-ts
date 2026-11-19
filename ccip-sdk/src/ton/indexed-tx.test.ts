import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { Address, Cell, beginCell } from '@ton/core'

import { CCIPHttpError } from '../errors/index.ts'
import {
  TOPIC_COMMIT_REPORT_ACCEPTED,
  TOPIC_EXECUTION_STATE_CHANGED,
  fetchIndexedTransaction,
  indexRowsByPrefix,
  offRampBodyPrefix,
  topicOfEventBody,
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

const rootedCommit = (
  opts: { onRampLength?: number; extraBit?: boolean; price?: boolean } = {},
) => {
  const len = opts.onRampLength ?? 20
  const b = beginCell()
    .storeBit(1)
    .storeUint(SELECTOR, 64)
    .storeUint(len, 8)
    .storeBuffer(Buffer.alloc(len, 0xab))
    .storeUint(1, 64)
    .storeUint(2, 64)
    .storeUint(3, 256)
    .storeBit(opts.price ? 1 : 0)
  if (opts.extraBit) b.storeBit(1)
  return b.endCell()
}

const onRampBody = (withRef = true, extraBit = false) => {
  const b = beginCell()
    .storeUint(1, 256)
    .storeUint(2, 64)
    .storeUint(3, 64)
    .storeUint(4, 64)
    .storeUint(5, 64)
    .storeAddress(SENDER)
  if (withRef) b.storeRef(beginCell().endCell())
  b.storeUint(6, 96)
  if (extraBit) b.storeBit(1)
  return b.endCell()
}

describe('topicOfEventBody', () => {
  describe('OffRamp', () => {
    for (const state of [1, 2, 3]) {
      it(`names ExecutionStateChanged for state ${state}`, () => {
        assert.equal(
          topicOfEventBody('OffRamp', executionBody(state)),
          TOPIC_EXECUTION_STATE_CHANGED,
        )
      })
    }
    for (const state of [0, 4]) {
      it(`ignores an ExecutionStateChanged-sized body with state ${state}`, () => {
        assert.equal(topicOfEventBody('OffRamp', executionBody(state)), undefined)
      })
    }

    for (const type of [0, 1]) {
      it(`names OCR3Base_Transmitted for plugin type ${type}`, () => {
        const body = ocr3Body(type)
        assert.equal(body.bits.length, 336)
        assert.equal(topicOfEventBody('OffRamp', body), crc32('OCR3Base_Transmitted'))
      })
    }
    it('ignores OCR3 plugin type 2', () => {
      assert.equal(topicOfEventBody('OffRamp', ocr3Body(2)), undefined)
    })

    it('names a rooted CommitReportAccepted (20-byte and 32-byte onRamp)', () => {
      const short = rootedCommit()
      assert.equal(short.bits.length, 618)
      assert.equal(topicOfEventBody('OffRamp', short), TOPIC_COMMIT_REPORT_ACCEPTED)
      const long = rootedCommit({ onRampLength: 32 })
      assert.equal(long.bits.length, 714)
      assert.equal(topicOfEventBody('OffRamp', long), TOPIC_COMMIT_REPORT_ACCEPTED)
    })

    it('names a rooted CommitReportAccepted with a price update ref', () => {
      const b = beginCell()
      b.storeBit(1)
        .storeUint(SELECTOR, 64)
        .storeUint(20, 8)
        .storeBuffer(Buffer.alloc(20, 0xab))
        .storeUint(1, 64)
        .storeUint(2, 64)
        .storeUint(3, 256)
        .storeBit(1)
        .storeRef(beginCell().storeUint(1, 8).endCell())
      assert.equal(topicOfEventBody('OffRamp', b.endCell()), TOPIC_COMMIT_REPORT_ACCEPTED)
    })

    it('names price-only and empty CommitReportAccepted', () => {
      const priceOnly = beginCell()
        .storeBit(0)
        .storeBit(1)
        .storeRef(beginCell().storeUint(1, 8).endCell())
        .endCell()
      assert.equal(topicOfEventBody('OffRamp', priceOnly), TOPIC_COMMIT_REPORT_ACCEPTED)
      const none = beginCell().storeBit(0).storeBit(0).endCell()
      assert.equal(topicOfEventBody('OffRamp', none), TOPIC_COMMIT_REPORT_ACCEPTED)
    })

    it('rejects malformed CommitReportAccepted bodies', () => {
      assert.equal(topicOfEventBody('OffRamp', rootedCommit({ extraBit: true })), undefined)
      assert.equal(topicOfEventBody('OffRamp', rootedCommit({ onRampLength: 0 })), undefined)
      // length 33: build by hand, since the buffer is 33 bytes
      assert.equal(topicOfEventBody('OffRamp', rootedCommit({ onRampLength: 33 })), undefined)
      const noRef = beginCell().storeBit(0).storeBit(1).endCell()
      assert.equal(topicOfEventBody('OffRamp', noRef), undefined)
    })

    it('rejects an empty cell and an OnRamp body', () => {
      assert.equal(topicOfEventBody('OffRamp', beginCell().endCell()), undefined)
      assert.equal(topicOfEventBody('OffRamp', onRampBody()), undefined)
    })
  })

  describe('OnRamp', () => {
    it('names CCIPMessageSent', () => {
      const body = onRampBody()
      assert.equal(body.bits.length, 875)
      assert.equal(body.refs.length, 1)
      assert.equal(topicOfEventBody('OnRamp', body), crc32('CCIPMessageSent'))
    })
    it('rejects a body without the ref or with an extra bit', () => {
      assert.equal(topicOfEventBody('OnRamp', onRampBody(false)), undefined)
      assert.equal(topicOfEventBody('OnRamp', onRampBody(true, true)), undefined)
    })
    it('rejects an ExecutionStateChanged body', () => {
      assert.equal(topicOfEventBody('OnRamp', executionBody(1)), undefined)
    })
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
  const b64 = (cell: Cell) => cell.toBoc().toString('base64')

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
      {
        source: rawUpper,
        destination: null,
        created_lt: '110048859000031',
        message_content: { body: b64(ocr3) },
      },
      {
        source: rawUpper,
        destination: null,
        created_lt: '110048859000029',
        message_content: { body: b64(execution) },
      },
      {
        source: rawLower,
        destination: null,
        created_lt: '110048859000032',
        message_content: { body: b64(unknown) },
      },
      {
        source: rawLower,
        destination: rawUpper,
        created_lt: '110048859000033',
        message_content: { body: b64(execution) },
      },
      {
        source: other,
        destination: null,
        created_lt: '110048859000034',
        message_content: { body: b64(execution) },
      },
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

  it('rebuilds the transaction with only the identified logs', async () => {
    const { ctx, urls } = makeCtx(new Response(JSON.stringify({ transactions: [tx] })))
    const res = await fetchIndexedTransaction(ctx, SENDER, txHashHex, 'OffRamp')
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

    assert.equal(res.logs.length, 2)
    const [exec, transmitted] = res.logs
    assert.deepEqual(exec!.topics, [TOPIC_EXECUTION_STATE_CHANGED])
    assert.deepEqual(transmitted!.topics, [crc32('OCR3Base_Transmitted')])
    assert.equal(exec!.index, 110048859000029)
    assert.equal(transmitted!.index, 110048859000031)
    assert.equal(exec!.data, Cell.fromBase64(b64(execution)).toBoc().toString('base64'))
    assert.equal(transmitted!.data, Cell.fromBase64(b64(ocr3)).toBoc().toString('base64'))
    for (const log of res.logs) {
      assert.equal(log.transactionHash, hash)
      assert.equal(log.blockNumber, tx.mc_block_seqno)
      assert.equal(log.blockTimestamp, tx.now)
      assert.equal(log.address, rawLower)
      assert.equal(log.tx, res)
    }
  })

  it('returns undefined when the index has no such transaction', async () => {
    const { ctx } = makeCtx(new Response(JSON.stringify({ transactions: [] })))
    assert.equal(await fetchIndexedTransaction(ctx, SENDER, txHashHex, 'OffRamp'), undefined)
  })

  it('rejects with CCIPHttpError on a non-transient failure', async () => {
    const { ctx, urls } = makeCtx(new Response('boom', { status: 400 }))
    await assert.rejects(fetchIndexedTransaction(ctx, SENDER, txHashHex, 'OffRamp'), (err) => {
      assert.ok(err instanceof CCIPHttpError)
      assert.match(err.message, /boom/)
      return true
    })
    assert.equal(urls.length, 1)
  })
})
