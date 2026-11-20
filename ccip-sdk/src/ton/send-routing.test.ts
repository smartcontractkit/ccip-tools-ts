/**
 * Deterministic routing tests for TON sends and fee quotes.
 *
 * A TON fee quote resolves Router → OnRamp → FeeQuoter, and the FeeQuoter
 * needs the WRAPPED_NATIVE sentinel for native GRAM while the Router expects
 * `addr_none`. These tests pin both paths without a live network.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Address } from '@ton/core'
import type { TonClient } from '@ton/ton'

import { EVMChain } from '../evm/index.ts'
import { networkInfo } from '../networks.ts'
import type { AnyMessage } from '../types.ts'
import { DEFAULT_GAS_BUFFER, WRAPPED_NATIVE } from './send.ts'
import { TONChain } from './index.ts'

void EVMChain // register the EVM family for buildMessageForDest

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
const TON_NETWORK = networkInfo('ton-testnet')

const ROUTER = Address.parse('EQDWS-oJCjyrf-6c1wF5eGP7b2qNWn7wUqS3dlNgb_YzKNHG')
const ON_RAMP = Address.parse('EQC-GtbjW4hz_gXOiBOxT0_Jj-EYkI_zjQ-H8VyYHH9fbSd6')
const FEE_QUOTER = Address.parse('EQAoCywn6WT8_R_ydtFzcYlcwWTWXG35w4Zbbhye_u2I0RnI')
const DEST_CHAIN_SELECTOR = 16015286601757825753n // Sepolia
const RECEIVER = '0x40d7c009d073e0d740ed2c50ca0a48c84a3f8b47'

type RunMethodCall = {
  address: Address
  method: string
  params?: readonly Record<string, unknown>[]
}

function clientForFee(fee: bigint, calls: RunMethodCall[] = []): TonClient {
  return {
    runMethod: async (
      address: Address,
      method: string,
      params?: readonly Record<string, unknown>[],
    ) => {
      calls.push({ address, method, params })
      switch (method) {
        case 'onRamp':
          return { stack: { readAddress: () => ON_RAMP } }
        case 'feeQuoter':
          return { stack: { readAddress: () => FEE_QUOTER } }
        case 'validatedFee':
          return { stack: { readBigNumber: () => fee } }
        default:
          throw new Error(`unexpected method ${method}`)
      }
    },
  } as unknown as TonClient
}

function baseMessage(overrides: Partial<AnyMessage> = {}): AnyMessage {
  return {
    receiver: RECEIVER,
    data: '0x1234',
    tokenAmounts: [],
    feeToken: '',
    extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
    ...overrides,
  }
}

function feeTokenOf(call: RunMethodCall): string | null {
  const param = call.params?.[5] as { cell: { beginParse: () => { loadAddress: () => Address } } }
  return param.cell.beginParse().loadAddress().toRawString()
}

describe('TONChain send and fee routing', () => {
  it('quotes through Router → OnRamp → FeeQuoter with the native sentinel', async () => {
    const calls: RunMethodCall[] = []
    const fee = 2_500_000_000n
    const chain = new TONChain(clientForFee(fee, calls), TON_NETWORK, { logger: silentLogger })

    const quoted = await chain.getFee({
      router: ROUTER.toString(),
      destChainSelector: DEST_CHAIN_SELECTOR,
      message: baseMessage(),
    })

    assert.equal(quoted, fee)
    assert.deepEqual(
      calls.map(({ address, method }) => [address.toRawString(), method]),
      [
        [ROUTER.toRawString(), 'onRamp'],
        [ON_RAMP.toRawString(), 'feeQuoter'],
        [FEE_QUOTER.toRawString(), 'validatedFee'],
      ],
    )
    assert.deepEqual(calls[0]!.params, [{ type: 'int', value: DEST_CHAIN_SELECTOR }])
    assert.deepEqual(calls[1]!.params, [{ type: 'int', value: DEST_CHAIN_SELECTOR }])
    const quoteParams = calls[2]!.params!
    assert.equal(quoteParams[0]!['value'], 0n)
    assert.equal(quoteParams[1]!['value'], DEST_CHAIN_SELECTOR)
    assert.equal(feeTokenOf(calls[2]!), WRAPPED_NATIVE.toRawString())
  })

  it('quotes an explicit fee token instead of the native sentinel', async () => {
    const calls: RunMethodCall[] = []
    const feeToken = new Address(0, Buffer.alloc(32, 0xaa))
    const chain = new TONChain(clientForFee(1n, calls), TON_NETWORK, { logger: silentLogger })

    await chain.getFee({
      router: ROUTER.toString(),
      destChainSelector: DEST_CHAIN_SELECTOR,
      message: baseMessage({ feeToken: feeToken.toString() }),
    })

    assert.equal(feeTokenOf(calls[2]!), feeToken.toRawString())
  })

  it('uses the native sentinel for a quote but addr_none in the Router body', async () => {
    const calls: RunMethodCall[] = []
    const fee = 3_000_000_000n
    const chain = new TONChain(clientForFee(fee, calls), TON_NETWORK, { logger: silentLogger })

    const unsigned = await chain.generateUnsignedSendMessage({
      router: ROUTER.toString(),
      destChainSelector: DEST_CHAIN_SELECTOR,
      message: baseMessage(),
      sender: ROUTER.toString(),
    })

    assert.equal(unsigned.family, 'TON')
    assert.equal(unsigned.to, ROUTER.toString())
    assert.equal(unsigned.value, fee + DEFAULT_GAS_BUFFER)

    const slice = unsigned.body.beginParse()
    slice.loadUint(32) // opcode
    slice.loadUint(64) // queryId
    slice.loadUintBig(64) // destChainSelector
    slice.loadBuffer(slice.loadUint(8)) // receiver
    slice.loadRef() // data
    slice.loadRef() // tokenAmounts
    assert.equal(slice.loadMaybeAddress(), null, 'Router body must use addr_none for native GRAM')

    const quoteCalls = calls.filter(({ method }) => method === 'validatedFee')
    assert.equal(quoteCalls.length, 1, 'the quote must run exactly once')
    assert.equal(feeTokenOf(quoteCalls[0]!), WRAPPED_NATIVE.toRawString())
  })

  it('rejects a negative FeeQuoter quote', async () => {
    const chain = new TONChain(clientForFee(-1n), TON_NETWORK, { logger: silentLogger })

    await assert.rejects(
      () =>
        chain.getFee({
          router: ROUTER.toString(),
          destChainSelector: DEST_CHAIN_SELECTOR,
          message: baseMessage(),
        }),
      /Invalid fee/,
    )
  })
})
