import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCTParamsInvalidError } from '../errors.ts'
import { instanceAddressOwner, parseInstrumentId, parseRawInstanceAddress } from './validate.ts'

const ADMIN = `hint::1220${'ab'.repeat(32)}`

describe('parseRawInstanceAddress', () => {
  it('splits "instanceId@owner"', () => {
    assert.deepEqual(parseRawInstanceAddress('op', 'addr', `pool-1@${ADMIN}`), {
      instanceId: 'pool-1',
      owner: ADMIN,
    })
  })

  for (const [label, value] of [
    ['empty', ''],
    ['hashed (no "@")', '0x' + 'ab'.repeat(32)],
    ['empty instance ID', `@${ADMIN}`],
    ['two "@"', `a@b@${ADMIN}`],
    ['owner not a party ID', 'pool-1@owner'],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.throws(
        () => parseRawInstanceAddress('op', 'addr', value),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'addr',
      )
    })
  }
})

describe('instanceAddressOwner', () => {
  it('returns the owner of a raw address', () => {
    assert.equal(instanceAddressOwner('op', 'addr', `pool-1@${ADMIN}`), ADMIN)
  })

  it('returns undefined for a hashed address', () => {
    assert.equal(instanceAddressOwner('op', 'addr', '0x' + 'ab'.repeat(32)), undefined)
  })

  it('rejects a malformed raw address', () => {
    assert.throws(() => instanceAddressOwner('op', 'addr', 'pool-1@owner'), CCTParamsInvalidError)
  })
})

describe('parseInstrumentId', () => {
  it('parses the 3-part string form', () => {
    assert.deepEqual(parseInstrumentId('op', 'instrumentId', `${ADMIN}::TESTTOKEN`), {
      admin: ADMIN,
      id: 'TESTTOKEN',
    })
  })

  it('rejects a token id containing "::" (matches parseCantonInstrumentId)', () => {
    assert.throws(
      () => parseInstrumentId('op', 'instrumentId', `${ADMIN}::TEST::TOKEN`),
      CCTParamsInvalidError,
    )
  })

  it('passes through the structured { admin, id } form unchanged', () => {
    assert.deepEqual(parseInstrumentId('op', 'instrumentId', { admin: ADMIN, id: 'TESTTOKEN' }), {
      admin: ADMIN,
      id: 'TESTTOKEN',
    })
  })
})
