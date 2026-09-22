import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import protobuf from 'protobufjs'

import { verifierProtoDescriptor } from './descriptor.ts'
import { fetchVerificationsDirect, readAggregator } from './direct.ts'
import { parseVerifierEndpoints } from './endpoints.ts'
import type { VerifierRpc, VerifierTransport } from './transport.ts'

const root = protobuf.Root.fromJSON(verifierProtoDescriptor)
const ResponseType = root.lookupType(
  'chainlink_ccv.verifier.v1.GetVerifierResultsForMessageResponse',
)

const MSG = '0x' + '22'.repeat(32)
const CCV = '0x345aedb0988ff1e897c26f9ad3ae84603ed517e2'

function addr(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '')
  const b = new Uint8Array(20)
  for (let i = 0; i < 20; i++) b[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return b
}

function response(destAddress: string, ccvHex: string): Uint8Array {
  return ResponseType.encode(
    ResponseType.create({
      results: [
        {
          ccv_data: Uint8Array.from(Buffer.from(ccvHex.replace(/^0x/, ''), 'hex')),
          metadata: { verifier_dest_address: addr(destAddress) },
        },
      ],
    }),
  ).finish()
}

const EMPTY = ResponseType.encode(ResponseType.create({ results: [] })).finish()

/** A transport whose behaviour is keyed on the endpoint target, recording every call. */
function mockTransport(
  behaviour: Record<string, () => Uint8Array>,
): VerifierTransport & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    unary(rpc: VerifierRpc): Promise<Uint8Array> {
      calls.push(rpc.endpoint.target)
      const fn = behaviour[rpc.endpoint.target]
      if (!fn) return Promise.reject(new Error(`ECONNREFUSED ${rpc.endpoint.target}`))
      return Promise.resolve(fn())
    },
  }
}

describe('readAggregator (failover + dedup via the transport port)', () => {
  it('stops at the first endpoint that serves a complete blob (primary wins)', async () => {
    const map = parseVerifierEndpoints([`${CCV}=grpc://primary:443`, `${CCV}=grpc://backup:443`])
    const transport = mockTransport({ 'primary:443': () => response(CCV, '0xdeadbeef') })
    const read = await readAggregator(map.byCcv.get(CCV.toLowerCase()) ?? [], MSG, { transport })
    assert.equal(read.servedBy, 'grpc://primary:443')
    assert.equal(read.results.length, 1)
    assert.equal(read.results[0]?.ccvData, '0xdeadbeef')
    assert.deepEqual(transport.calls, ['primary:443']) // backup never tried
  })

  it('fails over to the backup when the primary is unreachable', async () => {
    const map = parseVerifierEndpoints([`${CCV}=grpc://primary:443`, `${CCV}=grpc://backup:443`])
    const transport = mockTransport({ 'backup:443': () => response(CCV, '0xabcd') })
    const read = await readAggregator(map.byCcv.get(CCV.toLowerCase()) ?? [], MSG, { transport })
    assert.equal(read.servedBy, 'grpc://backup:443')
    assert.equal(read.results[0]?.ccvData, '0xabcd')
    assert.deepEqual(transport.calls, ['primary:443', 'backup:443'])
    assert.match(read.failures[0]?.reason ?? '', /ECONNREFUSED/)
  })

  it('reports pending (reachable, no attestation yet) distinctly from unreachable', async () => {
    const map = parseVerifierEndpoints([`${CCV}=grpc://only:443`])
    const transport = mockTransport({ 'only:443': () => EMPTY })
    const read = await readAggregator(map.byCcv.get(CCV.toLowerCase()) ?? [], MSG, { transport })
    assert.equal(read.results.length, 0)
    assert.match(read.failures[0]?.reason ?? '', /holds no attestation/)
  })
})

describe('fetchVerificationsDirect', () => {
  it('collects one attestation per required CCV and reports it ok', async () => {
    const policy = { requiredCCVs: [CCV], optionalCCVs: [], optionalThreshold: 0 }
    const map = parseVerifierEndpoints([`${CCV}=grpc://agg:443`])
    const transport = mockTransport({ 'agg:443': () => response(CCV, '0x1234') })
    const out = await fetchVerificationsDirect(policy, map, MSG, { transport })
    assert.equal(out.verifications.length, 1)
    assert.equal(out.verifications[0]?.destAddress, CCV)
    assert.equal(out.outcomes[0]?.status, 'ok')
    assert.equal(out.outcomes[0].ccvDataLength, 2)
  })

  it('marks an unmapped required CCV rather than fetching it', async () => {
    const policy = { requiredCCVs: [CCV], optionalCCVs: [], optionalThreshold: 0 }
    const out = await fetchVerificationsDirect(policy, parseVerifierEndpoints([]), MSG, {
      transport: mockTransport({}),
    })
    assert.equal(out.verifications.length, 0)
    assert.equal(out.outcomes[0]?.status, 'unmapped')
  })
})
