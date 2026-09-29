import { Buffer } from 'buffer'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Idl, BorshCoder } from '@coral-xyz/anchor'
import { type Connection, PublicKey } from '@solana/web3.js'

import { CCIPBorshMethodUnknownError, CCIPBorshTypeUnknownError } from '../errors/index.ts'
import { newProgram, sizedCoder } from './coder.ts'

const idl: Idl = {
  version: '0.1.0',
  name: 'sized',
  instructions: [{ name: 'storeBig', accounts: [], args: [{ name: 'data', type: 'bytes' }] }],
  types: [{ name: 'Big', type: { kind: 'struct', fields: [{ name: 'data', type: 'bytes' }] } }],
}
// larger than the 1000B buffer Anchor 0.29 encodes into
const big = { data: Buffer.alloc(5000, 7) }

describe('sizedCoder', () => {
  it('encodes types beyond the 1000B Anchor buffer', () => {
    const coder = sizedCoder(idl)
    const encoded = coder.types.encode('Big', big)
    assert.equal(encoded.length, 4 + big.data.length)
    assert.deepEqual(coder.types.decode('Big', encoded), big)
  })

  it('encodes instructions beyond the 1000B Anchor buffer', () => {
    const coder = sizedCoder(idl)
    const encoded = coder.instruction.encode('storeBig', big)
    assert.equal(encoded.length, 8 + 4 + big.data.length)
    assert.deepEqual(coder.instruction.decode(encoded), { name: 'storeBig', data: big })
  })

  it('throws CCIP errors for unknown types and methods', () => {
    const coder = sizedCoder(idl)
    assert.throws(() => coder.types.encode('Missing', {}), CCIPBorshTypeUnknownError)
    assert.throws(() => coder.instruction.encode('missing', {}), CCIPBorshMethodUnknownError)
  })

  it('is memoized per IDL, and used by newProgram', () => {
    assert.equal(sizedCoder(idl), sizedCoder(idl))
    const program = newProgram(idl, PublicKey.default, { connection: {} as Connection })
    assert.equal(program.coder, sizedCoder(idl))
  })

  it("leaves other coders (Anchor's prototypes) untouched", () => {
    sizedCoder(idl)
    const plain = new BorshCoder(idl)
    assert.equal(Object.hasOwn(plain.types, 'encode'), false)
    assert.throws(() => plain.types.encode('Big', big), RangeError)
  })
})
