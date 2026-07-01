import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { validateAddress } from './validate.ts'
import { CCIPCctParamsInvalidError } from '../../errors/index.ts'

const ADDR = '0x' + '11'.repeat(20)

describe('validateAddress', () => {
  it('accepts a valid address', () => {
    assert.doesNotThrow(() => validateAddress('setPool', 'tokenAddress', ADDR))
  })

  it('rejects a malformed address, tagged with operation + param', () => {
    assert.throws(
      () => validateAddress('setPool', 'tokenAddress', 'not-an-address'),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'setPool' &&
        err.context.param === 'tokenAddress',
    )
  })

  it('rejects a non-string value', () => {
    assert.throws(
      () => validateAddress('setPool', 'poolAddress', 123),
      (err: unknown) => err instanceof CCIPCctParamsInvalidError,
    )
  })
})
