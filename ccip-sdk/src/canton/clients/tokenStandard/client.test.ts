import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPError, CCIPErrorCode } from '../../../errors/index.ts'
import { CantonInstrumentId, parsePartyId } from '../../addressCodec.ts'
import { TokenStandardClientProvider } from './client.ts'

const CCIP_PARTY = parsePartyId(
  'dummyAdmin::1220deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)
const REGISTRAR_PARTY = parsePartyId(
  'dummyRegistrar::1220deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
)

describe('TokenStandardClientProvider.urlFor', () => {
  it('uses the exact entry for a known admin', () => {
    const provider = new TokenStandardClientProvider({
      urlsByAdmin: { [CCIP_PARTY]: 'https://eds.example', '*': 'https://fallback.example' },
    })
    assert.equal(provider.urlFor(CCIP_PARTY), 'https://eds.example')
  })

  it('substitutes {party} in the template wildcard for a CantonInstrumentId admin', () => {
    const provider = new TokenStandardClientProvider({
      urlsByAdmin: {
        [CCIP_PARTY]: 'https://eds.example',
        '{party}': `https://api.utilities.digitalasset.com/api/token-standard/v0/registrars/${'{party}'}`,
        '*': 'https://fallback.example',
      },
    })
    const instrumentId = CantonInstrumentId.fromString(`mytoken@${REGISTRAR_PARTY}`)
    assert.equal(
      provider.urlFor(instrumentId),
      `https://api.utilities.digitalasset.com/api/token-standard/v0/registrars/${REGISTRAR_PARTY}`,
    )
  })

  it('prefers the template wildcard over the plain wildcard', () => {
    const provider = new TokenStandardClientProvider({
      urlsByAdmin: {
        '{party}': `https://ts.example/${'{party}'}`,
        '*': 'https://fallback.example',
      },
    })
    assert.equal(provider.urlFor(REGISTRAR_PARTY), `https://ts.example/${REGISTRAR_PARTY}`)
  })

  it('uses the plain wildcard when no template wildcard is configured', () => {
    const provider = new TokenStandardClientProvider({
      urlsByAdmin: { '*': 'https://fallback.example' },
    })
    assert.equal(provider.urlFor(REGISTRAR_PARTY), 'https://fallback.example')
  })

  it('throws when no URL is configured', () => {
    const provider = new TokenStandardClientProvider({ urlsByAdmin: {} })
    assert.throws(
      () => provider.urlFor(REGISTRAR_PARTY),
      (error: unknown) => {
        assert.ok(error instanceof CCIPError)
        assert.equal(error.code, CCIPErrorCode.TOKEN_NOT_CONFIGURED)
        return true
      },
    )
  })
})
