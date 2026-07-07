import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatCantonDecimalAmountUnits, parseCantonDecimalAmountUnits } from './amount.ts'

describe('canton/amount', () => {
  it('parseCantonDecimalAmountUnits handles whole and fractional amounts', () => {
    assert.equal(parseCantonDecimalAmountUnits('1.0'), 10_000_000_000n)
    assert.equal(parseCantonDecimalAmountUnits('0.001'), 10_000_000n)
    assert.equal(parseCantonDecimalAmountUnits('1.'), 10_000_000_000n)
  })

  it('parseCantonDecimalAmountUnits rejects invalid input', () => {
    assert.equal(parseCantonDecimalAmountUnits(''), 0n)
    assert.equal(parseCantonDecimalAmountUnits('abc'), 0n)
    assert.equal(parseCantonDecimalAmountUnits('1.12345678901'), 0n)
  })

  it('formatCantonDecimalAmountUnits round-trips with parse', () => {
    for (const value of ['0', '0.001', '1.0', '0.999', '3.1415926535']) {
      assert.equal(
        parseCantonDecimalAmountUnits(
          formatCantonDecimalAmountUnits(parseCantonDecimalAmountUnits(value)),
        ),
        parseCantonDecimalAmountUnits(value),
      )
    }
  })
})
