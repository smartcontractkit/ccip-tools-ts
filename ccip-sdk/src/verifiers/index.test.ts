import '../index.ts' // Register supported chains
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { EVMChain } from '../evm/index.ts'
import { SolanaChain } from '../solana/index.ts'
import { encodeResponse, hexBytes } from './__mocks__/verifier.ts'
import type { VerifierCall } from './transport.ts'
import { VERIFIER_METHOD, readVerifier } from './index.ts'

const MSG = '0x' + '33'.repeat(32)
const CCV = '0x345aedb0988ff1e897c26f9ad3ae84603ed517e2'
const SRC = '0x' + '11'.repeat(20)

const serving =
  (bytes: Uint8Array, calls: VerifierCall[] = []) =>
  (call: VerifierCall) => {
    calls.push(call)
    return Promise.resolve(bytes)
  }

describe('readVerifier', () => {
  it('calls the verifier method at the given URL and maps results to VerifierResult', async () => {
    const calls: VerifierCall[] = []
    const results = await readVerifier('https://proxy.example', MSG, {
      transport: serving(
        encodeResponse([
          {
            ccvData: '0xdeadbeef',
            destAddress: CCV,
            sourceAddress: SRC,
            timestampMs: 1_690_000_000_999,
          },
        ]),
        calls,
      ),
      getAddress: (a) => EVMChain.getAddress(a),
    })
    assert.equal(calls[0]!.url, 'https://proxy.example')
    assert.equal(calls[0]!.method, VERIFIER_METHOD)
    assert.deepEqual(results, [
      {
        ccvData: '0xdeadbeef',
        destAddress: EVMChain.getAddress(CCV), // canonical in the dest family
        sourceAddress: SRC,
        timestamp: 1_690_000_000, // ms → s
      },
    ])
  })

  it('drops results it cannot attribute to a destination CCV, or that carry no ccv_data', async () => {
    const results = await readVerifier('https://proxy.example', MSG, {
      transport: serving(
        encodeResponse([
          { ccvData: '0x01' }, // no dest hint: which CCV would it satisfy?
          { destAddress: CCV }, // no attestation
          { ccvData: '0x02', destAddress: '0x' + 'ab'.repeat(32) }, // not an EVM address
          { ccvData: '0x03', destAddress: CCV },
        ]),
      ),
      getAddress: (a) => EVMChain.getAddress(a),
    })
    assert.deepEqual(
      results.map((r) => r.ccvData),
      ['0x03'],
    )
  })

  it("renders the dest address in the destination family's format", async () => {
    const dest = '0x' + '07'.repeat(32)
    const [result] = await readVerifier('https://proxy.example', MSG, {
      transport: serving(encodeResponse([{ ccvData: '0x01', destAddress: dest }])),
      getAddress: (a) => SolanaChain.getAddress(a),
    })
    assert.equal(result!.destAddress, SolanaChain.getAddress(hexBytes(dest)))
  })

  it('surfaces the per-message errors of a response with no results', async () => {
    await assert.rejects(
      readVerifier('https://proxy.example', MSG, {
        transport: serving(encodeResponse([], [{ code: 5, message: 'message not found' }])),
      }),
      /code 5: message not found/,
    )
  })

  it('returns nothing for an empty (pre-quorum) response', async () => {
    assert.deepEqual(
      await readVerifier('https://proxy.example', MSG, { transport: serving(new Uint8Array()) }),
      [],
    )
  })
})
