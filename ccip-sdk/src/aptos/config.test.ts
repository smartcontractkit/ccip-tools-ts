/**
 * Tests for the Aptos chain's ramp config readers and the send/execute routing around them.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { type Aptos, AccountAddress } from '@aptos-labs/ts-sdk'
import { getAddress, getBytes } from 'ethers'

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
type Resources = Record<string, { type: string; data?: unknown }[]>

/** An AptosChain whose provider answers only the views, resources and modules a test declares. */
function chainWithViews(
  views: Record<string, ViewResult>,
  resources: Resources = {},
  modules: Record<string, string[]> = {},
) {
  const view = mock.fn(
    async ({ payload }: { payload: { function: string; functionArguments?: unknown[] } }) => {
      const handler = views[payload.function]
      // as the node answers for a module that is not published
      if (handler === undefined)
        throw Object.assign(new Error(`unexpected view: ${payload.function}`), {
          data: { error_code: 'module_not_found' },
        })
      return typeof handler === 'function' ? handler(payload.functionArguments ?? []) : handler
    },
  )
  const simple = mock.fn(async (_args: unknown) => ({ bcsToBytes: () => TX_BYTES }))
  const provider = {
    view,
    getAccountResources: async ({ accountAddress }: { accountAddress: string }) => {
      if (!resources[accountAddress]) throw new Error(`Account not found: ${accountAddress}`)
      return resources[accountAddress]
    },
    getAccountModules: async ({ accountAddress }: { accountAddress: string }) =>
      (modules[accountAddress] ?? []).map((name) => ({ abi: { name } })),
    getTransactionByVersion: async () => undefined,
    transaction: { build: { simple } },
  } as unknown as Aptos
  return { chain: new AptosChain(provider, networkInfo('aptos-testnet')), view, simple }
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
      [`${PACKAGE}::fee_quoter::type_and_version`]: ['FeeQuoter 1.6.0'],
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
    // a 1.6 OnRamp's address is its module: no `contract`
    assert.equal(config.contract, undefined)
    assert.deepEqual(
      view.mock.calls.map((call) => call.arguments[0].payload.function),
      [
        `${PACKAGE}::fee_quoter::type_and_version`,
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
    const { chain } = chainWithViews({
      [`${PACKAGE}::fee_quoter::type_and_version`]: ['FeeQuoter 1.6.0'],
      [`${PACKAGE}::onramp::type_and_version`]: ['OnRamp 1.6.0'],
    })

    assert.deepEqual(await chain.getOffRampsForRouter(`${PACKAGE}::router`, DEST), [
      `${PACKAGE}::offramp`,
    ])
    assert.equal(await chain.getOnRampForRouter(`${PACKAGE}::router`, DEST), `${PACKAGE}::onramp`)
    assert.equal(await chain.getNativeTokenForRouter(PACKAGE), '0xa')
  })
})

/** CCIP 2.0: every contract is a package of its own, and keeps its state at another address. */
const ROUTER = `0x${'a1'.repeat(32)}`
const ONRAMP = `0x${'b1'.repeat(32)}`
const ONRAMP_STATE = `0x${'b2'.repeat(32)}`
const OFFRAMP = `0x${'c1'.repeat(32)}`
const OFFRAMP_STATE = `0x${'c2'.repeat(32)}`
const CORE = `0x${'d1'.repeat(32)}`
const POOL = `0x${'f1'.repeat(32)}`
const POOL_1_6 = `0x${'f2'.repeat(32)}`
const TOKEN = `0x${'7a'.repeat(32)}`
const CCV = `0x${'e1'.repeat(32)}`
const DEST_OFFRAMP = '0x6D817BB162b36be1Cf33b55977a9Fc8BD18a342c'
const ALLOWED_HASH = `0x${'66'.repeat(32)}`
const APTOS = networkInfo('aptos-testnet').chainSelector
// the encoded MessageV1 of the aborted `offramp::execute` of aptos-testnet tx version 466258314
const ENCODED_MESSAGE =
  '0x01de41ba4fc9d91ad90a5053ee33c1a91500000000000000040004c2b600030d400000000095e41fa56ad068dc59dec9283d06c3c2e211a35b636ca99a9eb1d30ddb1ae46b2000000000000000000000000082c5bace65956959076ee14074c7551b345e48352062f92b897b1bd2351a59a229ac895f95909d621ab22e12ac71a7b62792dd7d8620000000000000000000000000f1073ece452b9ca3b9a71014db3c8ea7cb510e07208492fcf6d9905bb0f89d155a64d94983cf84a062798337561c4b1c2e87955f86000000c70100000000000000000000000000000000000000000000000000038d7ea4c68000200000000000000000000000009388c0436d77112c49c94cad913b918dbb40cc1520000000000000000000000000ce009f314e8c1f3be6c36d0365b466db4386ed5020ea06209e4f7d5d9923144bd6bdcc992dc149a69488b6a500db4b8cb3d3e25608208492fcf6d9905bb0f89d155a64d94983cf84a062798337561c4b1c2e87955f8600200000000000000000000000000000000000000000000000000000000000000012000a68656c6c6f2d63636970'

