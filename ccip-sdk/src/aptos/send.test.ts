/**
 * Tests for the Aptos router entrypoints: `get_fee` quotes and `ccip_send` transactions.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'
import { getBytes, zeroPadValue } from 'ethers'

import { encodeExtraArgs } from '../extra-args.ts'
import { ChainFamily, networkInfo } from '../networks.ts'
import type { AnyMessage } from '../types.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'
import './index.ts' // registers the Aptos family, which encodes extraArgs
import { DEFAULT_FEE_TOKEN, generateUnsignedCcipSend, getFee } from './send.ts'

const PACKAGE = '0xc748b8e0c5b7e0e4b4e4b0e1c2d3e4f5a6b7c8d9eabcdef0123456789abcdef0'
const SENDER = `0x${'1'.repeat(64)}`
const RECEIVER = '0x9eC0e4A4c411493773E01e2ABF4D42395788846b'
const DEST = networkInfo('ethereum-testnet-sepolia').chainSelector
const EXTRA_ARGS = { gasLimit: 200_000n, allowOutOfOrderExecution: true }
const TX_BYTES = new Uint8Array([1, 2, 3, 4])

/** The arguments `get_fee` and `ccip_send` share, as the Move entrypoints receive them. */
function expectedArgs(message: AnyMessage): unknown[] {
  const tokenAmounts = message.tokenAmounts ?? []
  return [
    DEST,
    getBytes(zeroPadValue(getAddressBytes(message.receiver), 32)),
    getDataBytes(message.data ?? '0x'),
    tokenAmounts.map((ta) => ta.token),
    tokenAmounts.map((ta) => ta.amount.toString()),
    tokenAmounts.map(() => '0x0'),
    message.feeToken ?? DEFAULT_FEE_TOKEN,
    '0x0',
    getBytes(encodeExtraArgs(message.extraArgs, ChainFamily.Aptos)),
  ]
}

const message = (overrides: Partial<AnyMessage> = {}): AnyMessage => ({
  receiver: RECEIVER,
  data: '0xdeadbeef',
  extraArgs: EXTRA_ARGS,
  ...overrides,
})

type ViewCall = { payload: { function: string; functionArguments: unknown[] } }

describe('Aptos getFee', () => {
  it('quotes through the router module with the message fields the Move view expects', async () => {
    const view = mock.fn(async (_args: ViewCall) => ['250'])
    const provider = { view } as unknown as Aptos
    const msg = message({ tokenAmounts: [{ token: '0xa', amount: 5n }] })

    assert.equal(await getFee(provider, PACKAGE, DEST, msg), 250n)

    assert.equal(view.mock.calls.length, 1)
    const { payload } = view.mock.calls[0]!.arguments[0]
    assert.equal(payload.function, `${PACKAGE}::router::get_fee`)
    assert.deepEqual(payload.functionArguments, expectedArgs(msg))
  })

  it('defaults the fee token to native APT and its store to the primary store', async () => {
    const view = mock.fn(async (_args: ViewCall) => ['1'])
    const provider = { view } as unknown as Aptos

    await getFee(provider, PACKAGE, DEST, message())

    const args = view.mock.calls[0]!.arguments[0].payload.functionArguments
    assert.equal(args[6], DEFAULT_FEE_TOKEN)
    assert.equal(args[7], '0x0')
  })

  it('keeps an explicit fee token and zero-pads the receiver to 32 bytes', async () => {
    const view = mock.fn(async (_args: ViewCall) => ['1'])
    const provider = { view } as unknown as Aptos
    const feeToken = `0x${'beef'.repeat(8)}`

    await getFee(provider, PACKAGE, DEST, message({ feeToken }))

    const args = view.mock.calls[0]!.arguments[0].payload.functionArguments
    assert.equal(args[6], feeToken)
    const receiver = args[1] as Uint8Array
    assert.equal(receiver.length, 32)
    assert.deepEqual(receiver.subarray(12), getAddressBytes(RECEIVER))
  })

  it('leaves a router that already names its module untouched', async () => {
    const view = mock.fn(async (_args: ViewCall) => ['7'])
    const provider = { view } as unknown as Aptos
    const router = `${PACKAGE}::custom_router`

    assert.equal(await getFee(provider, router, DEST, message()), 7n)
    assert.equal(
      view.mock.calls[0]!.arguments[0].payload.function,
      `${router}::get_fee` as `${string}::${string}::get_fee`,
    )
  })

  it('returns the quote as a bigint even above Number.MAX_SAFE_INTEGER', async () => {
    const view = mock.fn(async (_args: ViewCall) => ['9007199254740993'])
    const provider = { view } as unknown as Aptos

    assert.equal(await getFee(provider, PACKAGE, DEST, message()), 9_007_199_254_740_993n)
  })
})

describe('Aptos generateUnsignedCcipSend', () => {
  function providerWithTx() {
    const simple = mock.fn(async (_args: unknown) => ({ bcsToBytes: () => TX_BYTES }))
    const provider = { transaction: { build: { simple } } } as unknown as Aptos
    return { provider, simple }
  }

  it('builds a ccip_send with the same arguments as the quote', async () => {
    const { provider, simple } = providerWithTx()
    const msg = { ...message(), fee: 1n }

    const unsigned = await generateUnsignedCcipSend(provider, SENDER, PACKAGE, DEST, msg)

    assert.deepEqual(unsigned, TX_BYTES)
    assert.equal(simple.mock.calls.length, 1)
    const args = simple.mock.calls[0]!.arguments[0] as {
      sender: unknown
      data: { function: string; functionArguments: unknown[] }
      options?: { maxGasAmount?: number }
    }
    assert.equal(args.data.function, `${PACKAGE}::router::ccip_send`)
    assert.deepEqual(args.data.functionArguments, expectedArgs(msg))
    assert.equal(args.options, undefined)
  })

  it('passes txGasLimit as maxGasAmount and keeps an explicit module', async () => {
    const { provider, simple } = providerWithTx()
    const router = `${PACKAGE}::custom_router`

    await generateUnsignedCcipSend(
      provider,
      SENDER,
      router,
      DEST,
      { ...message(), fee: 1n },
      { txGasLimit: 42_000 },
    )

    const args = simple.mock.calls[0]!.arguments[0] as {
      data: { function: string }
      options?: { maxGasAmount?: number }
    }
    assert.equal(args.data.function, `${router}::ccip_send`)
    assert.deepEqual(args.options, { maxGasAmount: 42_000 })
  })

  it('serializes token amounts as decimal strings with primary stores', async () => {
    const { provider, simple } = providerWithTx()
    const msg = {
      ...message({
        tokenAmounts: [
          { token: `0x${'aa'.repeat(32)}`, amount: 0n },
          { token: `0x${'bb'.repeat(32)}`, amount: 2n ** 200n },
        ],
      }),
      fee: 1n,
    }

    await generateUnsignedCcipSend(provider, SENDER, PACKAGE, DEST, msg)

    const args = simple.mock.calls[0]!.arguments[0] as {
      data: { functionArguments: unknown[] }
    }
    const [, , , tokens, amounts, stores] = args.data.functionArguments as [
      unknown,
      unknown,
      unknown,
      string[],
      string[],
      string[],
    ]
    assert.deepEqual(tokens, [`0x${'aa'.repeat(32)}`, `0x${'bb'.repeat(32)}`])
    assert.deepEqual(amounts, ['0', (2n ** 200n).toString()])
    assert.deepEqual(stores, ['0x0', '0x0'])
  })
})
