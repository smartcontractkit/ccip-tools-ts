import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import { validatePublicKey } from './validate.ts'
import { CCIPCctParamsInvalidError } from '../../errors/index.ts'

describe('cct/solana validate', () => {
  it('accepts valid public keys', () => {
    assert.doesNotThrow(() => validatePublicKey('op', 'payer', PublicKey.default.toBase58()))
  })

  it('rejects non-string public keys', () => {
    assert.throws(
      () => validatePublicKey('op', 'payer', 123),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'payer',
    )
  })

  it('rejects invalid public key strings', () => {
    assert.throws(
      () => validatePublicKey('op', 'payer', 'nope'),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'payer',
    )
  })
})
