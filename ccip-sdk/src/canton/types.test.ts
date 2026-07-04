import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseCantonInstrumentId } from './types.ts'
import { CCIPArgumentInvalidError } from '../errors/specialized.ts'

const LINK_INSTRUMENT =
  'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551::link-token'

describe('canton/types parseCantonInstrumentId', () => {
  it('splits party::fingerprint::tokenId into admin and id', () => {
    assert.deepEqual(parseCantonInstrumentId(LINK_INSTRUMENT), {
      admin: 'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551',
      id: 'link-token',
    })
  })

  it('rejects two-part instrument strings', () => {
    assert.throws(() => parseCantonInstrumentId('ccipOwner::link-token'), CCIPArgumentInvalidError)
  })
})
