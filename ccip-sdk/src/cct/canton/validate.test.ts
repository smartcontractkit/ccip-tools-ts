import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCTParamsInvalidError } from '../errors.ts'
import { parseInstrumentId } from './validate.ts'

const ADMIN = `hint::1220${'ab'.repeat(32)}`

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
