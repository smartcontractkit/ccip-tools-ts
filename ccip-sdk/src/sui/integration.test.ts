import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import {
  findOffRampPackagesByCcipActivity,
  getCcipStateAddress,
  getOffRampForCcip,
} from './discovery.ts'
import { SuiChain } from './index.ts'
import { EVMChain } from '../evm/index.ts'
import { discoverOffRamp } from '../execution.ts'

// Integration tests issue live RPC calls against public endpoints. Sui's public
// JSON-RPC fullnodes were deprecated; the default is BlockVision's public
// gateway, which is archival (the CCIP publish tx is available) but aggressively
// rate-limited — the SDK's adaptive limiter paces through it.
// `https://sui-testnet-rpc.publicnode.com` is faster and fine for reads, but it
// prunes tx contents (offramp discovery via MCMS upgrade scan can't enumerate
// created packages there).
// Override via RPC_* env vars.
const SUI_TESTNET_RPC =
  process.env['RPC_SUI_TESTNET'] || 'https://sui-testnet-endpoint.blockvision.org'
const FUJI_RPC = process.env['RPC_FUJI'] || 'https://api.avax-test.network/ext/bc/C/rpc'

// ── Live sui-testnet CCIP deployment (1.6.x) ──
const SUI_SELECTOR = 9762610643973837292n
const FUJI_SELECTOR = 14767482510784806043n
const ARB_SEP_SELECTOR = 3478487238524512106n

const ONRAMP = '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d::onramp'
const CCIP = '0x5ef4b483da6644c84aa78eae4f51a9bfb1fb4554d5134ac98892e931fcbdd6bf::state_object'
const OFFRAMP = '0x01a0a22b2abacbd48e9a026c1661189a8ec5ce4942cba07017b63eaad0a205a4::offramp'

const FUJI_ONRAMP = '0xA5D5B0B844c8f11B61F28AC98BBA84dEA9b80953'
const FUJI_OFFRAMP = '0x3F1f176e347235858DD6Db905DDBA09Eaf25478a'
const ARB_SEP_ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'

// Checkpoints with known CCIPMessageSent events (bounded range with 2 events)
const EVENTS_RANGE = { startBlock: 365_300_000, endBlock: 365_500_000 }
const KNOWN_TX = '6jgbQ1Ey7LowPax1SUdWc184jd6bYKmMrztTcU1YBPTQ' // seq 3, dest fuji
const KNOWN_MESSAGE_ID = '0xcfd84d40bc524ffb7cdbd0ae9867949eed4790ff0a5de1486701b626853879bf'

const skip = !!process.env.SKIP_INTEGRATION_TESTS

