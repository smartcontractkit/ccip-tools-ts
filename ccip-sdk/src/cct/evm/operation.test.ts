import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, getCreateAddress } from 'ethers'

import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily, networkInfo } from '../../networks.ts'
import {
  type PreconditionError,
  CCTParamsInvalidError,
  CCTPreconditionError,
  CCTTxFailedError,
} from '../errors.ts'
import {
  type DeployArtifact,
  EVMDeployOperation,
  EVMOperation,
  callTx,
  unmet,
} from './operation.ts'

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
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(contractAddress: string | null) {
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
        error.context.returnedAddress === returnedAddress &&
        error.recovery ===
          'Verify the RPC endpoint; the expected deployment address is in context.expectedAddress.',
    )
  })

  it('rejects a missing receipt contract address', async () => {
    await assert.rejects(
      () => new TestDeploy().execute(stubChain(), { wallet: fakeSigner(null) }),
      (error: unknown) =>
        error instanceof CCTTxFailedError &&
        error.context.expectedAddress === DEPLOYED &&
        error.context.returnedAddress === null &&
        error.recovery ===
          'Verify the RPC endpoint; the expected deployment address is in context.expectedAddress.',
    )
  })

  it('rejects a malformed receipt contract address', async () => {
    await assert.rejects(
      () => new TestDeploy().execute(stubChain(), { wallet: fakeSigner('not-an-address') }),
      (error: unknown) =>
        error instanceof CCTTxFailedError &&
        error.context.expectedAddress === DEPLOYED &&
        error.context.returnedAddress === 'not-an-address' &&
        error.recovery ===
          'Verify the RPC endpoint; the expected deployment address is in context.expectedAddress.',
    )
  })
})

/**
 * The {@link EVMOperation.preconditions} contract: what an op reports when the chain is not yet in
 * the state its transaction needs, and what a caller can still do with the result.
 *
 * Driven through a minimal op rather than a real one, so these assert the base class's behaviour
 * and not any particular operation's checks. The per-op suites cover which checks each one runs.
 */

const TO = '0x' + '22'.repeat(20)
const DATA = '0xdeadbeef'

type Params = { sender?: string; report?: PreconditionError[] }

/** Reports whatever its params ask it to, so each case names its own unmet requirements. */
class Probe extends EVMOperation<Params> {
  readonly name = 'probe'
  protected buildUnsigned(): UnsignedEVMTx {
    return callTx(TO, DATA)
  }
  protected override preconditions(_chain: EVMChain, params: Params): Promise<PreconditionError[]> {
    return Promise.resolve(params.report ?? [])
  }
}

/** An op that overrides nothing — the default must not turn any existing op into a reporter. */
class Plain extends EVMOperation<Params> {
  readonly name = 'plain'
  protected buildUnsigned(): UnsignedEVMTx {
    return callTx(TO, DATA)
  }
}

// `generate` pins every tx to `chain.network.chainId`; nothing else on the chain is read.
const chain = { network: networkInfo('ethereum-testnet-sepolia-base-1') } as unknown as EVMChain

describe('EVMOperation preconditions (cct/evm)', () => {
  it('returns the tx untouched when nothing is unmet', async () => {
    const tx = await new Probe().generate(chain, { sender: SENDER, report: [] })
    assert.equal(tx.family, ChainFamily.EVM)
    assert.equal(tx.transactions[0]!.data, DATA)
    assert.equal(tx.transactions[0]!.from, SENDER)
  })

  it('does not report for an op that overrides nothing', async () => {
    const tx = await new Plain().generate(chain, { sender: SENDER })
    assert.equal(tx.transactions[0]!.data, DATA)
  })

  describe('when a requirement is unmet', () => {
    const report = [{ param: 'sender', reason: 'must be the current token pool owner (0x…)' }]
    const generate = () => new Probe().generate(chain, { sender: SENDER, report })

    it('throws CCTPreconditionError', async () => {
      await assert.rejects(generate, (err: unknown) => err instanceof CCTPreconditionError)
    })

    it('still carries the calldata the happy path would have returned', async () => {
      // the whole point: a caller batching this behind the step that satisfies it takes `unsigned`
      const err = await generate().then(
        () => assert.fail('expected a rejection'),
        (err: unknown) => err as CCTPreconditionError,
      )
      assert.equal(err.unsigned.transactions[0]!.to, TO)
      assert.equal(err.unsigned.transactions[0]!.data, DATA)
      // `sender` is applied before the checks run, so the tx is ready to sign as-is
      assert.equal(err.unsigned.transactions[0]!.from, SENDER)
    })

    it('is catchable as CCTParamsInvalidError, so existing callers keep working', async () => {
      await assert.rejects(
        generate,
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'probe' &&
          err.context.param === 'sender',
      )
    })

    it('names itself CCTPreconditionError, not its base class', async () => {
      await assert.rejects(
        generate,
        (err: unknown) => (err as Error).name === 'CCTPreconditionError',
      )
    })
  })

  describe('with several requirements unmet', () => {
    const report = [
      { param: 'sender', reason: 'must be the pool owner' },
      { param: 'amount', reason: 'exceeds the pool balance' },
    ]
    const generate = () => new Probe().generate(chain, { sender: SENDER, report })

    it('reports every one, not just the first', async () => {
      const err = await generate().then(
        () => assert.fail('expected a rejection'),
        (err: unknown) => err as CCTPreconditionError,
      )
      assert.deepEqual(err.errors, report)
    })

    it('joins the reasons into the message and blames the first param', async () => {
      await assert.rejects(
        generate,
        (err: unknown) =>
          err instanceof CCTPreconditionError &&
          // `context.param` can only hold one, so the first stands for the group
          err.context.param === 'sender' &&
          err.message.includes('must be the pool owner; exceeds the pool balance'),
      )
    })
  })
})

describe('unmet (cct/evm)', () => {
  const a = { param: 'sender', reason: 'one' }
  const b = { param: 'amount', reason: 'two' }

  it('drops the checks that passed', () => {
    assert.deepEqual(unmet(undefined, a, undefined, b), [a, b])
  })

  it('flattens a check that reported several at once', () => {
    assert.deepEqual(unmet([a, b], undefined), [a, b])
  })

  it('is empty when everything passed, which is what keeps generate from throwing', () => {
    assert.deepEqual(unmet(undefined, undefined, []), [])
  })
})
