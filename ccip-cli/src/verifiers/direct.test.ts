import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { VerifierResult } from '@chainlink/ccip-sdk/src/index.ts'

import { type VerificationPolicy, assertCoverage, formatCoverageFailure } from './direct.ts'

const CCV_A = '0x345AEDB0988Ff1e897c26f9ad3AE84603Ed517E2'
const CCV_B = '0xD5C448Fc5B81EFd3108656Ce5FF9bacF2b582bdB'

function result(destAddress: string): VerifierResult {
  return { ccvData: '0xabcd', destAddress, sourceAddress: destAddress }
}

describe('assertCoverage', () => {
  it('should block the empty set that would broadcast a reverting execute', () => {
    // An empty verification set reverts RequiredCCVMissing onchain and moves the message to
    // FAILURE. Failing here costs nothing.
    const policy: VerificationPolicy = {
      requiredCCVs: [CCV_A],
      optionalCCVs: [],
      optionalThreshold: 0,
    }
    assert.throws(() => assertCoverage([], policy), /RequiredCCVMissing/)
  })

  it('should name every uncovered required CCV', () => {
    const policy: VerificationPolicy = {
      requiredCCVs: [CCV_A, CCV_B],
      optionalCCVs: [],
      optionalThreshold: 0,
    }
    assert.throws(
      () => assertCoverage([result(CCV_A)], policy),
      (err: Error) => {
        assert.match(err.message, new RegExp(CCV_B))
        assert.doesNotMatch(err.message, new RegExp(CCV_A))
        return true
      },
    )
  })

  it('should match CCV addresses case-insensitively', () => {
    const policy: VerificationPolicy = {
      requiredCCVs: [CCV_A],
      optionalCCVs: [],
      optionalThreshold: 0,
    }
    assert.doesNotThrow(() => assertCoverage([result(CCV_A.toLowerCase())], policy))
  })

  it('should enforce the optional quorum, not just the required set', () => {
    const policy: VerificationPolicy = {
      requiredCCVs: [],
      optionalCCVs: [CCV_A, CCV_B],
      optionalThreshold: 2,
    }
    assert.throws(() => assertCoverage([result(CCV_A)], policy), /OptionalCCVQuorumNotReached/)
    assert.doesNotThrow(() => assertCoverage([result(CCV_A), result(CCV_B)], policy))
  })

  it('should pass a fully satisfied policy through untouched', () => {
    const policy: VerificationPolicy = {
      requiredCCVs: [CCV_A],
      optionalCCVs: [CCV_B],
      optionalThreshold: 1,
    }
    assert.doesNotThrow(() => assertCoverage([result(CCV_A), result(CCV_B)], policy))
  })
})

describe('formatCoverageFailure', () => {
  it('should tell the user which flag to add when no endpoint was supplied', () => {
    const msg = formatCoverageFailure(
      [
        {
          ccvAddress: CCV_A,
          role: 'required',
          status: 'unmapped',
          servedBy: null,
          endpointsTried: [],
          ccvDataLength: 0,
          failures: [],
        },
      ],
      { requiredCCVs: [CCV_A], optionalCCVs: [], optionalThreshold: 0 },
    )
    assert.match(msg, /no endpoint supplied/)
    assert.match(msg, new RegExp(`--verifier ${CCV_A}=`))
  })

  it('should distinguish reachable-but-not-attested-yet from unreachable', () => {
    const pending = formatCoverageFailure(
      [
        {
          ccvAddress: CCV_A,
          role: 'required',
          status: 'pending',
          servedBy: null,
          endpointsTried: ['grpc://h:443'],
          ccvDataLength: 0,
          failures: [],
        },
      ],
      { requiredCCVs: [CCV_A], optionalCCVs: [], optionalThreshold: 0 },
    )
    assert.match(pending, /has not attested this message yet/)
    assert.match(pending, /not an execution failure/)

    const unreachable = formatCoverageFailure(
      [
        {
          ccvAddress: CCV_A,
          role: 'required',
          status: 'unreachable',
          servedBy: null,
          endpointsTried: ['grpc://h:443'],
          ccvDataLength: 0,
          failures: [{ endpoint: 'grpc://h:443', reason: 'ECONNREFUSED' }],
        },
      ],
      { requiredCCVs: [CCV_A], optionalCCVs: [], optionalThreshold: 0 },
    )
    assert.match(unreachable, /no endpoint served an attestation/)
    assert.match(unreachable, /ECONNREFUSED/)
    assert.doesNotMatch(unreachable, /has not attested this message yet/)
  })
})
