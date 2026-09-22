import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import protobuf from 'protobufjs'

import { verifierProtoDescriptor } from './descriptor.ts'
import {
  VERIFIER_METHOD,
  decodeGetVerifierResultsResponse,
  encodeGetVerifierResultsRequest,
} from './schema.ts'

const root = protobuf.Root.fromJSON(verifierProtoDescriptor)
const RequestType = root.lookupType('chainlink_ccv.verifier.v1.GetVerifierResultsForMessageRequest')
const ResponseType = root.lookupType(
  'chainlink_ccv.verifier.v1.GetVerifierResultsForMessageResponse',
)

const MESSAGE_ID = '0x' + '11'.repeat(32)
const DEST = '0x345aedb0988ff1e897c26f9ad3ae84603ed517e2'
const SOURCE = '0xd5c448fc5b81efd3108656ce5ff9bacf2b582bdb'

function bytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '')
  const b = new Uint8Array(h.length / 2)
  for (let i = 0; i < b.length; i++) b[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return b
}

/** Build a wire response independently of the SDK encoder, to prove the decoder. */
function encodeResponse(results: readonly Record<string, unknown>[]): Uint8Array {
  return ResponseType.encode(ResponseType.create({ results })).finish()
}

describe('encodeGetVerifierResultsRequest', () => {
  it('encodes a request the descriptor decodes back to the message id', () => {
    const encoded = encodeGetVerifierResultsRequest(MESSAGE_ID)
    const decoded = RequestType.toObject(RequestType.decode(encoded), { bytes: Uint8Array }) as {
      message_ids: Uint8Array[]
    }
    assert.equal(decoded.message_ids.length, 1)
    assert.deepEqual(Array.from(decoded.message_ids[0] ?? []), Array.from(bytes(MESSAGE_ID)))
  })

  it('exposes the fully-qualified method path', () => {
    assert.equal(
      VERIFIER_METHOD,
      '/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage',
    )
  })
})

describe('decodeGetVerifierResultsResponse', () => {
  it('maps ccv_data and the metadata dest/source hints, ms→s timestamp', () => {
    const wire = encodeResponse([
      {
        ccv_data: bytes('0xdeadbeef'),
        metadata: {
          timestamp: 1_690_000_000_000,
          verifier_source_address: bytes(SOURCE),
          verifier_dest_address: bytes(DEST),
        },
      },
    ])
    const results = decodeGetVerifierResultsResponse(wire)
    assert.equal(results.length, 1)
    const r = results[0]
    assert.ok(r)
    assert.equal(r.ccvData, '0xdeadbeef')
    assert.equal(r.destAddress, DEST)
    assert.equal(r.sourceAddress, SOURCE)
    assert.equal(r.timestamp, 1_690_000_000)
  })

  it('falls back to message_ccv_addresses[0] for the dest address', () => {
    const wire = encodeResponse([
      { ccv_data: bytes('0xaabb'), message_ccv_addresses: [bytes(DEST)] },
    ])
    const r = decodeGetVerifierResultsResponse(wire)[0]
    assert.ok(r)
    assert.equal(r.destAddress, DEST)
    assert.equal(r.sourceAddress, DEST)
  })

  it('drops a result with no ccv_data or no resolvable dest address', () => {
    const wire = encodeResponse([
      { metadata: { verifier_dest_address: bytes(DEST) } }, // no ccv_data
      { ccv_data: bytes('0xaabb') }, // no dest address
    ])
    assert.deepEqual(decodeGetVerifierResultsResponse(wire), [])
  })

  it('returns an empty array for an empty (pre-quorum) response', () => {
    assert.deepEqual(decodeGetVerifierResultsResponse(encodeResponse([])), [])
  })
})