/** The PackageRegistry of a 2.0 package with one module, which depends on the core package. */
const DEPS = [{ package_name: 'ChainlinkCCIP', account: CORE }]
const packageOf = (name: string) => [
  { type: '0x1::code::PackageRegistry', data: { packages: [{ modules: [{ name }], deps: DEPS }] } },
]
const V2_RESOURCES: Resources = {
  [ROUTER]: packageOf('router'),
  [ONRAMP]: packageOf('onramp'),
  [ONRAMP_STATE]: [{ type: `${ONRAMP}::onramp::OnRampState` }],
  [OFFRAMP]: packageOf('offramp'),
  [OFFRAMP_STATE]: [{ type: `${OFFRAMP}::offramp::OffRampState` }],
  [POOL]: packageOf('managed_token_pool_v2'),
}
const DEST_CHAIN_CONFIG = {
  router: ROUTER,
  off_ramp_address: DEST_OFFRAMP.toLowerCase(),
  default_ccvs: [CCV],
  brand_new_field: 'kept', // a field this SDK does not know
}
const V2_VIEWS: Record<string, ViewResult> = {
  [`${ROUTER}::router::get_on_ramp`]: [ONRAMP],
  [`${ONRAMP}::onramp::type_and_version`]: ['OnRamp 2.0.0'],
  [`${ONRAMP}::onramp::get_state_address`]: [ONRAMP_STATE],
  [`${ONRAMP}::onramp::get_static_config`]: [{ chain_selector: String(APTOS) }],
  [`${ONRAMP}::onramp::get_dynamic_config`]: [{ fee_aggregator: CCV }],
  [`${ONRAMP}::onramp::get_dest_chain_config`]: (args) =>
    args[0] === DEST ? [DEST_CHAIN_CONFIG] : fail('E_UNKNOWN_DEST_CHAIN')(),
  [`${ONRAMP}::onramp::get_expected_next_message_number`]: ['8'],
  [`${ONRAMP}::onramp::get_all_dest_chain_configs`]: [[String(DEST)], [DEST_CHAIN_CONFIG]],
  [`${CORE}::fee_quoter::type_and_version`]: ['FeeQuoter 2.0.0'],
  [`${CORE}::fee_quoter::get_static_config`]: [{ link_token: CCV }],
  [`${CORE}::fee_quoter::get_dest_chain_config`]: [{ max_data_bytes: 30000 }],
  [`${CORE}::auth::get_allowed_onramps`]: [[ONRAMP_STATE]],
  [`${CORE}::auth::get_allowed_offramps`]: [[OFFRAMP_STATE]],
  [`${OFFRAMP}::offramp::type_and_version`]: ['OffRamp 2.0.0'],
  [`${OFFRAMP}::offramp::get_state_address`]: [OFFRAMP_STATE],
  [`${OFFRAMP}::offramp::get_source_chain_config`]: [
    {
      __variant__: 'V1',
      allowed_on_ramp_hashes: [ALLOWED_HASH],
      is_enabled: true,
      on_ramps: [`0x${'0'.repeat(24)}${SOURCE_ONRAMP.slice(2)}`],
    },
  ],
}
const fail = (message: string) => (): never => {
  throw new Error(message)
}
const v2Chain = (views: Record<string, ViewResult> = {}) =>
  chainWithViews({ ...V2_VIEWS, ...views }, V2_RESOURCES, {
    [POOL]: ['managed_token_pool', 'managed_token_pool_v2', 'ownable'],
    [POOL_1_6]: ['burn_mint_token_pool'],
  })

