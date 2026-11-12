import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Transaction, type TupleItem, Address, Cell, TupleReader, beginCell } from '@ton/core'
import type { TonClient } from '@ton/ton'

import { fetchDeployerCode, locateExecutionTxs, merkleRootAddress } from './merkle-root.ts'

// Real vector captured from ton-testnet (OffRamp 1.6.2).
const OFFRAMP_REAL = Address.parseRaw(
  '0:CFB90D27C9D457C903D616BFDDE30FADCDF40C5F0A2F91ED136883CB94205D80',
)
const DEPLOYER_BOC_B64 =
  'te6cckEBCAEAsgABFP8A9KQT9LzyyAsBAgFiAgMApND4kfJA7UTQ+kgwgSPw+JJYxwXy9NcsJdIzIjyY1NdMAfsE7VTg1ywlh2KKvI4g1NT6ANdMA/sEAe1U+CjIz4UI+lIB+gJxzwtqzMlx+wDg8j8CAUgEBwIBIAUGAFO2K/Gg62NLc1lzG0MLS3Fzo3txc2NLEXIjK4Nje8sLE2MsEWpiXGBcYRAAGbXFECR+FAQQgfd+UJAACbhoWAXIbbZN/w=='
const DEPLOYER_HASH_HEX = '61ef207c8cb9d963f1cca85894f3c279edcba27490c192f0be6c3be3f6a520fc'
const MERKLE_ROOT = '0x4c62aad64c23ed22025e0909f0075cf15ea9ebcccef0903407e5f95077b55807'
const MERKLE_ROOT_ADDR = '0:9ece644849aec41fbf23be5c7cb57f4af2650c344525f1ca66d8160e33ced789'

const OP_DEPLOYABLE_INITIALIZE = 0xba466447
const OP_VALIDATE = 0x038ede91
const OP_MARK_STATE = 0x019f4cd2
const OP_EXECUTE_VALIDATED = 0xc73d5a8a

const OFFRAMP = Address.parseRaw('0:' + 'aa'.repeat(32))
const MERKLE = Address.parseRaw('0:' + 'bb'.repeat(32))
const OTHER = Address.parseRaw('0:' + 'cc'.repeat(32))

const deployerCode = () => Cell.fromBase64(DEPLOYER_BOC_B64)
const intItems = (...values: bigint[]): TupleItem[] =>
  values.map((value) => ({ type: 'int', value }))

// --- fetchDeployerCode stub ---

function codeProvider(opts: { hashes: bigint[]; data: Buffer | null }) {
  const runMethodCalls: { address: Address; name: string }[] = []
  const provider = {
    runMethod: (address: Address, name: string) => {
      runMethodCalls.push({ address, name })
      return Promise.resolve({ stack: new TupleReader(intItems(...opts.hashes)) })
    },
    getContractState: () => Promise.resolve({ data: opts.data }),
  } as unknown as TonClient
  return { provider, runMethodCalls }
}

const bocOf = (cell: Cell) => cell.toBoc()
const leaf = (n: number) => beginCell().storeUint(n, 32).endCell()

// --- locateExecutionTxs stubs ---

type FakeMsg = { info: Record<string, unknown>; body: Cell }
const emptyBody = () => beginCell().endCell()
const opBody = (op: number) => beginCell().storeUint(op, 32).endCell()

function inMsg(src: Address, body: Cell, createdLt = 1n): FakeMsg {
  return { info: { type: 'internal', src, dest: MERKLE, createdLt }, body }
}
function outMsg(dest: Address, body: Cell, createdLt: bigint): FakeMsg {
  return { info: { type: 'internal', src: MERKLE, dest, createdLt }, body }
}
function mkTx(o: {
  lt: bigint
  prev?: bigint
  inMessage?: FakeMsg
  outs?: FakeMsg[]
}): Transaction {
  return {
    lt: o.lt,
    prevTransactionLt: o.prev ?? 1n,
    inMessage: o.inMessage,
    outMessages: new Map((o.outs ?? []).map((m, i) => [i, m])),
  } as unknown as Transaction
}
const fakeOffRampTx = (lt: bigint) => ({ lt }) as unknown as Transaction

const deployTx = () =>
  mkTx({ lt: 10n, prev: 0n, inMessage: inMsg(OFFRAMP, opBody(OP_DEPLOYABLE_INITIALIZE), 5n) })

type LocateCall = { from: Address; to: Address; lt: string }

