import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, getCreateAddress } from 'ethers'

import type { EVMChain } from '../../evm/index.ts'
import { CCTTxFailedError } from '../errors.ts'
import { type DeployArtifact, EVMDeployOperation } from './operation.ts'

const SENDER = '0x' + '11'.repeat(20)
const DEPLOYED = getCreateAddress({ from: SENDER, nonce: 0 })
const HASH = '0x' + 'ab'.repeat(32)

class TestDeploy extends EVMDeployOperation<{}> {
  readonly name = 'testDeploy'

  protected artifact(): DeployArtifact {
    return { contract: 'Test', iface: new Interface([]), bytecode: '0x00' }
  }

  protected encode(): string {
    return '0x'
  }
}

function stubChain(): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(contractAddress: string) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => Promise.resolve({ status: 1, contractAddress }),
      }),
  }
}

describe('EVMDeployOperation', () => {
  it('accepts a lowercase receipt contract address', async () => {
    const result = await new TestDeploy().execute(stubChain(), {
      wallet: fakeSigner(DEPLOYED.toLowerCase()),
    })
    assert.equal(result.contractAddress, DEPLOYED)
  })

  it('rejects a substituted receipt contract address', async () => {
    const returnedAddress = '0x' + '77'.repeat(20)
    await assert.rejects(
      () => new TestDeploy().execute(stubChain(), { wallet: fakeSigner(returnedAddress) }),
      (error: unknown) =>
        error instanceof CCTTxFailedError &&
        error.context.expectedAddress === DEPLOYED &&
        error.context.returnedAddress === returnedAddress,
    )
  })

  it('rejects a malformed receipt contract address', async () => {
    await assert.rejects(
      () => new TestDeploy().execute(stubChain(), { wallet: fakeSigner('not-an-address') }),
      (error: unknown) =>
        error instanceof CCTTxFailedError &&
        error.context.expectedAddress === DEPLOYED &&
        error.context.returnedAddress === 'not-an-address',
    )
  })
})
