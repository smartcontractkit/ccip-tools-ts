import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hexlify } from 'ethers'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { RequestType, ResponseType, encodeResponse, hexBytes } from './__mocks__/verifier.ts'
import { decodeGetVerifierResultsResponse, encodeGetVerifierResultsRequest } from './codec.ts'

const MSG = '0x' + '33'.repeat(32)
const CCV = '0x345aedb0988ff1e897c26f9ad3ae84603ed517e2'
const SRC = '0x' + '11'.repeat(20)

describe('verifier codec (cross-checked against protobufjs on verifier.proto)', () => {
  it('encodes a request the reference implementation decodes back to the message id', () => {
    const decoded = RequestType.toObject(RequestType.decode(encodeGetVerifierResultsRequest(MSG)), {
      bytes: String,
    }) as { message_ids: string[] }
    assert.deepEqual(decoded.message_ids, [Buffer.from(hexBytes(MSG)).toString('base64')])
  })

  it('decodes ccv_data, the metadata addresses and timestamp, and the errors', () => {
    const decoded = decodeGetVerifierResultsResponse(
      encodeResponse(
        [
          {
            ccvData: '0xdeadbeef',
            destAddress: CCV,
            sourceAddress: SRC,
            timestampMs: 1_690_000_000_123,
          },
        ],
        [{ code: 5, message: 'not found' }],
      ),
    )
    assert.equal(decoded.results.length, 1)
    const [r] = decoded.results
    assert.equal(hexlify(r!.ccvData!), '0xdeadbeef')
    assert.equal(hexlify(r!.destAddress!), CCV)
    assert.equal(hexlify(r!.sourceAddress!), SRC)
    assert.equal(r!.timestamp, 1_690_000_000_123)
    assert.deepEqual(decoded.errors, [{ code: 5, message: 'not found' }])
  })

  it('skips fields it does not read, including the full nested Message', () => {
    const bytes = ResponseType.encode(
      ResponseType.create({
        results: [
          {
            message: {
              sender: hexBytes(SRC),
              data: hexBytes('0x0102'),
              source_chain_selector: '16015286601757825753',
              sequence_number: 7,
              finality: 1,
            },
            message_ccv_addresses: [hexBytes(SRC)],
            message_executor_address: hexBytes(SRC),
            ccv_data: hexBytes('0xaa'),
            metadata: { verifier_dest_address: hexBytes(CCV) },
          },
        ],
      }),
    ).finish()
    // append an unknown fixed64 field (#99) and fixed32 field (#98), which must be skipped;
    // their keys, (99 << 3) | 1 and (98 << 3) | 5, are 2-byte varints
    const withUnknown = new Uint8Array([
      ...bytes,
      ...[0x99, 0x06, ...new Array<number>(8).fill(0xff)],
      ...[0x95, 0x06, 1, 2, 3, 4],
    ])
    const decoded = decodeGetVerifierResultsResponse(withUnknown)
    assert.equal(decoded.results.length, 1)
    assert.deepEqual(Object.keys(decoded.results[0]!).sort(), ['ccvData', 'destAddress'])
    assert.equal(hexlify(decoded.results[0]!.ccvData!), '0xaa')
    assert.equal(hexlify(decoded.results[0]!.destAddress!), CCV)
  })

  it('decodes an empty (pre-quorum) response', () => {
    assert.deepEqual(decodeGetVerifierResultsResponse(new Uint8Array()), {
      results: [],
      errors: [],
    })
  })

  it('rejects truncated input', () => {
    const bytes = encodeResponse([{ ccvData: '0xdeadbeef', destAddress: CCV }])
    assert.throws(
      () => decodeGetVerifierResultsResponse(bytes.subarray(0, bytes.length - 3)),
      (err: unknown) =>
        err instanceof CCIPError && err.code === CCIPErrorCode.MESSAGE_DECODE_FAILED,
    )
  })
})
