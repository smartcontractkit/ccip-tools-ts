/**
 * Tests for the Aptos chain's ramp config readers and the send/execute routing around them.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'
import { getAddress } from 'ethers'

import { CCIPAptosExtraArgsV2RequiredError, CCIPWalletInvalidError } from '../errors/index.ts'
import '../evm/index.ts' // registers the EVM family, the destination of these messages
import { networkInfo } from '../networks.ts'
import { AptosChain } from './index.ts'

const PACKAGE = '0xc748b8e0c5b7e0e4b4e4b0e1c2d3e4f5a6b7c8d9eabcdef0123456789abcdef0'
const PAYER = `0x${'1'.repeat(64)}`
const EVM_RECEIVER = '0x9eC0e4A4c411493773E01e2ABF4D42395788846b'
const SOURCE_ONRAMP = `0x${'ab'.repeat(20)}`
const DEST = networkInfo('ethereum-testnet-sepolia').chainSelector
const EXTRA_ARGS = { gasLimit: 200_000n, allowOutOfOrderExecution: true }
const TX_BYTES = new Uint8Array([5, 6, 7])

type ViewResult = unknown[] | ((args: unknown[]) => unknown[])

/** An AptosChain whose provider answers only the views a test declares. */
function chainWithViews(views: Record<string, ViewResult>) {
  const view = mock.fn(
    async ({ payload }: { payload: { function: string; functionArguments?: unknown[] } }) => {
      const handler = views[payload.function]
      if (handler === undefined) throw new Error(`unexpected view: ${payload.function}`)
      return typeof handler === 'function' ? handler(payload.functionArguments ?? []) : handler
    },
  )
  const provider = { view, getTransactionByVersion: async () => undefined } as unknown as Aptos
  return { chain: new AptosChain(provider, networkInfo('aptos-testnet')), view }
}

function chainWithSend() {
  const views: Record<string, ViewResult> = { [`${PACKAGE}::router::get_fee`]: ['321'] }
  const simple = mock.fn(async (_args: unknown) => ({ bcsToBytes: () => TX_BYTES }))
  const view = mock.fn(async ({ payload }: { payload: { function: string } }) => {
    const handler = views[payload.function]
    if (handler === undefined) throw new Error(`unexpected view: ${payload.function}`)
    return typeof handler === 'function' ? handler([]) : handler
  })
  const provider = {
    view,
    getTransactionByVersion: async () => undefined,
    transaction: { build: { simple } },
  } as unknown as Aptos
  return { chain: new AptosChain(provider, networkInfo('aptos-testnet')), view, simple }
}

describe('AptosChain ramp configs', () => {
  it('reads the onRamp lane config from the onramp and fee_quoter modules', async () => {
    const { chain, view } = chainWithViews({
      [`${PACKAGE}::onramp::type_and_version`]: ['OnRamp 1.6.0'],
      [`${PACKAGE}::onramp::get_dest_chain_config_v2`]: [
        '7',
        false,
        PACKAGE, // bare router address, no module suffix
        `${PACKAGE}::router_state`,
      ],
      [`${PACKAGE}::fee_quoter::get_static_config`]: [{ maxFeeJuelsPerMsg: '1000' }],
      [`${PACKAGE}::fee_quoter::get_dest_chain_config`]: [{ networkFeeUsdCents: '5' }],
    })

    const config = await chain.getOnRampConfig(`${PACKAGE}::onramp`, DEST)

    assert.equal(config.feeQuoter, `${PACKAGE}::fee_quoter`)
    assert.equal(config.destChainSelector, DEST)
    assert.equal(config.sequenceNumber, 7n)
    assert.equal(config.allowlistEnabled, false)
    assert.equal(config.router, `${PACKAGE}::router`)
    assert.equal(config.routerStateAddress, `${PACKAGE}::router_state`)
    assert.deepEqual(config.feeQuoterConfig, {
      maxFeeJuelsPerMsg: '1000',
      networkFeeUsdCents: '5',
    })
    assert.equal(config.typeAndVersion, 'OnRamp 1.6.0')
    assert.deepEqual(
      view.mock.calls.map((call) => call.arguments[0].payload.function),
      [
        `${PACKAGE}::onramp::type_and_version`,
        `${PACKAGE}::onramp::get_dest_chain_config_v2`,
        `${PACKAGE}::fee_quoter::get_static_config`,
        `${PACKAGE}::fee_quoter::get_dest_chain_config`,
      ],
    )
  })

  it('reads the offRamp source config and decodes its EVM onRamp', async () => {
    const { chain } = chainWithViews({
      [`${PACKAGE}::offramp::type_and_version`]: ['OffRamp 1.6.0'],
      [`${PACKAGE}::offramp::get_source_chain_config`]: [
        { on_ramp: SOURCE_ONRAMP, is_enabled: true, min_seq_nr: '3' },
      ],
    })

    const config = await chain.getOffRampConfig(`${PACKAGE}::offramp`, DEST)

    assert.equal(config.router, `${PACKAGE}::router`)
    assert.equal(config.sourceChainSelector, DEST)
    assert.deepEqual(config.onRamps, [getAddress(SOURCE_ONRAMP)])
    assert.equal(config.typeAndVersion, 'OffRamp 1.6.0')
  })

  it('derives the ramp modules from a bare router package', async () => {
    const { chain } = chainWithViews({})

    assert.deepEqual(await chain.getOffRampsForRouter(`${PACKAGE}::router`, DEST), [
      `${PACKAGE}::offramp`,
    ])
    assert.equal(await chain.getOnRampForRouter(`${PACKAGE}::router`, DEST), `${PACKAGE}::onramp`)
    assert.equal(await chain.getNativeTokenForRouter(PACKAGE), '0xa')
  })
})

