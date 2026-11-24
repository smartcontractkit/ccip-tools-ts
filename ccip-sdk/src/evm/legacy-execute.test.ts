import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { type JsonRpcApiProvider, getBytes } from 'ethers'

import { ChainFamily } from '../networks.ts'
import { type CCIPMessage, CCIPVersion } from '../types.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const OFFRAMP = '0x2100000000000000000000000000000000000001'
const PAYER = '0x2100000000000000000000000000000000000002'
const SENDER = '0x2100000000000000000000000000000000000003'
const RECEIVER = '0x2100000000000000000000000000000000000004'
const TOKEN = '0x2100000000000000000000000000000000000005'
const SOURCE_POOL = '0x2100000000000000000000000000000000000006'
const DEST_TOKEN = '0x2100000000000000000000000000000000000007'
const MESSAGE_ID = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const MERKLE_ROOT = '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
const PROOF = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const ATTESTATION = '0xdeadbeef'
const SOURCE_SELECTOR = 1n

function executionReportFields() {
  return {
    proofs: [getBytes(PROOF)],
    proofFlagBits: 0n,
    merkleRoot: MERKLE_ROOT,
    offchainTokenData: [{ _tag: 'lbtc', attestation: ATTESTATION }],
  }
}

function makeChain(version: CCIPVersion) {
  const estimateGas = mock.fn(async () => 500_000n)
  const provider = { estimateGas } as unknown as JsonRpcApiProvider
  const chain = Object.create(EVMChain.prototype) as EVMChain
  Object.assign(chain, {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: mock.fn(async () => ['EVM2EVMOffRamp', version, `EVM2EVMOffRamp ${version}`]),
  })
  return { chain, estimateGas }
}

function commonMessage(): Omit<CCIPMessage<typeof CCIPVersion.V1_2>, 'tokenAmounts'> {
  return {
    sourceChainSelector: SOURCE_SELECTOR,
    sender: SENDER,
    receiver: RECEIVER,
    sequenceNumber: 42n,
    gasLimit: 200_000n,
    strict: false,
    nonce: 7n,
    feeToken: TOKEN,
    feeTokenAmount: 123n,
    data: '0x1234',
    sourceTokenData: [],
    messageId: MESSAGE_ID,
  }
}

describe('EVMChain.generateUnsignedExecute legacy OffRamp dispatch', () => {
  it('encodes a v1.2 ExecutionReport with scalar gas limit overrides', async () => {
    const { chain, estimateGas } = makeChain(CCIPVersion.V1_2)
    const message: CCIPMessage<typeof CCIPVersion.V1_2> = {
      ...commonMessage(),
      tokenAmounts: [{ token: TOKEN, amount: 1_000n }],
    }

    const result = await chain.generateUnsignedExecute({
      offRamp: OFFRAMP,
      input: { message, ...executionReportFields() },
      payer: PAYER,
      gasLimit: 123_456,
    })

    assert.equal(result.family, ChainFamily.EVM)
    assert.equal(result.transactions.length, 1)
    const tx = result.transactions[0]!
    assert.equal(tx.to, OFFRAMP)
    assert.equal(tx.gasLimit, 500_000n)
    const decoded = interfaces.EVM2EVMOffRamp_v1_2.parseTransaction({ data: tx.data! })!
    assert.equal(decoded.name, 'manuallyExecute')
    const [report, gasOverrides] = decoded.args
    assert.equal(report.messages.length, 1)
    assert.equal(report.messages[0].messageId, MESSAGE_ID)
    assert.equal(report.messages[0].tokenAmounts[0].token, TOKEN)
    assert.deepEqual([...report.proofs], [PROOF])
    assert.equal(report.offchainTokenData[0][0], ATTESTATION)
    assert.deepEqual([...gasOverrides], [123_456n])
    assert.equal(estimateGas.mock.callCount(), 1)
  })

  it('encodes a v1.5 ExecutionReport with receiver and token gas override structs', async () => {
    const { chain, estimateGas } = makeChain(CCIPVersion.V1_5)
    const message: CCIPMessage<typeof CCIPVersion.V1_5> = {
      ...commonMessage(),
      tokenAmounts: [
        {
          token: TOKEN,
          amount: 1_000n,
          sourcePoolAddress: SOURCE_POOL,
          destTokenAddress: DEST_TOKEN,
          extraData: '0x',
          destGasAmount: 0n,
        },
      ],
    }

    const result = await chain.generateUnsignedExecute({
      offRamp: OFFRAMP,
      input: { message, ...executionReportFields() },
      payer: PAYER,
      gasLimit: 123_456,
      tokensGasLimit: 654_321,
    })

    assert.equal(result.family, ChainFamily.EVM)
    assert.equal(result.transactions.length, 1)
    const tx = result.transactions[0]!
    assert.equal(tx.to, OFFRAMP)
    assert.equal(tx.gasLimit, 500_000n)
    const decoded = interfaces.EVM2EVMOffRamp_v1_5.parseTransaction({ data: tx.data! })!
    assert.equal(decoded.name, 'manuallyExecute')
    const [report, gasOverrides] = decoded.args
    assert.equal(report.messages.length, 1)
    assert.equal(report.messages[0].messageId, MESSAGE_ID)
    assert.equal(report.messages[0].tokenAmounts[0].token, TOKEN)
    assert.deepEqual([...report.proofs], [PROOF])
    assert.equal(report.offchainTokenData[0][0], ATTESTATION)
    assert.equal(gasOverrides[0].receiverExecutionGasLimit, 123_456n)
    assert.deepEqual([...gasOverrides[0].tokenGasOverrides], [654_321n])
    assert.equal(estimateGas.mock.callCount(), 1)
  })
})