function merkleProvider(
  txsOldestFirst: Transaction[],
  opts: {
    result?: Record<string, Transaction>
    source?: Record<string, Transaction>
    rejectResult?: boolean
    rejectSource?: boolean
  } = {},
) {
  const getTransactionsCalls: { address: Address; opts: unknown }[] = []
  const resultCalls: LocateCall[] = []
  const sourceCalls: LocateCall[] = []
  const provider = {
    getTransactions: (address: Address, o: unknown) => {
      getTransactionsCalls.push({ address, opts: o })
      return Promise.resolve([...txsOldestFirst].reverse())
    },
    tryLocateResultTx: (from: Address, to: Address, lt: string) => {
      resultCalls.push({ from, to, lt })
      if (opts.rejectResult) return Promise.reject(new Error('result locate failed'))
      const tx = opts.result?.[lt]
      return tx ? Promise.resolve(tx) : Promise.reject(new Error(`no result tx for ${lt}`))
    },
    tryLocateSourceTx: (from: Address, to: Address, lt: string) => {
      sourceCalls.push({ from, to, lt })
      if (opts.rejectSource) return Promise.reject(new Error('source locate failed'))
      const tx = opts.source?.[lt]
      return tx ? Promise.resolve(tx) : Promise.reject(new Error(`no source tx for ${lt}`))
    },
  } as unknown as TonClient
  return { provider, getTransactionsCalls, resultCalls, sourceCalls }
}

const validateTx = (lt: bigint, outLt: bigint) =>
  mkTx({
    lt,
    inMessage: inMsg(OFFRAMP, opBody(OP_VALIDATE), lt - 1n),
    outs: [outMsg(OFFRAMP, opBody(OP_EXECUTE_VALIDATED), outLt)],
  })
const markStateTx = (lt: bigint, inLt: bigint) =>
  mkTx({
    lt,
    inMessage: inMsg(OFFRAMP, opBody(OP_MARK_STATE), inLt),
    outs: [outMsg(OFFRAMP, emptyBody(), lt + 1n)],
  })

describe('merkleRootAddress', () => {
  it('derives the real MerkleRoot address from the real vector', () => {
    const addr = merkleRootAddress(OFFRAMP_REAL, MERKLE_ROOT, deployerCode())
    assert.equal(addr.toRawString().toLowerCase(), MERKLE_ROOT_ADDR)
  })

  it('gives a different address for a different root', () => {
    const base = merkleRootAddress(OFFRAMP_REAL, MERKLE_ROOT, deployerCode())
    const other = merkleRootAddress(OFFRAMP_REAL, '0x' + '11'.repeat(32), deployerCode())
    assert.notEqual(other.toRawString(), base.toRawString())
  })

  it('gives a different address for a different OffRamp', () => {
    const base = merkleRootAddress(OFFRAMP_REAL, MERKLE_ROOT, deployerCode())
    const other = merkleRootAddress(OFFRAMP, MERKLE_ROOT, deployerCode())
    assert.notEqual(other.toRawString(), base.toRawString())
  })
})

