import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPError, CCIPErrorCode } from '../../../errors/index.ts'
import { InstanceAddress, RawInstanceAddress, parsePartyId } from '../../addressCodec.ts'
import { EdsClientProvider } from './client.ts'

const PARTY = parsePartyId(
  'dummyOwner::1220deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)
const OTHER_PARTY = parsePartyId(
  'dummyOtherOwner::1220deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)
const HASHED = InstanceAddress.fromHex(`0x${'ab'.repeat(32)}`)

describe('EdsProvider.urlFor', () => {
  it('uses the exact entry for a known party', () => {
    const provider = new EdsClientProvider({
      edsUrlsByOwner: { [PARTY]: 'https://eds-a.example', '*': 'https://fallback.example' },
    })
    assert.equal(provider.urlFor(PARTY), 'https://eds-a.example')
  })

  it('uses the owner of a RawInstanceAddress', () => {
    const provider = new EdsClientProvider({
      edsUrlsByOwner: { [PARTY]: 'https://eds-a.example' },
    })
    const address = RawInstanceAddress.fromString(`pool@${PARTY}`)
    assert.equal(provider.urlFor(address), 'https://eds-a.example')
  })

  it('substitutes {party} in the template wildcard for a known party', () => {
    const provider = new EdsClientProvider({
      edsUrlsByOwner: {
        [PARTY]: 'https://eds-a.example',
        '{party}': `https://eds.example/${'{party}'}`,
        '*': 'https://fallback.example',
      },
    })
    assert.equal(
      provider.urlFor(RawInstanceAddress.fromString(`pool@${OTHER_PARTY}`)),
      `https://eds.example/${OTHER_PARTY}`,
    )
  })

  it('prefers the template wildcard over the plain wildcard for a known party', () => {
    const provider = new EdsClientProvider({
      edsUrlsByOwner: {
        '{party}': `https://eds.example/${'{party}'}`,
        '*': 'https://fallback.example',
      },
    })
    assert.equal(provider.urlFor(OTHER_PARTY), `https://eds.example/${OTHER_PARTY}`)
  })

  it('uses the plain wildcard as-is when the party is unknown', () => {
    const provider = new EdsClientProvider({
      edsUrlsByOwner: {
        '{party}': `https://eds.example/${'{party}'}`,
        '*': 'https://fallback.example',
      },
    })
    assert.equal(provider.urlFor(HASHED), 'https://fallback.example')
  })

  it('throws when the plain wildcard contains {party} and the party is unknown', () => {
    const provider = new EdsClientProvider({
      edsUrlsByOwner: { '*': `https://eds.example/${'{party}'}` },
    })
    assert.throws(
      () => provider.urlFor(HASHED),
      (error: unknown) => {
        assert.ok(error instanceof CCIPError)
        assert.equal(error.code, CCIPErrorCode.API_CLIENT_NOT_AVAILABLE)
        return true
      },
    )
  })

  it('throws when no URL is configured', () => {
    const provider = new EdsClientProvider({ edsUrlsByOwner: {} })
    assert.throws(
      () => provider.urlFor(PARTY),
      (error: unknown) => {
        assert.ok(error instanceof CCIPError)
        assert.equal(error.code, CCIPErrorCode.API_CLIENT_NOT_AVAILABLE)
        return true
      },
    )
  })
})
