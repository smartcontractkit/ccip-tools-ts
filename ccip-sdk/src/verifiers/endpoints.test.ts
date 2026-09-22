import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  endpointsFor,
  parseCcvData,
  parseVerifierEndpoints,
  parseVerifierEntry,
} from './endpoints.ts'

const CCV = '0x345AEDB0988Ff1e897c26f9ad3AE84603Ed517E2'
const OTHER = '0xD5C448Fc5B81EFd3108656Ce5FF9bacF2b582bdB'

describe('parseVerifierEntry', () => {
  it('should parse an address-mapped plaintext aggregator', () => {
    const { ccvAddress, endpoint } = parseVerifierEntry(`${CCV}=grpc+plaintext://localhost:15051`)
    assert.equal(ccvAddress, CCV)
    assert.equal(endpoint.type, 'aggregator')
    assert.equal(endpoint.target, 'localhost:15051')
    assert.equal(endpoint.tls, false)
  })

  it('should select TLS from the scheme, never from the port', () => {
    // The same port must be able to mean either transport; sniffing :443 would be a guess.
    assert.equal(parseVerifierEntry(`${CCV}=grpc://host:443`).endpoint.tls, true)
    assert.equal(parseVerifierEntry(`${CCV}=grpc+plaintext://host:443`).endpoint.tls, false)
    assert.equal(parseVerifierEntry(`${CCV}=grpc://host:8443`).endpoint.tls, true)
  })

  it('should accept a bare endpoint as the fallback for every CCV', () => {
    const { ccvAddress, endpoint } = parseVerifierEntry('grpc+plaintext://localhost:15051')
    assert.equal(ccvAddress, null)
    assert.equal(endpoint.target, 'localhost:15051')
  })

  it('should reject a bare host:port, which cannot express TLS', () => {
    assert.throws(() => parseVerifierEntry(`${CCV}=localhost:15051`), /missing a scheme/)
  })

  it('should reject an unsupported scheme', () => {
    assert.throws(() => parseVerifierEntry(`${CCV}=https://host/v1`), /unsupported scheme/)
  })

  it('should reject an invalid CCV address', () => {
    assert.throws(() => parseVerifierEntry('0xNOTANADDRESS=grpc://host:443'), /invalid CCV address/)
  })
})

describe('parseVerifierEndpoints', () => {
  it('should accumulate a repeated address into an ORDERED failover list', () => {
    // Order is the failover order: primary first, backup second. Never last-wins.
    const map = parseVerifierEndpoints([`${CCV}=grpc://primary:443`, `${CCV}=grpc://backup:443`])
    const eps = endpointsFor(map, CCV)
    assert.equal(eps.length, 2)
    assert.equal(eps[0]!.target, 'primary:443')
    assert.equal(eps[1]!.target, 'backup:443')
  })

  it('should match the CCV address case-insensitively', () => {
    const map = parseVerifierEndpoints([`${CCV.toLowerCase()}=grpc://host:443`])
    assert.equal(endpointsFor(map, CCV.toUpperCase().replace('0X', '0x')).length, 1)
  })

  it('should keep per-CCV lists separate and fall back only when unmapped', () => {
    const map = parseVerifierEndpoints([`${CCV}=grpc://for-ccv:443`, 'grpc://fallback:443'])
    assert.equal(endpointsFor(map, CCV)[0]!.target, 'for-ccv:443')
    assert.equal(endpointsFor(map, OTHER)[0]!.target, 'fallback:443')
  })

  it('should return no endpoints when nothing matches and no fallback was given', () => {
    const map = parseVerifierEndpoints([`${CCV}=grpc://host:443`])
    assert.equal(endpointsFor(map, OTHER).length, 0)
  })
})

describe('comma-separated entries', () => {
  it('should split a comma form identically to repeated flags', () => {
    const commas = parseVerifierEndpoints([`${CCV}=grpc://a:443,${CCV}=grpc://b:443`])
    const repeated = parseVerifierEndpoints([`${CCV}=grpc://a:443`, `${CCV}=grpc://b:443`])
    assert.deepEqual(
      endpointsFor(commas, CCV).map((e) => e.target),
      endpointsFor(repeated, CCV).map((e) => e.target),
    )
    assert.equal(endpointsFor(commas, CCV).length, 2)
  })

  it('should not let a comma end up inside a host', () => {
    const map = parseVerifierEndpoints([`${CCV}=grpc://a:443,${OTHER}=grpc://b:443`])
    assert.equal(endpointsFor(map, CCV)[0]!.target, 'a:443')
    assert.equal(endpointsFor(map, OTHER)[0]!.target, 'b:443')
  })
})

describe('parseCcvData', () => {
  it('should parse an address=hex pair', () => {
    const [e] = parseCcvData([`${CCV}=0xdeadbeef`])
    assert.equal(e!.ccvAddress, CCV)
    assert.equal(e!.ccvData, '0xdeadbeef')
  })

  it('should accept repeated and comma-separated entries', () => {
    const out = parseCcvData([`${CCV}=0xaabb,${OTHER}=0xccdd`])
    assert.equal(out.length, 2)
    assert.equal(out[1]!.ccvAddress, OTHER)
  })

  it('should require the CCV address, since bytes alone cannot say which CCV they are for', () => {
    assert.throws(() => parseCcvData(['0xdeadbeef']), /must be <ccv-address>=<0x-hex>/)
  })

  it('should reject a bad address or malformed hex', () => {
    assert.throws(() => parseCcvData(['0xNOPE=0xaabb']), /invalid CCV address/)
    assert.throws(() => parseCcvData([`${CCV}=0xabc`]), /even digit count/)
    assert.throws(() => parseCcvData([`${CCV}=0x`]), /non-empty/)
    assert.throws(() => parseCcvData([`${CCV}=nothex`]), /0x-prefixed hex/)
  })
})
