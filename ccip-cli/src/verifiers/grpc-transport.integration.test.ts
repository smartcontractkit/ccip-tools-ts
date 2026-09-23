import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CCIPMessageNotVerifiedYetError,
  fetchVerifications,
  readVerifier,
} from '@chainlink/ccip-sdk/src/index.ts'
import * as grpc from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'

import { grpcVerifierTransport } from './grpc-transport.ts'

/**
 * Proves the CLI's grpc-js passthrough transport interoperates with the SDK's hand-written codec
 * over a REAL gRPC (HTTP/2) server built from verifier.proto: the SDK encodes the request, grpc-js
 * frames it, the server decodes and answers, and the SDK decodes the response.
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

  it('reads a real response: SDK encodes → grpc-js transports → SDK decodes', async () => {
    const results = await readVerifier(`grpc+plaintext://127.0.0.1:${port}`, MSG, {
      transport: grpcVerifierTransport(),
    })
    assert.deepEqual(results, [
      { ccvData: '0xdeadbeef', destAddress: CCV, sourceAddress: CCV, timestamp: 1_690_000_000 },
    ])
  })

  it('serves as the last source of fetchVerifications, failing over past a dead endpoint', async () => {
    const results = await fetchVerifications(MSG, {
      indexer: [],
      apiClient: null,
      policy: { requiredCCVs: [CCV], optionalCCVs: [], optionalThreshold: 0 },
      verifiers: ['grpc+plaintext://127.0.0.1:1', `grpc+plaintext://127.0.0.1:${port}`],
      verifierTransport: grpcVerifierTransport(),
    })
    assert.equal(results[0]?.ccvData, '0xdeadbeef')
  })

  it("reports an unreachable endpoint without grpc-js's empty resolution note", async () => {
    await assert.rejects(
      fetchVerifications(MSG, {
        indexer: [],
        apiClient: null,
        policy: { requiredCCVs: [CCV], optionalCCVs: [], optionalThreshold: 0 },
        verifiers: ['grpc+plaintext://127.0.0.1:1'],
        verifierTransport: grpcVerifierTransport(),
        timeoutMs: 5_000,
      }),
      (err: unknown) => {
        assert.ok(err instanceof CCIPMessageNotVerifiedYetError)
        const [failure] = err.context.verifierFailures as { url: string; reason: string }[]
        assert.equal(failure?.url, 'grpc+plaintext://127.0.0.1:1')
        assert.match(failure!.reason, /UNAVAILABLE/)
        assert.doesNotMatch(failure!.reason, /Resolution note:\s*$/)
        return true
      },
    )
  })

  it('cancels the call when its signal aborts', async () => {
    await assert.rejects(
      grpcVerifierTransport()({
        url: `grpc+plaintext://127.0.0.1:${port}`,
        method: '/chainlink_ccv.verifier.v1.Verifier/GetVerifierResultsForMessage',
        body: new Uint8Array(),
        signal: AbortSignal.abort(),
      }),
    )
  })

  it('hands http(s):// endpoints to the grpc-web transport', async () => {
    const seen: string[] = []
    const transport = grpcVerifierTransport(({ url }) => {
      seen.push(url)
      return Promise.resolve(new Uint8Array())
    })
    await transport({ url: 'https://proxy.example', method: '/m', body: new Uint8Array() })
    assert.deepEqual(seen, ['https://proxy.example'])
    await assert.rejects(
      transport({ url: 'ftp://proxy.example', method: '/m', body: new Uint8Array() }),
      /unsupported scheme/,
    )
  })
})
