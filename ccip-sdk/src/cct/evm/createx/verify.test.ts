import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { keccak256 } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { CREATEX_ADDRESS, CREATEX_RUNTIME_CODE_HASH } from './contracts.ts'
import { verifyCreateXDeployment } from './verify.ts'

/** Minimal chain stub: `verifyCreateXDeployment` only reads the network and the code at an address. */
function stubChain(chainId: bigint, code: string): EVMChain {
  return {
    provider: {
      getNetwork: () => Promise.resolve({ chainId }),
      getCode: (address: string) => {
        assert.equal(address, CREATEX_ADDRESS)
        return Promise.resolve(code)
      },
    },
  } as unknown as EVMChain
}

/** Stand-in for deployed code; its content is irrelevant, only that it is not CreateX's. */
const SOME_CODE = '0x600180'

describe('verifyCreateXDeployment', () => {
  it('reports mismatch when the address holds something other than CreateX', async () => {
    const result = await verifyCreateXDeployment(stubChain(84532n, '0xdeadbeef'))
    assert.equal(result.status, 'mismatch')
    assert.partialDeepStrictEqual(result, { expected: CREATEX_RUNTIME_CODE_HASH })
  })

  it('reports notDeployed on a chain with no code at the address', async () => {
    const result = await verifyCreateXDeployment(stubChain(84532n, '0x'))
    assert.equal(result.status, 'notDeployed')
  })

  it('reports unsupported for the zkSync family rather than mispredicting', async () => {
    for (const chainId of [324n, 2741n]) {
      const result = await verifyCreateXDeployment(stubChain(chainId, SOME_CODE))
      assert.equal(result.status, 'unsupported')
    }
  })

  it('reports the hash it actually computed, so a mismatch is diagnosable', async () => {
    const result = await verifyCreateXDeployment(stubChain(84532n, SOME_CODE))
    assert.equal(result.status === 'mismatch' ? result.codeHash : undefined, keccak256(SOME_CODE))
  })

  // The `verified` branch is covered in createx.integration.test.ts against the real deployment.
  // Reproducing it here would mean vendoring CreateX's 12KB of AGPL-3.0 runtime bytecode as a
  // fixture, which is the exact exposure this package avoids.
})
