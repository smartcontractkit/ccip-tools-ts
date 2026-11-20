import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { type Interface, type JsonRpcApiProvider, ZeroAddress, getAddress } from 'ethers'

import { networkInfo } from '../networks.ts'
import { type ChainTransaction, CCIPVersion } from '../types.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const SOURCE = networkInfo('ethereum-testnet-sepolia')
const DEST = networkInfo('avalanche-testnet-fuji')

const ONRAMP = '0x1100000000000000000000000000000000000001'
const OFFRAMP = '0x1100000000000000000000000000000000000002'
const COMMIT_STORE = '0x1100000000000000000000000000000000000003'
const PRICE_REGISTRY = '0x1100000000000000000000000000000000000004'
const ROUTER = '0x1100000000000000000000000000000000000005'
const ARM_PROXY = '0x1100000000000000000000000000000000000006'
const RMN = '0x1100000000000000000000000000000000000007'
const LINK = '0x1100000000000000000000000000000000000008'
const SENDER = '0x1100000000000000000000000000000000000009'
const RECEIVER = '0x110000000000000000000000000000000000000a'
const PREV_RAMP = '0x110000000000000000000000000000000000000b'
const MESSAGE_ID = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const TX_HASH = '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'

const onRamp = interfaces.EVM2EVMOnRamp_v1_2
const offRamp = interfaces.EVM2EVMOffRamp_v1_2
const commitStore = interfaces.CommitStore_v1_2
const priceRegistry = interfaces.PriceRegistry_v1_2

type Call = { to?: string | null; data?: string }

/** Adds one exact calldata response to a deterministic eth_call fixture. */
function respond(
  responses: Map<string, string>,
  address: string,
  iface: Interface,
  method: string,
  args: readonly unknown[],
  result: readonly unknown[],
) {
  responses.set(
    `${address.toLowerCase()}:${iface.encodeFunctionData(method, args)}`,
    iface.encodeFunctionResult(method, result),
  )
}

/** Returns encoded responses only. Unknown calls fail the test immediately. */
function makeProvider(responses: Map<string, string>) {
  const calls: Call[] = []
  const provider = {
    call: mock.fn(async (tx: Call) => {
      calls.push(tx)
      const key = `${tx.to?.toLowerCase()}:${tx.data ?? '0x'}`
      const response = responses.get(key)
      if (response === undefined) throw new Error(`unexpected eth_call: ${key}`)
      return response
    }),
  } as unknown as JsonRpcApiProvider
  return { calls, provider }
}

function addOnRampVersion(responses: Map<string, string>) {
  respond(responses, ONRAMP, onRamp, 'typeAndVersion', [], ['EVM2EVMOnRamp 1.2.0'])
}

function addOnRampStaticConfig(responses: Map<string, string>) {
  respond(
    responses,
    ONRAMP,
    onRamp,
    'getStaticConfig',
    [],
    [[LINK, SOURCE.chainSelector, DEST.chainSelector, 200_000n, 1_000n, PREV_RAMP, ARM_PROXY]],
  )
}

