import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  VERIFIER_METHOD,
  decodeGetVerifierResultsResponse,
  encodeGetVerifierResultsRequest,
  readAggregator,
} from '@chainlink/ccip-sdk/src/verifiers/index.ts'
import * as grpc from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'

import { grpcVerifierTransport } from './grpc-transport.ts'

/**
 * Proves the CLI's grpc-js passthrough transport interoperates with the SDK schema over a REAL
 * gRPC (HTTP/2) server: the SDK encodes the request, grpc-js frames it, a real server decodes and
 * answers, and the SDK decodes the response. Exercises the exact refactored path end to end without
 * the committee stack.
 */

const CCV = '0x345aedb0988ff1e897c26f9ad3ae84603ed517e2'
const MSG = '0x' + '33'.repeat(32)

function addrBytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex')
}

// The server loads the proto at runtime (test-only; the SHIPPED SDK uses the committed descriptor).
const PROTO = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'ccip-sdk',
  'src',
  'verifiers',
  'proto',
  'verifier.proto',
)

describe('grpcVerifierTransport (real gRPC round-trip)', () => {
  let server: grpc.Server
  let port: number

  before(async () => {
    const def = loadSync(PROTO, { keepCase: true, longs: String, defaults: true, oneofs: true })
    const pkg = grpc.loadPackageDefinition(def) as unknown as {
      chainlink_ccv: { verifier: { v1: { Verifier: { service: grpc.ServiceDefinition } } } }
    }
    server = new grpc.Server()
    server.addService(pkg.chainlink_ccv.verifier.v1.Verifier.service, {
      GetVerifierResultsForMessage: (
        _call: unknown,
        cb: (err: grpc.ServiceError | null, res: unknown) => void,
      ) => {
        cb(null, {
          results: [
            {
              ccv_data: Buffer.from('deadbeef', 'hex'),
              metadata: {
                timestamp: 1_690_000_000_000,
                verifier_dest_address: addrBytes(CCV),
                verifier_source_address: addrBytes(CCV),
              },
            },
          ],
        })
      },
    })
    port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => {
        if (err) reject(err)
        else resolve(p)
      })
    })
  })

  after(() => {
    server.forceShutdown()
  })

  it('encodes (SDK) → transports (grpc-js) → decodes (SDK) a real response', async () => {
    const transport = grpcVerifierTransport()
    const bytes = await transport.unary({
      method: VERIFIER_METHOD,
      endpoint: {
        type: 'aggregator',
        target: `127.0.0.1:${port}`,
        tls: false,
        raw: `grpc+plaintext://127.0.0.1:${port}`,
      },
      request: encodeGetVerifierResultsRequest(MSG),
      timeoutMs: 5_000,
    })
    const results = decodeGetVerifierResultsResponse(bytes)
    assert.equal(results.length, 1)
    const r = results[0]
    assert.ok(r)
    assert.equal(r.ccvData, '0xdeadbeef')
    assert.equal(r.destAddress, CCV)
    assert.equal(r.timestamp, 1_690_000_000)
  })

  it('assembles via readAggregator with the injected grpc transport', async () => {
    const read = await readAggregator(
      [
        {
          type: 'aggregator',
          target: `127.0.0.1:${port}`,
          tls: false,
          raw: `grpc+plaintext://127.0.0.1:${port}`,
        },
      ],
      MSG,
      { transport: grpcVerifierTransport() },
    )
    assert.equal(read.servedBy, `grpc+plaintext://127.0.0.1:${port}`)
    assert.equal(read.results[0]?.ccvData, '0xdeadbeef')
  })
})