describe('AptosChain send routing', () => {
  const message = { receiver: EVM_RECEIVER, extraArgs: EXTRA_ARGS }

  it('quotes through the router and returns the bigint fee', async () => {
    const { chain, view } = chainWithSend()

    assert.equal(await chain.getFee({ router: PACKAGE, destChainSelector: DEST, message }), 321n)

    assert.equal(view.mock.calls.length, 1)
    assert.equal(view.mock.calls[0]!.arguments[0].payload.function, `${PACKAGE}::router::get_fee`)
  })

  it('quotes before building when the message carries no fee', async () => {
    const { chain, view, simple } = chainWithSend()

    const unsigned = await chain.generateUnsignedSendMessage({
      sender: PAYER,
      router: PACKAGE,
      destChainSelector: DEST,
      message,
    })

    assert.deepEqual(unsigned, { family: 'APTOS', transactions: [TX_BYTES] })
    assert.equal(view.mock.calls.length, 1)
    assert.equal(simple.mock.calls.length, 1)
  })

  it('skips the quote when the message already carries a fee', async () => {
    const { chain, view, simple } = chainWithSend()

    await chain.generateUnsignedSendMessage({
      sender: PAYER,
      router: PACKAGE,
      destChainSelector: DEST,
      message: { ...message, fee: 5n },
    })

    assert.equal(view.mock.calls.length, 0)
    assert.equal(simple.mock.calls.length, 1)
  })

  it('rejects a wallet that is not an Aptos account', async () => {
    const { chain } = chainWithSend()
    const opts = {
      router: PACKAGE,
      destChainSelector: DEST,
      message: { ...message, fee: 1n },
      wallet: {} as never,
    }

    await assert.rejects(chain.sendMessage(opts), CCIPWalletInvalidError)
    await assert.rejects(
      chain.execute({
        offRamp: `${PACKAGE}::offramp`,
        input: { message: {}, proofs: [] } as never,
        wallet: {} as never,
      }),
      CCIPWalletInvalidError,
    )
  })
})

describe('AptosChain execute routing', () => {
  const input = {
    message: {
      messageId: `0x${'11'.repeat(32)}`,
      sourceChainSelector: DEST,
      destChainSelector: networkInfo('aptos-testnet').chainSelector,
      sequenceNumber: 7n,
      nonce: 1n,
      sender: `0x${'22'.repeat(20)}`,
      data: '0xdead',
      receiver: `0x${'33'.repeat(32)}`,
      gasLimit: 100_000n,
      tokenAmounts: [],
      strict: true,
    },
    proofs: [],
    proofFlagBits: 0n,
    merkleRoot: `0x${'ee'.repeat(32)}`,
    offchainTokenData: [],
  }

  it('requires the EVMExtraArgsV2 fields execute needs', async () => {
    const { chain, simple } = chainWithSend()

    await assert.rejects(
      chain.generateUnsignedExecute({
        payer: PAYER,
        offRamp: `${PACKAGE}::offramp`,
        input: input as never,
      }),
      CCIPAptosExtraArgsV2RequiredError,
    )
    assert.equal(simple.mock.calls.length, 0)
  })

  it('builds the execute when the message carries the V2 fields', async () => {
    const { chain, simple } = chainWithSend()

    const unsigned = await chain.generateUnsignedExecute({
      payer: PAYER,
      offRamp: `${PACKAGE}::offramp`,
      input: {
        ...input,
        message: { ...input.message, allowOutOfOrderExecution: true },
      } as never,
    })

    assert.deepEqual(unsigned, { family: 'APTOS', transactions: [TX_BYTES] })
    assert.equal(simple.mock.calls.length, 1)
  })
})