describe('fetchDeployerCode', () => {
  it('sanity: the vector code cell has the documented hash', () => {
    assert.equal(deployerCode().hash().toString('hex'), DEPLOYER_HASH_HEX)
  })

  it('finds the deployer cell two refs deep in storage', async () => {
    const target = deployerCode()
    const nested = beginCell().storeUint(7, 8).storeRef(leaf(1)).storeRef(target).endCell()
    const mid = beginCell().storeUint(8, 8).storeRef(leaf(2)).storeRef(nested).endCell()
    const root = beginCell()
      .storeUint(9, 8)
      .storeRef(leaf(3))
      .storeRef(mid)
      .storeRef(leaf(4))
      .endCell()
    const { provider, runMethodCalls } = codeProvider({
      hashes: [111n, 222n, BigInt('0x' + DEPLOYER_HASH_HEX)],
      data: bocOf(root),
    })

    const found = await fetchDeployerCode({ provider }, OFFRAMP_REAL)

    assert.ok(found)
    assert.equal(found.hash().toString('hex'), DEPLOYER_HASH_HEX)
    assert.equal(runMethodCalls.length, 1)
    assert.equal(runMethodCalls[0]!.name, 'deployableHashes')
    assert.ok(runMethodCalls[0]!.address.equals(OFFRAMP_REAL))
  })

  it('matches a hash with leading zero bytes (pads to 64 hex digits)', async () => {
    let target: Cell | undefined
    for (let i = 0; i < 5000 && !target; i++) {
      const c = leaf(i)
      if (c.hash().toString('hex').startsWith('0')) target = c
    }
    assert.ok(target, 'no candidate cell with a leading-zero hash found')
    const hashBig = BigInt('0x' + target.hash().toString('hex'))
    assert.ok(hashBig.toString(16).length < 64)
    const root = beginCell().storeRef(leaf(9001)).storeRef(target).endCell()
    const { provider } = codeProvider({ hashes: [1n, 2n, hashBig], data: bocOf(root) })

    const found = await fetchDeployerCode({ provider }, OFFRAMP)

    assert.ok(found)
    assert.equal(found.hash().toString('hex'), target.hash().toString('hex'))
  })

  it('returns undefined when the storage does not contain the cell', async () => {
    const root = beginCell().storeRef(leaf(1)).storeRef(leaf(2)).endCell()
    const { provider } = codeProvider({
      hashes: [1n, 2n, BigInt('0x' + DEPLOYER_HASH_HEX)],
      data: bocOf(root),
    })
    assert.equal(await fetchDeployerCode({ provider }, OFFRAMP), undefined)
  })

  it('returns undefined when the contract data is null', async () => {
    const { provider } = codeProvider({
      hashes: [1n, 2n, BigInt('0x' + DEPLOYER_HASH_HEX)],
      data: null,
    })
    assert.equal(await fetchDeployerCode({ provider }, OFFRAMP), undefined)
  })

  it('terminates on a heavily shared DAG and still finds the target', async () => {
    const target = deployerCode()
    let node = beginCell().storeUint(0, 8).storeRef(target).endCell()
    // 4 refs per level to the same child: 4^40 paths without the visited set.
    for (let level = 1; level <= 40; level++) {
      node = beginCell()
        .storeUint(level, 8)
        .storeRef(node)
        .storeRef(node)
        .storeRef(node)
        .storeRef(node)
        .endCell()
    }
    const { provider } = codeProvider({
      hashes: [1n, 2n, BigInt('0x' + DEPLOYER_HASH_HEX)],
      data: bocOf(node),
    })

    const found = await fetchDeployerCode({ provider }, OFFRAMP)

    assert.ok(found)
    assert.equal(found.hash().toString('hex'), DEPLOYER_HASH_HEX)
  })

  it('terminates on a shared DAG that does not contain the target', async () => {
    let node = leaf(0)
    for (let level = 1; level <= 40; level++) {
      node = beginCell()
        .storeUint(level, 8)
        .storeRef(node)
        .storeRef(node)
        .storeRef(node)
        .storeRef(node)
        .endCell()
    }
    const { provider } = codeProvider({
      hashes: [1n, 2n, BigInt('0x' + DEPLOYER_HASH_HEX)],
      data: bocOf(node),
    })
    assert.equal(await fetchDeployerCode({ provider }, OFFRAMP), undefined)
  })
})