describe('EVM v1.2 lane and configuration reads', () => {
  it('reads the destination from the v1.2 OnRamp static config', async () => {
    const responses = new Map<string, string>()
    addOnRampVersion(responses)
    addOnRampStaticConfig(responses)
    const { provider } = makeProvider(responses)
    const chain = new EVMChain(provider, SOURCE)

    assert.deepEqual(await chain.getLaneForOnRamp(ONRAMP), {
      sourceChainSelector: SOURCE.chainSelector,
      destChainSelector: DEST.chainSelector,
      version: CCIPVersion.V1_2,
      onRamp: ONRAMP,
    })
  })

  it('reads the v1.2 OnRamp config and its PriceRegistry state and fee tokens', async () => {
    const responses = new Map<string, string>()
    addOnRampVersion(responses)
    addOnRampStaticConfig(responses)
    respond(
      responses,
      ONRAMP,
      onRamp,
      'getDynamicConfig',
      [],
      [[ROUTER, 5, 10_000, 16, 2_000, 4, 500, PRICE_REGISTRY, 32_768, 500_000]],
    )
    respond(
      responses,
      PRICE_REGISTRY,
      priceRegistry,
      'getDestinationChainGasPrice',
      [DEST.chainSelector],
      [[123_456n, 1_700_000_000]],
    )
    respond(responses, PRICE_REGISTRY, priceRegistry, 'getStalenessThreshold', [], [3_600n])
    respond(responses, PRICE_REGISTRY, priceRegistry, 'typeAndVersion', [], ['PriceRegistry 1.2.0'])
    respond(responses, PRICE_REGISTRY, priceRegistry, 'getFeeTokens', [], [[LINK]])
    const { provider } = makeProvider(responses)
    const chain = new EVMChain(provider, SOURCE)

    const config = await chain.getOnRampConfig(ONRAMP, DEST.chainSelector)

    assert.equal(config.typeAndVersion, 'EVM2EVMOnRamp 1.2.0')
    assert.equal(config.destChainSelector, DEST.chainSelector)
    assert.equal(config.feeQuoter, PRICE_REGISTRY)
    assert.ok('armProxy' in config)
    assert.equal(config.armProxy, ARM_PROXY)
    assert.ok('priceRegistryConfig' in config)
    assert.ok('destChainGasPrice' in config.priceRegistryConfig)
    assert.equal(config.priceRegistryConfig.destChainGasPrice.value, 123_456n)
    assert.ok('stalenessThreshold' in config.priceRegistryConfig)
    assert.equal(config.priceRegistryConfig.stalenessThreshold, 3_600n)

    const tokenInfo = { name: 'Chainlink', symbol: 'LINK', decimals: 18 }
    const getTokenInfo = mock.method(chain, 'getTokenInfo', async () => tokenInfo)
    assert.deepEqual(await chain.getFeeTokens(ONRAMP), { [LINK]: tokenInfo })
    assert.deepEqual(getTokenInfo.mock.calls[0]?.arguments, [LINK])
  })

  it('reads v1.2 OffRamp, CommitStore, and RMN configs for the supported source lane', async () => {
    const responses = new Map<string, string>()
    respond(responses, OFFRAMP, offRamp, 'typeAndVersion', [], ['EVM2EVMOffRamp 1.2.0'])
    respond(
      responses,
      OFFRAMP,
      offRamp,
      'getStaticConfig',
      [],
      [[COMMIT_STORE, DEST.chainSelector, SOURCE.chainSelector, ONRAMP, PREV_RAMP, ARM_PROXY]],
    )
    respond(
      responses,
      OFFRAMP,
      offRamp,
      'getDynamicConfig',
      [],
      [[3_600, ROUTER, PRICE_REGISTRY, 5, 32_768, 300_000]],
    )
    respond(
      responses,
      COMMIT_STORE,
      commitStore,
      'getStaticConfig',
      [],
      [[DEST.chainSelector, SOURCE.chainSelector, ONRAMP, ARM_PROXY]],
    )
    respond(responses, COMMIT_STORE, commitStore, 'getDynamicConfig', [], [[PRICE_REGISTRY]])
    respond(responses, ARM_PROXY, interfaces.RMNProxy, 'getARM', [], [RMN])
    const { provider } = makeProvider(responses)
    const chain = new EVMChain(provider, DEST)

    const config = await chain.getOffRampConfig(OFFRAMP, SOURCE.chainSelector)

    assert.equal(config.typeAndVersion, 'EVM2EVMOffRamp 1.2.0')
    assert.equal(config.sourceChainSelector, SOURCE.chainSelector)
    assert.ok('chainSelector' in config)
    assert.equal(config.chainSelector, DEST.chainSelector)
    assert.ok('commitStore' in config)
    assert.equal(config.commitStore, COMMIT_STORE)
    assert.deepEqual(config.onRamps, [ONRAMP])
    assert.equal(config.rmn, RMN)
  })
})

describe('EVM v1.2 historical message reconstruction', () => {
  it('decodes CCIPSendRequested and resolves its lane for getMessagesInTx', async () => {
    const responses = new Map<string, string>()
    addOnRampVersion(responses)
    addOnRampStaticConfig(responses)
    const { provider } = makeProvider(responses)
    const chain = new EVMChain(provider, SOURCE)
    const fragment = onRamp.getEvent('CCIPSendRequested')!
    const encoded = onRamp.encodeEventLog(fragment, [
      {
        sourceChainSelector: SOURCE.chainSelector,
        sender: SENDER,
        receiver: RECEIVER,
        sequenceNumber: 42n,
        gasLimit: 200_000n,
        strict: false,
        nonce: 7n,
        feeToken: ZeroAddress,
        feeTokenAmount: 123n,
        data: '0xdeadbeef',
        tokenAmounts: [],
        sourceTokenData: [],
        messageId: MESSAGE_ID,
      },
    ])
    const tx: ChainTransaction = {
      hash: TX_HASH,
      logs: [
        {
          address: ONRAMP,
          topics: encoded.topics,
          data: encoded.data,
          blockNumber: 123,
          blockTimestamp: 1_700_000_000,
          transactionHash: TX_HASH,
          index: 0,
        },
      ],
      blockNumber: 123,
      timestamp: 1_700_000_000,
      from: SENDER,
    }

    const requests = await chain.getMessagesInTx(tx)

    assert.equal(requests.length, 1)
    const request = requests[0]!
    assert.deepEqual(request.lane, {
      sourceChainSelector: SOURCE.chainSelector,
      destChainSelector: DEST.chainSelector,
      version: CCIPVersion.V1_2,
      onRamp: ONRAMP,
    })
    assert.equal(request.message.messageId, MESSAGE_ID)
    assert.equal(request.message.sequenceNumber, 42n)
    assert.equal(request.message.data, '0xdeadbeef')
    assert.equal(request.message.receiver, getAddress(RECEIVER))
    assert.equal(request.tx.hash, TX_HASH)
  })
})