describe('SuiChain integration (sui-testnet)', { skip }, () => {
  let chain: SuiChain
  before(async () => {
    chain = await SuiChain.fromUrl(SUI_TESTNET_RPC)
  })

  it('connects and detects sui-testnet', () => {
    assert.equal(chain.network.name, 'sui-testnet')
    assert.equal(chain.network.chainSelector, SUI_SELECTOR)
  })

  it('getBlockInfo returns real checkpoints for tags, depths and numbers', async () => {
    const latest = await chain.getBlockInfo('latest')
    assert.ok(latest.number > EVENTS_RANGE.endBlock, `latest ${latest.number} is a checkpoint`)
    assert.ok(Math.abs(latest.timestamp - Date.now() / 1e3) < 60, 'latest timestamp is recent')

    // Sui checkpoints are finalized once committed
    const finalized = await chain.getBlockInfo('finalized')
    assert.ok(Math.abs(finalized.number - latest.number) < 100)

    const depth = await chain.getBlockInfo(-50)
    assert.ok(depth.number <= latest.number && depth.number > latest.number - 200)
    assert.ok(depth.timestamp <= latest.timestamp)

    const specific = await chain.getBlockInfo(EVENTS_RANGE.startBlock)
    assert.equal(specific.number, EVENTS_RANGE.startBlock)
  })

  it('getLogs streams CCIPMessageSent events over a bounded range', async () => {
    const logs = []
    for await (const log of chain.getLogs({
      address: ONRAMP,
      topics: ['CCIPMessageSent'],
      ...EVENTS_RANGE,
    })) {
      logs.push(log)
    }
    assert.equal(logs.length, 2)
    // ascending checkpoint order
    assert.ok(logs[0]!.blockNumber < logs[1]!.blockNumber)
    // original package reported as log address (not the upgraded one)
    assert.equal(logs[0]!.address, ONRAMP)
    assert.equal(logs[0]!.topics[0], 'CCIPMessageSent')
    assert.ok(logs.every((log) => log.blockTimestamp > 0))

    // decodes as a CCIP message (needs EVM family registered for dest addresses)
    // decodeMessage flattens the header into top-level fields
    const message = SuiChain.decodeMessage(logs[1]!) as unknown as {
      messageId: string
      sequenceNumber: bigint
      destChainSelector: bigint
      sourceChainSelector: bigint
    }
    assert.ok(message)
    assert.equal(message.messageId, KNOWN_MESSAGE_ID)
    assert.equal(message.sequenceNumber, 3n)
    assert.equal(message.destChainSelector, FUJI_SELECTOR)
    assert.equal(message.sourceChainSelector, SUI_SELECTOR)
  })

  it('getLogs resolves startTime to a checkpoint', async () => {
    // event at checkpoint 365409107 has timestamp 1785268891.896
    const logs = []
    for await (const log of chain.getLogs({
      address: ONRAMP,
      topics: ['CCIPMessageSent'],
      startTime: 1_785_268_800,
      endBlock: EVENTS_RANGE.endBlock,
    })) {
      logs.push(log)
    }
    assert.ok(logs.length >= 1)
    assert.ok(logs.every((log) => log.blockTimestamp >= 1_785_268_800))
  })

  it('getTransaction returns events with original package addresses', async () => {
    const tx = await chain.getTransaction(KNOWN_TX)
    assert.ok(tx.logs.length >= 1)
    assert.equal(tx.blockNumber, 365_409_107)
    const ccipLog = tx.logs.find((log) => log.topics[0] === 'CCIPMessageSent')
    assert.ok(ccipLog)
    assert.equal(ccipLog.address, ONRAMP)
  })

  it('discovers ccip package and configs from the onramp', async () => {
    const ccip = await getCcipStateAddress(ONRAMP, chain.client)
    assert.equal(ccip, CCIP)

    const [, version, typeAndVersion] = await chain.typeAndVersion(ONRAMP)
    assert.equal(version, '1.6.0')
    assert.ok(typeAndVersion.startsWith('OnRamp 1.6'))

    const config = await chain.getOnRampConfig(ONRAMP, FUJI_SELECTOR)
    // sui has no usable router contract: the ccip state object is the
    // deployment's router handle, reported for both of its ramps
    assert.equal(config.router, CCIP)
    // fee_quoter is discovered through the ccip package glue
    assert.equal(config.feeQuoter, `${CCIP.split('::')[0]}::fee_quoter`)

    const registry = await chain.getTokenAdminRegistryFor(ONRAMP)
    assert.equal(registry, `${CCIP.split('::')[0]}::token_admin_registry`)
  })

  it('accepts the ccip state object as the router handle for both ramps', async () => {
    // the router reported for either ramp round-trips through every
    // router-taking API, in bare-package or `::state_object` form
    for (const router of [CCIP, CCIP.split('::')[0]!]) {
      assert.equal(await chain.getOnRampForRouter(router, FUJI_SELECTOR), ONRAMP)
      assert.deepEqual(await chain.getOffRampsForRouter(router, FUJI_SELECTOR), [OFFRAMP])
      assert.equal(
        await chain.getTokenAdminRegistryFor(router),
        `${CCIP.split('::')[0]}::token_admin_registry`,
      )
      // getOnRampConfig resolves it too, and reports it back unchanged
      assert.equal((await chain.getOnRampConfig(router, FUJI_SELECTOR)).router, CCIP)
    }
    // ramps are accepted as-is, with or without their module suffix
    for (const ramp of [ONRAMP, ONRAMP.split('::')[0]!]) {
      assert.equal(await chain.getOnRampForRouter(ramp, FUJI_SELECTOR), ONRAMP)
    }
  })

  it('discovers the offramp from ccip activity, without ownership or publish history', async () => {
    // transactions taking the deployment's CCIPObjectRef as an input object name
    // the offramp in their events and PTB calls
    const offramps = await findOffRampPackagesByCcipActivity(CCIP, chain.client)
    assert.deepEqual(offramps, [OFFRAMP])
  })

  it('discovers the offramp through the ccip package (pruned-history fallback)', async () => {
    // public RPCs prune the publish tx; this exercises the MCMS upgrade scan
    const offramp = await getOffRampForCcip(CCIP, chain.client)
    assert.equal(offramp, OFFRAMP)

    const [, , typeAndVersion] = await chain.typeAndVersion(OFFRAMP)
    assert.ok(typeAndVersion.startsWith('OffRamp 1.6'))

    const fujiConfig = await chain.getOffRampConfig(OFFRAMP, FUJI_SELECTOR)
    assert.deepEqual(fujiConfig.onRamps, [FUJI_ONRAMP])
    assert.equal(fujiConfig.isEnabled, true)

    const arbConfig = await chain.getOffRampConfig(OFFRAMP, ARB_SEP_SELECTOR)
    assert.deepEqual(arbConfig.onRamps, [ARB_SEP_ONRAMP])
  })

  it('discoverOffRamp pairs lanes in both directions', async () => {
    const fuji = await EVMChain.fromUrl(FUJI_RPC)
    try {
      const toSui = await discoverOffRamp(fuji, chain, FUJI_ONRAMP)
      assert.equal(toSui, OFFRAMP)

      const fromSui = await discoverOffRamp(chain, fuji, ONRAMP)
      assert.equal(fromSui, FUJI_OFFRAMP)
    } finally {
      fuji.destroy()
    }
  })
})