describe('AptosChain CCIP 2.0', () => {
  it('resolves any form of address: module, core package, ramps of a Router', async () => {
    const { chain } = v2Chain({
      [`${PACKAGE}::offramp::type_and_version`]: ['OffRamp 1.6.0'],
      [`${PACKAGE}::fee_quoter::type_and_version`]: ['FeeQuoter 1.6.0'],
    })

    assert.equal(await chain._getModule(`${ONRAMP}::onramp`), `${ONRAMP}::onramp`)
    assert.equal(await chain._getModule(PACKAGE, 'offramp'), `${PACKAGE}::offramp`)
    assert.equal(await chain._getModule(OFFRAMP_STATE, 'offramp'), `${OFFRAMP}::offramp`)
    // a 2.0 package without a `router` module: its PackageRegistry names its module
    assert.equal(await chain._getModule(ONRAMP), `${ONRAMP}::onramp`)
    await assert.rejects(chain._getModule(`0x${'99'.repeat(32)}`), /unexpected view: 0x9+::router/)

    assert.equal(await chain._getCcipPackage(`${PACKAGE}::onramp`), PACKAGE)
    assert.equal(await chain._getCcipPackage(`${ONRAMP}::onramp`), CORE)
    assert.equal(await chain._getCcipPackage(ONRAMP_STATE), CORE)

    assert.equal(await chain.getOnRampForRouter(ROUTER, DEST), ONRAMP_STATE)
    assert.deepEqual(await chain.getOffRampsForRouter(`${ROUTER}::router`, DEST), [OFFRAMP_STATE])
  })

  it('reads the onRamp config: every config of the lane, merged', async () => {
    const { chain } = v2Chain()

    // the OnRamp's address is its state's, for every form of the input
    assert.deepEqual(await chain.getOnRampConfig(ONRAMP, DEST), {
      onRamp: ONRAMP_STATE,
      contract: `${ONRAMP}::onramp`,
      feeQuoter: `${CORE}::fee_quoter`,
      destChainSelector: DEST,
      chainSelector: APTOS,
      feeAggregator: CCV,
      router: `${ROUTER}::router`,
      offRampAddress: DEST_OFFRAMP,
      defaultCcvs: [CCV],
      brandNewField: 'kept',
      expectedNextMessageNumber: 8n,
      feeQuoterConfig: { linkToken: CCV, maxDataBytes: 30000 },
      typeAndVersion: 'OnRamp 2.0.0',
    })
    await assert.rejects(chain.getOnRampConfig(ONRAMP, APTOS), /E_UNKNOWN_DEST_CHAIN/)

    // only the dest chain config is required
    const missing = v2Chain({ [`${ONRAMP}::onramp::get_static_config`]: fail('no such view') })
    const config = await missing.chain.getOnRampConfig(ONRAMP, DEST)
    assert.equal('chainSelector' in config, false)
  })

  it('reads the offRamp config, and finds its Router through the allowed OnRamps', async () => {
    const { chain } = v2Chain()

    assert.deepEqual(await chain.getOffRampConfig(`${OFFRAMP}::offramp`, DEST), {
      offRamp: OFFRAMP_STATE,
      contract: `${OFFRAMP}::offramp`,
      sourceChainSelector: DEST,
      __variant__: 'V1',
      allowedOnRampHashes: [ALLOWED_HASH],
      isEnabled: true,
      onRamps: [getAddress(SOURCE_ONRAMP)],
      router: `${ROUTER}::router`,
      typeAndVersion: 'OffRamp 2.0.0',
    })
  })

  it('reads tokens from the v2 and 1.6 registries', async () => {
    const [OTHER, THIRD] = [`0x${'7b'.repeat(32)}`, `0x${'7c'.repeat(32)}`]
    const registry = `${CORE}::token_admin_registry`
    const { chain } = v2Chain({
      [`${registry}_v2::type_and_version`]: ['TokenAdminRegistry 2.0.0'],
      [`${registry}_v2::get_token_config`]: [POOL, CCV, '0x0'],
      [`${registry}::get_token_config`]: ['0x0', '0x0', '0x0'],
      [`${registry}_v2::get_all_configured_tokens`]: ([key]) =>
        key === '0x0' ? [[TOKEN], TOKEN, true] : [[OTHER], OTHER, false],
      [`${registry}::get_all_configured_tokens`]: [[OTHER, THIRD], THIRD, false],
    })

    assert.equal(await chain.getTokenAdminRegistryFor(ROUTER), `${registry}_v2`)
    assert.deepEqual(await chain.getRegistryTokenConfig(`${registry}_v2`, TOKEN), {
      administrator: CCV,
      tokenPool: POOL,
    })
    assert.deepEqual(await chain.getSupportedTokens(ROUTER, { page: 1 }), [TOKEN, OTHER, THIRD])

    // only the node's answer that the v2 module is not published selects the 1.6 registry alone
    const v1_6 = chainWithViews({
      [`${PACKAGE}::fee_quoter::type_and_version`]: ['FeeQuoter 1.6.0'],
      [`${PACKAGE}::token_admin_registry::type_and_version`]: ['TokenAdminRegistry 1.6.0'],
    })
    assert.equal(
      await v1_6.chain.getTokenAdminRegistryFor(PACKAGE),
      `${PACKAGE}::token_admin_registry`,
    )
    const failed = v2Chain({ [`${registry}_v2::type_and_version`]: fail('Too Many Requests') })
    await assert.rejects(failed.chain.getTokenAdminRegistryFor(ROUTER), /Too Many Requests/)
  })

  it('reads a 2.0 token pool, with its fast-finality buckets, and a 1.6 one', async () => {
    const v2Pool = `${POOL}::managed_token_pool_v2`
    const v1_6Pool = `${POOL_1_6}::burn_mint_token_pool`
    const remotes = (module: string, buckets: ViewResult) => ({
      [`${module}::get_token`]: [TOKEN],
      [`${module}::get_remote_token`]: [SOURCE_ONRAMP],
      [`${module}::get_remote_pools`]: [[]],
      [`${module}::get_current_inbound_rate_limiter_state`]: buckets,
      [`${module}::get_current_outbound_rate_limiter_state`]: buckets,
    })
    const state = { capacity: '10', last_updated: '1', rate: '2', tokens: '3' }
    const { chain } = v2Chain({
      [`${v2Pool}::type_and_version`]: ['ManagedTokenPool 2.0.0'],
      [`${v2Pool}::get_allowed_finality_config`]: [0x10005],
      // a 2.0 pool has two buckets per direction: normal (false) and fast (true)
      ...remotes(v2Pool, (args) => {
        if (args.length < 2) throw new Error('Too few arguments')
        return [{ ...state, is_enabled: args[1] === true }]
      }),
      [`${v1_6Pool}::type_and_version`]: ['BurnMintTokenPool 1.6.0'],
      [`${v1_6Pool}::get_router`]: [PACKAGE],
      [`${v1_6Pool}::get_supported_chains`]: [[String(DEST)]],
      ...remotes(v1_6Pool, [{ is_enabled: false }]),
    })

    // the v2 module first; it names no Router: the Router of the lanes
    assert.deepEqual(await chain.getTokenPoolConfig(POOL), {
      token: TOKEN,
      router: ROUTER,
      typeAndVersion: 'ManagedTokenPool 2.0.0',
      finalitySafe: true,
      finalityDepth: 5,
    })
    const bucket = { capacity: 10n, lastUpdated: 1, rate: 2n, tokens: 3n }
    const remote = {
      remoteToken: getAddress(SOURCE_ONRAMP),
      remotePools: [],
      inboundRateLimiterState: null,
      outboundRateLimiterState: null,
    }
    assert.deepEqual(await chain.getTokenPoolRemotes(POOL, DEST), {
      'ethereum-testnet-sepolia': {
        ...remote,
        fastInboundRateLimiterState: bucket,
        fastOutboundRateLimiterState: bucket,
      },
    })

    assert.deepEqual(await chain.getTokenPoolConfig(POOL_1_6), {
      token: TOKEN,
      router: PACKAGE,
      typeAndVersion: 'BurnMintTokenPool 1.6.0',
    })
    assert.deepEqual(await chain.getTokenPoolRemotes(POOL_1_6), {
      'ethereum-testnet-sepolia': remote,
    })
  })

  it('reads the CCV policy of a message from the offRamp', async () => {
    const [LONG_CCV, SHORT_CCV] = [`0x00${'e3'.repeat(31)}`, `0x${'e3'.repeat(31)}`]
    const { chain } = v2Chain({
      [`${OFFRAMP}::offramp::get_ccvs_for_message`]: ([encoded]) =>
        String(encoded) === '1,2,3,4' ? [[LONG_CCV], [], 0] : [],
    })
    ;(chain as { apiClient: unknown }).apiClient = null

    const verifications = await chain.getVerifications({
      offRamp: OFFRAMP_STATE,
      request: {
        lane: { sourceChainSelector: DEST, destChainSelector: APTOS, onRamp: '', version: '2.0.0' },
        message: { messageId: `0x${'56'.repeat(32)}`, encodedMessage: '0x01020304' },
        log: { blockTimestamp: 1 },
      } as never,
      ccvData: { [LONG_CCV]: '0xabcd' },
      indexer: [],
    })

    assert.deepEqual(verifications, {
      verificationPolicy: { requiredCCVs: [SHORT_CCV], optionalCCVs: [], optionalThreshold: 0 },
      verifications: [{ ccvData: '0xabcd', destAddress: SHORT_CCV, sourceAddress: '' }],
    })
  })

  it('builds the execute of a message with its verifications', async () => {
    const { chain, simple } = v2Chain()

    await chain.generateUnsignedExecute({
      payer: PAYER,
      offRamp: OFFRAMP_STATE,
      input: {
        encodedMessage: ENCODED_MESSAGE,
        verifications: [{ destAddress: CCV, ccvData: '0xabcd', sourceAddress: '' }],
      } as never,
    })

    type Built = { data: { function: string; functionArguments: unknown[] }; options: unknown }
    const { data, options } = simple.mock.calls[0]!.arguments[0] as Built
    assert.equal(data.function, `${OFFRAMP}::offramp::execute`)
    assert.deepEqual(data.functionArguments, [
      getBytes(ENCODED_MESSAGE),
      [AccountAddress.from(CCV)],
      [getBytes('0xabcd')],
      0,
    ])
    // the gas of the transaction defaults to the message's execution gas limit
    assert.deepEqual(options, { maxGasAmount: 311990 })
  })

  it('keeps the module of a log, and matches receipts by any form of the OffRamp', async () => {
    const { chain } = v2Chain()
    const log = {
      address: `${OFFRAMP}::offramp`,
      topics: ['ExecutionStateChanged'],
      index: 0,
      blockNumber: 10,
      blockTimestamp: 1,
      transactionHash: `0x${'34'.repeat(32)}`,
      data: { message_id: `0x${'12'.repeat(32)}`, message_number: '7', state: 2 },
    }
    const tx = {
      hash: log.transactionHash,
      blockNumber: 10,
      timestamp: 1,
      from: PAYER,
      logs: [log],
    }

    // a log carries the module which emits it, also for a 2.0 ramp
    const hash = `0x${'56'.repeat(32)}`
    Object.assign(chain.provider, {
      getTransactionByHash: async () => ({
        type: 'user_transaction',
        hash,
        version: '10',
        timestamp: '1000000',
        sender: PAYER,
        success: true,
        vm_status: 'Executed successfully',
        events: [
          { type: `${ONRAMP}::onramp::CCIPMessageSent`, data: {} },
          { type: '0x1::transaction_fee::FeeStatement', data: {} },
        ],
      }),
    })
    assert.deepEqual(
      (await chain.getTransaction(hash)).logs.map(({ address }) => address),
      [`${ONRAMP}::onramp`, '0x1::transaction_fee'],
    )

    // the filter takes every form of the OffRamp; the log keeps its module
    for (const offRamp of [OFFRAMP_STATE, OFFRAMP, `${OFFRAMP}::offramp`]) {
      const executions = await chain.getExecutionReceiptsInTx(tx, { offRamp })
      assert.deepEqual(
        executions.map(({ receipt, log }) => [receipt.sequenceNumber, log.address]),
        [[7n, `${OFFRAMP}::offramp`]],
      )
    }
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
