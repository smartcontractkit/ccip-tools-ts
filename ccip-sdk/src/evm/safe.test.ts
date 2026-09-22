import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPArgumentInvalidError } from '../errors/index.ts'
import { ChainFamily } from '../networks.ts'
import { buildSafeBatch } from './safe.ts'
import type { UnsignedEVMTx } from './types.ts'

const SAFE = '0x4EB2EEb3D444827D62ed8246345117cA3cAE3651'
const TARGET = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed'
const OTHER = '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93'

/** An op's output: one or more legs, in the shape every `generateUnsigned*` returns. */
function unsigned(...transactions: UnsignedEVMTx['transactions']): UnsignedEVMTx {
  return { family: ChainFamily.EVM, transactions }
}

const OPTS = { chainId: 84532n, safeAddress: SAFE, name: 'Deploy pool and accept ownership' }

describe('buildSafeBatch', () => {
  it('flattens the legs of every op, preserving order', () => {
    const batch = buildSafeBatch(
      [
        unsigned({ to: TARGET, data: '0xaa' }, { to: OTHER, data: '0xbb' }),
        unsigned({ to: SAFE, data: '0xcc' }),
      ],
      OPTS,
    )
    assert.deepEqual(
      batch.transactions.map((tx) => [tx.to, tx.data]),
      [
        [TARGET, '0xaa'],
        [OTHER, '0xbb'],
        [SAFE, '0xcc'],
      ],
    )
  })

  it('emits the fields the Transaction Builder requires on every entry', () => {
    const [tx] = buildSafeBatch([unsigned({ to: TARGET, data: '0xaa' })], OPTS).transactions
    assert.deepEqual(tx, {
      to: TARGET,
      value: '0',
      data: '0xaa',
      contractMethod: null,
      contractInputsValues: null,
    })
  })

  it('serialises chainId and value as decimal strings', () => {
    const batch = buildSafeBatch([unsigned({ to: TARGET, data: '0xaa', value: 10n ** 18n })], OPTS)
    assert.equal(batch.chainId, '84532')
    assert.equal(batch.transactions[0]!.value, '1000000000000000000')
  })

  it('converts a hex value to decimal, which is how the Transaction Builder reads it', () => {
    const batch = buildSafeBatch(
      [unsigned({ to: TARGET, data: '0xaa', value: '0x16345785d8a0000' })],
      OPTS,
    )
    assert.equal(batch.transactions[0]!.value, '100000000000000000')
  })

  it('accepts the other BigNumberish value forms', () => {
    const batch = buildSafeBatch(
      [
        unsigned({ to: TARGET, value: 1 }),
        unsigned({ to: TARGET, value: '2' }),
        unsigned({ to: TARGET, value: 3n }),
      ],
      OPTS,
    )
    assert.deepEqual(
      batch.transactions.map((tx) => tx.value),
      ['1', '2', '3'],
    )
  })

  it('rejects a fractional value rather than silently truncating it', () => {
    assert.throws(
      () => buildSafeBatch([unsigned({ to: TARGET, value: 1.5 })], OPTS),
      CCIPArgumentInvalidError,
    )
  })

  it('accepts a number chainId as well as a bigint', () => {
    const batch = buildSafeBatch([unsigned({ to: TARGET, data: '0xaa' })], {
      ...OPTS,
      chainId: 84532,
    })
    assert.equal(batch.chainId, '84532')
  })

  it('drops from and gasLimit, which the Safe supplies at execution', () => {
    const [tx] = buildSafeBatch(
      [unsigned({ to: TARGET, data: '0xaa', from: OTHER, gasLimit: 500_000n })],
      OPTS,
    ).transactions
    assert.equal('from' in tx!, false)
    assert.equal('gasLimit' in tx!, false)
  })

  it('records the Safe and the name in meta, so the import is self-describing', () => {
    const batch = buildSafeBatch([unsigned({ to: TARGET, data: '0xaa' })], {
      ...OPTS,
      description: 'salt "demo"',
    })
    assert.partialDeepStrictEqual(batch, {
      version: '1.0',
      meta: {
        name: 'Deploy pool and accept ownership',
        description: 'salt "demo"',
        createdFromSafeAddress: SAFE,
      },
    })
    assert.equal(typeof batch.createdAt, 'number')
  })

  it('omits description rather than emitting an empty one when not given', () => {
    const batch = buildSafeBatch([unsigned({ to: TARGET, data: '0xaa' })], OPTS)
    assert.equal('description' in batch.meta, false)
  })

  it('defaults data to 0x for a plain value transfer', () => {
    const batch = buildSafeBatch([unsigned({ to: TARGET, value: 1n })], OPTS)
    assert.equal(batch.transactions[0]!.data, '0x')
  })

  it('rejects a leg with no `to`, naming its index, rather than emitting undefined', () => {
    assert.throws(
      () =>
        buildSafeBatch([unsigned({ to: TARGET, data: '0xaa' }), unsigned({ data: '0xbb' })], OPTS),
      (err: unknown) => {
        assert.ok(err instanceof CCIPArgumentInvalidError)
        assert.match(err.message, /1/)
        return true
      },
    )
  })

  it('rejects an unresolved Addressable rather than stringifying it to [object Object]', () => {
    const addressable = { getAddress: () => Promise.resolve(TARGET) }
    assert.throws(
      () => buildSafeBatch([unsigned({ to: addressable, data: '0xaa' })], OPTS),
      (err: unknown) => {
        assert.ok(err instanceof CCIPArgumentInvalidError)
        assert.match(err.message, /getAddress/)
        return true
      },
    )
  })

  it('rejects an empty batch, which the Transaction Builder cannot import', () => {
    assert.throws(() => buildSafeBatch([], OPTS), CCIPArgumentInvalidError)
    assert.throws(() => buildSafeBatch([unsigned()], OPTS), CCIPArgumentInvalidError)
  })
})
