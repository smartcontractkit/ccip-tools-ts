/**
 * Tests for the Aptos `manually_execute` entrypoint and its BCS execution report.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import { networkInfo } from '../networks.ts'
import type { ExecutionInput } from '../types.ts'
import { generateUnsignedExecuteReport } from './exec.ts'
import { serializeExecutionReport } from './types.ts'

const PACKAGE = '0xc748b8e0c5b7e0e4b4e4b0e1c2d3e4f5a6b7c8d9eabcdef0123456789abcdef0'
const PAYER = `0x${'1'.repeat(64)}`
const SOURCE = networkInfo('ethereum-testnet-sepolia').chainSelector
const DEST = networkInfo('aptos-testnet').chainSelector
const TX_BYTES = new Uint8Array([9, 8, 7])

const execReport: ExecutionInput<CCIPMessage_V1_6_EVM> = {
  message: {
    messageId: `0x${'11'.repeat(32)}`,
    sourceChainSelector: SOURCE,
    destChainSelector: DEST,
    sequenceNumber: 7n,
    nonce: 1n,
    sender: `0x${'22'.repeat(20)}`,
    data: '0xdead',
    receiver: `0x${'33'.repeat(32)}`,
    gasLimit: 100_000n,
    tokenAmounts: [
      {
        sourcePoolAddress: `0x${'aa'.repeat(20)}`,
        destTokenAddress: `0x${'bb'.repeat(32)}`,
        destGasAmount: 5n,
        extraData: '0xcc',
        amount: 7n,
      },
    ],
  },
  proofs: [`0x${'dd'.repeat(32)}`],
  proofFlagBits: 0n,
  merkleRoot: `0x${'ee'.repeat(32)}`,
  offchainTokenData: [{} as never],
} as unknown as ExecutionInput<CCIPMessage_V1_6_EVM>

function providerWithTx() {
  const simple = mock.fn(async (_args: unknown) => ({ bcsToBytes: () => TX_BYTES }))
  const provider = { transaction: { build: { simple } } } as unknown as Aptos
  return { provider, simple }
}

type BuildArgs = {
  sender: unknown
  data: { function: string; functionArguments: unknown[] }
  options?: { maxGasAmount?: number }
}

describe('Aptos generateUnsignedExecuteReport', () => {
  it('calls manually_execute with the BCS-serialized report', async () => {
    const { provider, simple } = providerWithTx()

    const unsigned = await generateUnsignedExecuteReport(provider, PAYER, PACKAGE, execReport, {
      gasLimit: 500_000,
    })

    assert.deepEqual(unsigned, TX_BYTES)
    assert.equal(simple.mock.calls.length, 1)
    const args = simple.mock.calls[0]!.arguments[0] as BuildArgs
    assert.equal(args.data.function, `${PACKAGE}::offramp::manually_execute`)
    assert.deepEqual(args.data.functionArguments, [serializeExecutionReport(execReport)])
    assert.deepEqual(args.options, { maxGasAmount: 500_000 })
  })

  it('keeps an offRamp that already names its module untouched', async () => {
    const { provider, simple } = providerWithTx()
    const offRamp = `${PACKAGE}::custom_offramp`

    await generateUnsignedExecuteReport(provider, PAYER, offRamp, execReport)

    const args = simple.mock.calls[0]!.arguments[0] as BuildArgs
    assert.equal(args.data.function, `${offRamp}::manually_execute`)
  })

  it('gives txGasLimit precedence over the report gas limit', async () => {
    const { provider, simple } = providerWithTx()

    await generateUnsignedExecuteReport(provider, PAYER, PACKAGE, execReport, {
      gasLimit: 500_000,
      txGasLimit: 650_000,
    })

    const args = simple.mock.calls[0]!.arguments[0] as BuildArgs
    assert.deepEqual(args.options, { maxGasAmount: 650_000 })
  })

  it('leaves maxGasAmount undefined when no gas limit is given', async () => {
    const { provider, simple } = providerWithTx()

    await generateUnsignedExecuteReport(provider, PAYER, PACKAGE, execReport)

    const args = simple.mock.calls[0]!.arguments[0] as BuildArgs
    assert.deepEqual(args.options, { maxGasAmount: undefined })
  })

  it('encodes an empty report when the message carries no tokens or proofs extras', async () => {
    const { provider, simple } = providerWithTx()
    const bare = {
      ...execReport,
      message: { ...execReport.message, tokenAmounts: [] },
      offchainTokenData: [],
      proofs: [],
    } as ExecutionInput<CCIPMessage_V1_6_EVM>

    await generateUnsignedExecuteReport(provider, PAYER, PACKAGE, bare)

    const [encoded] = (simple.mock.calls[0]!.arguments[0] as BuildArgs).data.functionArguments as [
      Uint8Array,
    ]
    assert.deepEqual(encoded, serializeExecutionReport(bare))
    assert.ok(encoded.length > 0)
  })
})