describe('locateExecutionTxs', () => {
  it('locates the OffRamp txs adjacent to one execution attempt, oldest first', async () => {
    const X = 111n
    const Y = 222n
    const txs = [deployTx(), validateTx(20n, X), markStateTx(30n, Y)]
    const { provider, getTransactionsCalls, resultCalls, sourceCalls } = merkleProvider(txs, {
      result: { [String(X)]: fakeOffRampTx(500n) },
      source: { [String(Y)]: fakeOffRampTx(900n) },
    })

    const res = await locateExecutionTxs({ provider }, OFFRAMP, MERKLE)

    assert.ok(res)
    assert.deepEqual(
      res.map((t) => t.lt),
      [500n, 900n],
    )
    assert.equal(resultCalls.length, 1)
    assert.ok(resultCalls[0]!.from.equals(MERKLE))
    assert.ok(resultCalls[0]!.to.equals(OFFRAMP))
    assert.equal(resultCalls[0]!.lt, String(X))
    assert.equal(sourceCalls.length, 1)
    assert.ok(sourceCalls[0]!.from.equals(OFFRAMP))
    assert.ok(sourceCalls[0]!.to.equals(MERKLE))
    assert.equal(sourceCalls[0]!.lt, String(Y))
    assert.equal(getTransactionsCalls.length, 1)
    assert.ok(getTransactionsCalls[0]!.address.equals(MERKLE))
    assert.deepEqual(getTransactionsCalls[0]!.opts, { limit: 100 })
  })

  it('deduplicates hops that resolve to the same OffRamp tx', async () => {
    const txs = [deployTx(), validateTx(20n, 111n), validateTx(30n, 222n)]
    const { provider } = merkleProvider(txs, {
      result: { '111': fakeOffRampTx(500n), '222': fakeOffRampTx(500n) },
    })

    const res = await locateExecutionTxs({ provider }, OFFRAMP, MERKLE)

    assert.ok(res)
    assert.equal(res.length, 1)
    assert.equal(res[0]!.lt, 500n)
  })

  it('sorts results by lt even when located out of order', async () => {
    const txs = [deployTx(), validateTx(20n, 111n), validateTx(30n, 222n), validateTx(40n, 333n)]
    const { provider } = merkleProvider(txs, {
      result: {
        '111': fakeOffRampTx(900n),
        '222': fakeOffRampTx(500n),
        '333': fakeOffRampTx(700n),
      },
    })

    const res = await locateExecutionTxs({ provider }, OFFRAMP, MERKLE)

    assert.ok(res)
    assert.deepEqual(
      res.map((t) => t.lt),
      [500n, 700n, 900n],
    )
  })

  it('returns [] for a committed root with no execution, without locating', async () => {
    const { provider, resultCalls, sourceCalls } = merkleProvider([deployTx()])
    const res = await locateExecutionTxs({ provider }, OFFRAMP, MERKLE)
    assert.deepEqual(res, [])
    assert.equal(resultCalls.length + sourceCalls.length, 0)
  })

  describe('returns undefined when the tx list is not provably whole', () => {
    const cases: [string, () => Transaction[]][] = [
      ['empty tx list', () => []],
      [
        'exactly 100 txs',
        () => [
          deployTx(),
          ...Array.from({ length: 99 }, (_, i) => validateTx(20n + BigInt(i), 1000n + BigInt(i))),
        ],
      ],
      [
        'oldest tx has a predecessor',
        () => [
          mkTx({ lt: 10n, prev: 3n, inMessage: inMsg(OFFRAMP, opBody(OP_DEPLOYABLE_INITIALIZE)) }),
          validateTx(20n, 111n),
        ],
      ],
      [
        'oldest tx comes from another sender',
        () => [
          mkTx({ lt: 10n, prev: 0n, inMessage: inMsg(OTHER, opBody(OP_DEPLOYABLE_INITIALIZE)) }),
        ],
      ],
      ['oldest tx has no inMessage', () => [mkTx({ lt: 10n, prev: 0n })]],
      [
        // e.g. an account deleted, then re-created by a later MarkState
        'oldest tx is not the deployment message',
        () => [mkTx({ lt: 10n, prev: 0n, inMessage: inMsg(OFFRAMP, opBody(OP_MARK_STATE)) })],
      ],
    ]
    for (const [name, build] of cases) {
      it(name, async () => {
        const { provider, resultCalls, sourceCalls } = merkleProvider(build(), {
          result: { '111': fakeOffRampTx(500n) },
        })
        assert.equal(await locateExecutionTxs({ provider }, OFFRAMP, MERKLE), undefined)
        assert.equal(resultCalls.length + sourceCalls.length, 0)
      })
    }
  })

  it('returns undefined (does not throw) when tryLocateSourceTx rejects', async () => {
    const { provider } = merkleProvider([deployTx(), markStateTx(30n, 222n)], {
      rejectSource: true,
    })
    assert.equal(await locateExecutionTxs({ provider }, OFFRAMP, MERKLE), undefined)
  })

  it('returns undefined (does not throw) when tryLocateResultTx rejects', async () => {
    const { provider } = merkleProvider([deployTx(), validateTx(20n, 111n)], {
      rejectResult: true,
    })
    assert.equal(await locateExecutionTxs({ provider }, OFFRAMP, MERKLE), undefined)
  })

  it('ignores a MarkState in-message that does not come from the OffRamp', async () => {
    const tx = mkTx({ lt: 30n, inMessage: inMsg(OTHER, opBody(OP_MARK_STATE), 222n) })
    const { provider, resultCalls, sourceCalls } = merkleProvider([deployTx(), tx])
    const res = await locateExecutionTxs({ provider }, OFFRAMP, MERKLE)
    assert.deepEqual(res, [])
    assert.equal(resultCalls.length + sourceCalls.length, 0)
  })

  it('ignores an out message with a body whose destination is not the OffRamp', async () => {
    const tx = mkTx({
      lt: 20n,
      inMessage: inMsg(OFFRAMP, opBody(OP_VALIDATE), 19n),
      outs: [outMsg(OTHER, opBody(OP_EXECUTE_VALIDATED), 111n)],
    })
    const { provider, resultCalls, sourceCalls } = merkleProvider([deployTx(), tx])
    const res = await locateExecutionTxs({ provider }, OFFRAMP, MERKLE)
    assert.deepEqual(res, [])
    assert.equal(resultCalls.length + sourceCalls.length, 0)
  })
})
