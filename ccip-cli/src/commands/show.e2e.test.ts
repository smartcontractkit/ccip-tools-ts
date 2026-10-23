import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPAPIClient, MessageStatus } from '@chainlink/ccip-sdk/src/index.ts'

import { useResourceForDescribe } from '../../../scripts/useResource.ts'
import {
  APTOS_TESTNET_RPCS,
  BASE_MAINNET_RPCS,
  BASE_SEPOLIA_RPCS,
  BSC_TESTNET_RPCS,
  FUJI_RPCS,
  POLYGON_MAINNET_RPCS,
  SEPOLIA_RPCS,
  SOLANA_DEVNET_RPCS,
  TON_TESTNET_RPCS,
  spawnCLI,
} from './e2e-helpers.test.ts'

// Locks are held per describe block (useResourceForDescribe) and each
// invocation is pointed only at the endpoints of its own lane (see
// e2e-helpers.test.ts) — so this suite no longer queues other suites on the
// sepolia/fuji hub locks for its whole file lifetime. It still uses sepolia
// (dest of the Solana->EVM and Aptos->EVM fixtures) and fuji (source of the
// Solana v2 one), which have no live alternative counterpart, but only while
// those blocks actually run. `show` also resolves 32-byte ids through the
// default CCIP API, and the format variants pick their fixture through it at
// runtime (selectFreshQuietLaneFixture) — one or two calls per invocation plus
// a handful more, once per file, all far below any rate limit, so it does not
// take the `api` lock that the API-heavy SDK suites contend on. The TON block
// picks its fixture the same way (selectFreshTonFixture) and locks ton-testnet
// and sepolia while either direction runs.
//
// Per-test spawn timeouts are kept 30s under the test timeout: spawnCLI's
// rejection carries the child's captured output, so a hung endpoint surfaces
// as a diagnosable failure instead of an opaque "test timed out".

function buildShowArgs(txHash: string, rpcs: string[], ...additionalArgs: string[]): string[] {
  return ['show', txHash, '--rpc', ...rpcs, '--rpcs-file', '', ...additionalArgs]
}

// bsc-testnet (chainId 97) and base-sepolia (chainId 84532) CCIP chain selectors.
const BSC_TESTNET_SELECTOR = 13264668187771770619n
const BASE_SEPOLIA_SELECTOR = 10344971235874465080n

// The fixture must stay younger than this: the dest-side receipt scan derives its
// start block from the send timestamp, and for older sends that probe goes past the
// base-sepolia endpoints' earliest retained block (error 4444, "pruned history
// unavailable").
const QUIET_FIXTURE_MAX_AGE_MS = 48 * 3600_000

/**
 * Picks a recent executed send on the bsc-testnet -> base-sepolia lane through the
 * same default CCIP API the CLI resolves ids with. Only SUCCESS messages qualify (the
 * variants need an on-chain receipt), and only single-message transactions (a
 * multi-message tx takes `show`'s "display all" early return, which never prints the
 * commit/receipt sections these tests assert on).
 */
async function selectFreshQuietLaneFixture() {
  const api = CCIPAPIClient.fromUrl(undefined, {
    // keep the test output clean; real problems still surface
    logger: { debug: () => {}, info: () => {}, warn: console.warn, error: console.error },
  })
  const page = await api.searchMessages(
    { sourceChainSelector: BSC_TESTNET_SELECTOR, destChainSelector: BASE_SEPOLIA_SELECTOR },
    { limit: 50 },
  )
  for (const msg of page.data) {
    if (msg.status !== MessageStatus.Success) continue
    if (Date.now() - Date.parse(msg.sendTimestamp) > QUIET_FIXTURE_MAX_AGE_MS) continue
    const inTx = await api.searchMessages(
      { sourceTransactionHash: msg.sendTransactionHash },
      { limit: 2 },
    )
    if (inTx.data.length !== 1) continue
    const { sendTransactionHash: txHash, messageId, sender, receiver } = msg
    return { txHash, messageId, sender, receiver }
  }
  throw new Error(
    `no single-message SUCCESS send younger than 48h among the CCIP API's ${page.data.length} ` +
      'newest bsc-testnet -> base-sepolia sends',
  )
}

describe('e2e command show EVM', () => {
  // base -> polygon, v1.5. Carries the pair this test exists for: a receipt that
  // failed with TokenHandlingError followed by a successful re-execution.
  const TX_HASH = '0x06a9dc0922e6c0b91b3944df5642a74add3fa76c88be6380652d9c14a5e809c4'
  const MESSAGE_ID = '0x0819adc396d212cd0a01d6ff177e83339707fe6785e4622daee4089ec9592055'
  const SENDER = '0xd7ca08eC1AEe9ccE8a8eDa9365343eF197674e1a'
  const RECEIVER = '0xd7ca08eC1AEe9ccE8a8eDa9365343eF197674e1a'
  const ONRAMP = '0xd3Bde678BB706Cf727A512515C254BcF021dD203'
  // Unlike the previous fixture, this message was sent THROUGH a contract, so
  // origin (the EOA that sent the tx) differs from sender (the CCIP sender).
  const ORIGIN = '0xcF57BFBC6e4aCDa88147634148aB17Cbbe875ee4'

  // Quiet lane for the format variants below: they re-run the SAME scan-heavy
  // `show` flow as the pretty-format test above and only assert on output shape.
  // The fixture is selected at RUNTIME (see selectFreshQuietLaneFixture): a pinned
  // send ages out of base-sepolia's pruned history within days. bsc-testnet ->
  // base-sepolia is v2.0 with steady traffic, and both sides ride CI-reachable
  // keyless endpoints. (The previous soneium -> astar lane answered fine from a
  // residential IP but hung outright from CI's egress.)
  let quietFixture$: ReturnType<typeof selectFreshQuietLaneFixture> | undefined
  const quietFixture = () => (quietFixture$ ??= selectFreshQuietLaneFixture())

  describe('pretty format (default)', () => {
    useResourceForDescribe(['base-mainnet', 'polygon-mainnet'])

    it(
      'should show complete CCIP transaction details EVM to EVM',
      { timeout: 120000 },
      async () => {
        const args = buildShowArgs(TX_HASH, [...BASE_MAINNET_RPCS, ...POLYGON_MAINNET_RPCS])
        const result = await spawnCLI(args, 90000)

        assert.equal(result.exitCode, 0, result.stderr)
        const output = result.stdout

        // Lane information
        assert.match(output, /name.*ethereum-mainnet-base-1.*polygon-mainnet/i)
        assert.match(output, /chainId.*8453.*137/)
        assert.match(output, /chainSelector.*15971525489660198786n?.*4051577828743386545n?/)
        assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.5\\.0`, 'i'))

        // Request information
        assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
        assert.match(output, new RegExp(`origin.*${ORIGIN}`, 'i'))
        assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
        assert.match(output, /sequenceNumber.*8944n?/)
        assert.match(output, /nonce.*18n?/)
        assert.match(output, /gasLimit.*0n?/)
        assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
        assert.match(output, /logIndex.*441/)
        assert.match(output, /blockNumber.*50495330/)
        assert.match(output, /timestamp/)
        assert.match(output, /finalized.*true/)
        assert.match(output, /fee.*0\.000109586074487049\s+WETH/)
        assert.match(output, /tokens.*24031\.708326310761979428\s+LYP/)
        assert.match(output, /data.*0x/)

        // Commit information
        assert.match(output, /Commit.*dest/i)
        assert.match(output, new RegExp(`merkleRoot.*${MESSAGE_ID}`, 'i'))
        assert.match(output, /min.*8944/)
        assert.match(output, /max.*8944/)
        assert.match(output, /origin.*0xcF57BFBC6e4aCDa88147634148aB17Cbbe875ee4/i)
        assert.match(output, /contract.*0x936A0C8635D7087a2D22494762e9a697C3C3D545/i)
        assert.match(
          output,
          /transactionHash.*0xf383450305698c64320574d46140910dba767420737a395a87f34306c4c523fd/i,
        )
        assert.match(output, /blockNumber.*92717489/)
        assert.match(output, /timestamp.*after request/)

        // Receipts information
        assert.match(output, /Receipts.*dest/i)

        // First receipt - failed with TokenHandlingError
        assert.match(output, /state.*failed/i)
        assert.match(output, /TokenHandlingError/)
        assert.match(output, /err.*0x/)
        assert.match(output, /contract.*0xF4a9Dbb7f3FBa02e3a244B464e459C32B63857F1/i)
        assert.match(
          output,
          /transactionHash.*0x7a4016d9169155e7c9bae164cd8833f585207d49cf5b9e1a11ff1faf66fbfda6/i,
        )
        assert.match(output, /logIndex.*256/)
        assert.match(output, /blockNumber.*92717513/)

        // Second receipt - successful
        assert.match(output, /state.*success/i)
        assert.match(output, new RegExp(`origin.*${ORIGIN}`, 'i'))
        assert.match(output, /contract.*0xF4a9Dbb7f3FBa02e3a244B464e459C32B63857F1/i)
        assert.match(
          output,
          /transactionHash.*0x8ebe004dd18907edacfdfb5e204328cb42a1640d359d91bd86f775a93384fe8f/i,
        )
        assert.match(output, /logIndex.*130/)
        assert.match(output, /blockNumber.*92717536/)

        // Verify we have both failed and successful executions
        const failedMatches = output.match(/failed/gi) || []
        const successMatches = output.match(/success/gi) || []
        assert.ok(failedMatches.length >= 1)
        assert.ok(successMatches.length >= 1)
      },
    )
  })

  // The three variants below share the quiet lane's locks and endpoints.
  const QUIET_LANE_RPCS = [...BSC_TESTNET_RPCS, ...BASE_SEPOLIA_RPCS]

  describe('json format', () => {
    useResourceForDescribe(['bsc-testnet', 'base-sepolia'])

    it(
      'should output a single valid JSON envelope with all expected fields',
      { timeout: 120000 },
      async () => {
        const fixture = await quietFixture()
        const args = buildShowArgs(fixture.txHash, QUIET_LANE_RPCS, '--format', 'json')
        const result = await spawnCLI(args, 90000)

        assert.equal(result.exitCode, 0, result.stderr)

        // Should be a single parseable JSON envelope
        const envelope = JSON.parse(result.stdout)

        // Request
        assert.ok(envelope.request, 'envelope should contain request')
        assert.ok(envelope.request.message, 'request should have message')
        assert.match(envelope.request.message.messageId, new RegExp(fixture.messageId, 'i'))
        assert.match(envelope.request.message.sender, new RegExp(fixture.sender, 'i'))
        assert.match(envelope.request.message.receiver, new RegExp(fixture.receiver, 'i'))
        assert.ok(
          'sequenceNumber' in envelope.request.message,
          'message should have sequenceNumber',
        )

        // Verifications (CCV attestations) — the fixture is a v2.0 lane, and tx-hash
        // inputs always resolve through the RPC scan (the API's /v2/messages/{id}
        // only accepts message ids), which computes them
        assert.ok(envelope.verifications, 'envelope should contain verifications')
        assert.match(JSON.stringify(envelope.verifications), /"ccvData"/)

        // Receipts
        assert.ok(Array.isArray(envelope.receipts), 'envelope.receipts should be an array')
        assert.ok(envelope.receipts.length >= 1, 'should have at least one receipt')
      },
    )
  })

  describe('log format', () => {
    useResourceForDescribe(['bsc-testnet', 'base-sepolia'])

    it('should output in log format with object assignments', { timeout: 120000 }, async () => {
      const fixture = await quietFixture()
      const args = buildShowArgs(fixture.txHash, QUIET_LANE_RPCS, '--format', 'log')
      const result = await spawnCLI(args, 90000)

      assert.equal(result.exitCode, 0, result.stderr)

      // Log format should contain assignment operators
      assert.match(result.stdout, /message.*=/)
      assert.match(result.stdout, /commit.*=/)
      assert.match(result.stdout, /receipt.*=/)

      // Should contain expected data
      assert.match(result.stdout, new RegExp(fixture.messageId, 'i'))
      assert.match(result.stdout, new RegExp(fixture.sender, 'i'))
      assert.match(result.stdout, new RegExp(fixture.receiver, 'i'))
    })
  })

  describe('verbose flag', () => {
    useResourceForDescribe(['bsc-testnet', 'base-sepolia'])

    it('should work with verbose flag enabled', { timeout: 120000 }, async () => {
      const fixture = await quietFixture()
      const args = buildShowArgs(fixture.txHash, QUIET_LANE_RPCS, '--verbose')
      const result = await spawnCLI(args, 90000)

      assert.equal(result.exitCode, 0, result.stderr)
      assert.ok(result.stdout.length > 0)

      // Should still contain main output
      assert.match(result.stdout, /Lane/)
      assert.match(result.stdout, /Request/)
      assert.match(result.stdout, new RegExp(fixture.messageId, 'i'))
    })
  })

  describe('error handling', () => {
    describe('invalid transaction hash', () => {
      useResourceForDescribe(['bsc-testnet', 'base-sepolia'])

      it('should handle invalid transaction hash gracefully', { timeout: 150000 }, async () => {
        const invalidTxHash = '0x0000000000000000000000000000000000000000000000000000000000000000'
        // Two endpoints are plenty for this path: the CLI must hear "not found"
        // back from EVERY raced endpoint before it can conclude the tx is
        // nowhere, so each extra endpoint is another chance to hang on a
        // dead one (which is exactly how this test used to time out in CI).
        const args = buildShowArgs(invalidTxHash, [BSC_TESTNET_RPCS[0]!, BASE_SEPOLIA_RPCS[1]!])
        // "Not found" needs a final answer from every raced request, and the SDK bounds
        // one EVM request (all retries included) at 90s: under a 429 burst, a spawn
        // timeout below that bound kills a CLI that would still exit cleanly.
        const result = await spawnCLI(args, 120000)

        // Should exit with error code
        assert.notEqual(result.exitCode, 0)

        // Should have error output
        assert.ok(result.stderr.length > 0)
      })
    })

    it('should require transaction hash argument', { timeout: 30000 }, async () => {
      // Yargs rejects the missing positional before any RPC endpoint is
      // touched, so this needs neither endpoints nor locks.
      const result = await spawnCLI(['show'], 20000)

      // Should exit with error code
      assert.notEqual(result.exitCode, 0)

      // Should mention missing argument
      assert.match(result.stderr, /tx-hash|required|missing/i)
    })
  })

  // TODO: restore once aptos-testnet CCIP is redeployed and fixtures are refreshed. The
  // testnet was reset (ledger version back to ~1.9M) and package 0xc748…ee45 no longer
  // has onramp/offramp modules, so every live Aptos fixture below 404s.
  describe.skip('EVM to Aptos', () => {
    useResourceForDescribe(['bsc-testnet', 'aptos-testnet'])

    it(
      'should show complete CCIP transaction details EVM to Aptos',
      { timeout: 240000 },
      async () => {
        // Fixture seeded periodically from CCIP API v2 messages
        // (sourceChainSelector=13264668187771770619, destChainSelector=743186221051783445).
        // Source is bsc-testnet: the source side is a single tx-by-hash read,
        // so it costs nothing to serve and leaves the sepolia endpoints alone.
        const TX_HASH = '0x407ffe6bf58d39e08c786a7b31a407d758effb8657372c330a07a796137816a7'
        const MESSAGE_ID = '0xac0a5e71cd2e1d637d3b6af558bb255a7f6196cc7954c2b7146b8e055f9a9fe7'
        const SENDER = '0x89810cb91a5fe67dDf3483182f08e1559A5699De'
        const RECEIVER = '0xc7dfb38f07910cba7157db3ead1471ebc5a87f71a5aaad3921637f5371da69d8'
        const ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'
        const OFFRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'

        const args = buildShowArgs(TX_HASH, [...BSC_TESTNET_RPCS, ...APTOS_TESTNET_RPCS])
        const result = await spawnCLI(args, 210000)

        assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`)
        const output = result.stdout

        // Lane information
        assert.match(output, /name.*binance_smart_chain-testnet.*aptos-testnet/i)
        assert.match(output, /chainId.*97.*aptos:2/)
        assert.match(output, /chainSelector.*13264668187771770619n?.*743186221051783445n?/)
        assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

        // Request information
        assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
        assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
        assert.match(output, /sequenceNumber.*2867n?/)
        assert.match(output, /nonce.*0.*allow out-of-order/)
        assert.match(output, /gasLimit.*0n?/)
        assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
        assert.match(output, /logIndex.*7\b/)
        assert.match(output, /blockNumber.*127636236/)
        assert.match(output, /fee.*0\.000351598679631162\s+WBNB/)
        assert.match(output, /tokens.*0\.0014\s+CCIP-BnM/)
        assert.match(output, /data.*0x'?/)
        assert.match(output, /allowOutOfOrderExecution.*true\b/)

        // The API-metadata path short-circuits the commit/receipt scans (old
        // fixtures' event history is pruned on public nodes); the receipt table
        // itself still prints and stays fully assertable
        assert.match(output, /state.*success/i)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}::offramp`, 'i'))
        assert.match(
          output,
          /transactionHash.*0xb6a16526932bbf8401c9e92b0d641ee799556bf613b433eefb5e9631f19d9c11/i,
        )
        assert.match(output, /blockNumber.*10855148519/)
      },
    )
  })

  describe('EVM to Solana', () => {
    useResourceForDescribe(['base-sepolia', 'solana-devnet'])

    it(
      'should show complete CCIP transaction details EVM to Solana',
      { timeout: 120000 },
      async () => {
        // Fixture seeded from CCIP API v2 messages (sourceChainSelector=10344971235874465080,
        // destChainSelector=16423721717087811551); refreshed periodically, as devnet public
        // endpoints prune old transaction history (onfinality ~1 month at the time of writing).
        // Source is base-sepolia rather than sepolia: only the dest is scanned here,
        // so the source chain is free to be a quieter one.
        const TX_HASH = '0xac5c1d0ed9df2e2e403944ea7f92e490254f7ba8ee01599e0d4546ae07731b8e'
        const MESSAGE_ID = '0x46e394b2700e68d025a632cb2b3097eafea2235e7c6441ba85241194a6400c4c'
        const SENDER = '0x504f1fCFc4AF3Ae87f1a732f844eE08faBEA1ba6'
        const RECEIVER = '11111111111111111111111111111111'
        const TOKEN_RECEIVER = '399FfoqF5rGrh5KXNhzPEWCkDv11fZ4gGsGGU5c9MBYd'
        const ONRAMP = '0x28A025d34c830BF212f5D2357C8DcAB32dD92A20'
        const OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'

        const args = buildShowArgs(TX_HASH, [...BASE_SEPOLIA_RPCS, ...SOLANA_DEVNET_RPCS])
        const result = await spawnCLI(args, 90000)

        assert.equal(result.exitCode, 0, result.stdout + result.stderr)
        const output = result.stdout

        // Lane information
        assert.match(output, /name.*ethereum-testnet-sepolia-base-1.*solana-devnet/i)
        assert.match(output, /chainId.*84532.*EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG/)
        assert.match(output, /chainSelector.*10344971235874465080n?.*16423721717087811551n?/)
        assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

        // Request information
        assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
        assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
        assert.match(output, new RegExp(`receiver.*${RECEIVER}`, 'i'))
        assert.match(output, /sequenceNumber.*1499n?/)
        assert.match(output, /nonce.*0n?.*allow out-of-order/)
        assert.doesNotMatch(output, /gasLimit/)
        assert.match(output, /computeUnits.*0n?/)
        assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
        assert.match(output, /data.*0x'?/)
        assert.match(output, /allowOutOfOrderExecution.*true\b/)
        assert.match(output, new RegExp(`tokenReceiver.*${TOKEN_RECEIVER}\\b`, 'i'))

        // Commit information
        assert.match(output, /Commit.*dest/i)
        assert.match(
          output,
          /merkleRoot.*0x86fc0530dc5b01e0f8f72d71c3eb799c3549e35a00c452f3f8d1a0418d582e91/i,
        )
        assert.match(output, /min.*1499/)
        assert.match(output, /max.*1499/)
        assert.match(output, /origin.*8zJTVcm3bEAgJfsQPUBxyV5PEWTea81pKQV6uDVHpxjY/i)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
        assert.match(
          output,
          /transactionHash.*44Uze89tcZhiNE55P5dPmk4HFkpSUBTg7jAdXYd7Nvemz2MV6wPJZLbmXJcXJtHdaLCYfLvevENeCs3k77SskCj1/i,
        )

        // Receipts information
        assert.match(output, /Receipts.*dest/i)
        assert.match(output, /state.*success/i)
        assert.match(
          output,
          /transactionHash.*5nLiGaRuTwLqe6MQxfgSPWtqq3jLgNMTSwLXH5zGBZbTSdcc6DHbxgQLfo3Pos7jzMhcSpsaohCqo32tP5QmBLS3/i,
        )
      },
    )
  })

  describe('EVM to Solana v2', () => {
    useResourceForDescribe(['fuji', 'solana-devnet'])

    it(
      'should show EVM to Solana v2 OffRamp execution without verifications',
      { timeout: 60000 },
      async () => {
        // Solana v2 is not indexed by the CCIP API yet, so this fixture (and its
        // asserted values) come from a real CLI run, not from an API lookup — and
        // the same gap is why the verification lookup stays unavailable. Source is
        // fuji: v2 onRamps are not deployed on the quiet lanes used above.
        const TX_HASH = '0x40868c0b3f07b769c51d64dc8866e3b7c52a03b19232c6acee232acc18f21ab9'
        const MESSAGE_ID = '0x15e6a1e42b3c8b6d32eed44791910af96bb70bd8b13fd135ae9ae3a9f70df08a'
        const ONRAMP = '0x656345b769a568138919bF7CA0928fDcaa3964Dc'
        const OFFRAMP = 'offzdKY3MVHcs8c639Atwqr7KGbZrxmNDC27s2DJeEr'

        const result = await spawnCLI(
          buildShowArgs(TX_HASH, [...FUJI_RPCS, ...SOLANA_DEVNET_RPCS]),
          45000,
        )

        assert.equal(result.exitCode, 0, result.stdout + result.stderr)
        const output = result.stdout
        assert.match(output, /name.*avalanche-testnet-fuji.*solana-devnet/i)
        assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*2\\.0\\.0`, 'i'))
        assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
        assert.match(output, /sequenceNumber.*27\b/)
        assert.match(output, /data.*0x\b/)
        assert.match(output, new RegExp(`offRampAddress.*${OFFRAMP}`, 'i'))
        assert.match(result.stderr + output, /Verifications unavailable/i)
        assert.match(output, /Receipts.*dest/i)
        assert.match(output, /state.*success/i)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
        assert.match(
          output,
          /transactionHash.*sNNt4YwJW6AA8RWyTcXsuPrHSNsmrsB1AwJvPNT8igps9PcADjz1LDL4pjxZfixaX2R1mQg26A835X1ibMiW9QR/i,
        )
      },
    )
  })
})

describe('e2e command show Solana', () => {
  useResourceForDescribe(['solana-devnet', 'sepolia'])

  // Fixture seeded from CCIP API v2 messages (sourceChainSelector=16423721717087811551,
  // destChainSelector=16015286601757825753); refreshed periodically, as devnet public
  // endpoints prune old transaction history (onfinality ~1 month at the time of writing)
  const TX_HASH =
    '2C9MV381HRk9McBkDtTiviinq8XBD4XEn8LHJFc6MJMRZPgimmQEEmF3AXTboe2u6KJH8seCw7z3MVNuv9tGQS8D'
  const MESSAGE_ID = '0xa8733c341bbaab40b2fae5cc06195450515aea2b9f602436d9ae05b9aa6ce6ba'
  const SENDER = 'DWGBy9ZqkXnbiyLzSSy4qymE3P3aDBQMFGPAmSiffkA8'
  const RECEIVER = '0x4444638F73a73977098f364533dFaD6A274f1e88'
  const ONRAMP = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Solana to EVM',
    { timeout: 240000 },
    async () => {
      const args = buildShowArgs(TX_HASH, [...SOLANA_DEVNET_RPCS, ...SEPOLIA_RPCS])
      const result = await spawnCLI(args, 210000)

      assert.equal(result.exitCode, 0, result.stdout + result.stderr)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*solana-devnet.*ethereum-testnet-sepolia/i)
      assert.match(output, /chainId.*EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG.*11155111/)
      assert.match(output, /chainSelector.*16423721717087811551n?.*16015286601757825753n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`))
      assert.match(output, /sequenceNumber.*3399n?/)
      assert.match(output, /nonce.*0n?.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, /finalized.*true/)
      assert.match(output, /fee.*\bSOL/)
      assert.match(output, /tokens.*0\.1 tFRNT/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // Commit information. Provider lag degrades the commit to
      // `Verifications unavailable` (warned on stderr) or an empty table
      // under the heading on public gateways; either gilt.
      if (!/Verifications unavailable/i.test(result.stderr + output)) {
        assert.match(output, /Commit.*dest/i)
        assert.match(
          output,
          /merkleRoot.*0x357f41e09ea7c7ddae192ccf9b340e0cc77f2f851a8a5c76b4bb1885aa6c064f/i,
        )
        assert.match(output, /min.*3399/)
        assert.match(output, /max.*3399/)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
        assert.match(
          output,
          /transactionHash.*0x296003094714bf5eb53ab8a28a55fae917a38d214f285b7a93517ddbd23cf711/i,
        )
      }

      // Receipts information: destination is sepolia, whose public nodes retain full
      // log history, so the receipt deterministically renders for this fixture
      assert.match(output, /Receipts.*dest/i)
      assert.match(output, /state.*success/i)
      assert.match(
        output,
        /transactionHash.*0x18258e9875a64b8b2a77d967963eaf4a8e3593d58224ccaa24cf1b1fa892331c/i,
      )
    },
  )
})

// TODO: restore once aptos-testnet CCIP is redeployed and fixtures are refreshed. The
// testnet was reset (ledger version back to ~1.9M) and package 0xc748…ee45 no longer
// has onramp/offramp modules, so every live Aptos fixture below 404s.
describe.skip('e2e command show Aptos', () => {
  useResourceForDescribe(['aptos-testnet', 'sepolia'])

  // Fixture seeded periodically from CCIP API v2 messages
  // (sourceChainSelector=743186221051783445, destChainSelector=16015286601757825753)
  const TX_HASH = '0x034540a867b525b4f5b80ee70b964b112277e3bc4f97772e44f29bbd4522d4b1'
  const MESSAGE_ID = '0xddbb8b48fa12ce0e64c21fad6fbeb9f2a0a67e2ed2a24429a351bc4faa07b567'
  const SENDER = '0x275b828b4c4aede0c53b59ec594d12dfb86c5f01f8300395d0ee8a869aacf8cc'
  const RECEIVER = '0x9d087fC03ae39b088326b67fA3C788236645b717'
  const ONRAMP = '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45'
  const OFFRAMP = '0x0820f975ce90EE5c508657F0C58b71D1fcc85cE0'

  it(
    'should show complete CCIP transaction details Aptos to EVM',
    { timeout: 240000 },
    async () => {
      const args = buildShowArgs(TX_HASH, [...APTOS_TESTNET_RPCS, ...SEPOLIA_RPCS])
      const result = await spawnCLI(args, 210000)

      assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`)
      const output = result.stdout

      // Lane information
      assert.match(output, /name.*aptos-testnet.*ethereum-testnet-sepolia/i)
      assert.match(output, /chainId.*aptos:2.*11155111/)
      assert.match(output, /chainSelector.*743186221051783445n?.*16015286601757825753n?/)
      assert.match(output, new RegExp(`onRamp/version.*${ONRAMP}.*1\\.6\\.0`, 'i'))

      // Request information
      assert.match(output, new RegExp(`messageId.*${MESSAGE_ID}`, 'i'))
      assert.match(output, new RegExp(`origin.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`sender.*${SENDER}`, 'i'))
      assert.match(output, new RegExp(`receiver.*${RECEIVER}`))
      assert.match(output, /sequenceNumber.*164n?/)
      assert.match(output, /nonce.*0.*allow out-of-order/)
      assert.match(output, /gasLimit.*0n?/)
      assert.match(output, new RegExp(`transactionHash.*${TX_HASH}`, 'i'))
      assert.match(output, /logIndex.*8\b/)
      assert.match(output, /blockNumber.*10547904420/)
      assert.match(output, /fee.*\bAPT/)
      assert.match(output, /tokens.*0\.001\s+CCIP-BnM/)
      assert.match(output, /data.*0x'?/)
      assert.match(output, /allowOutOfOrderExecution.*true\b/)

      // The API-metadata path short-circuits the commit/receipt scans (old
      // fixtures' event history is pruned on public nodes); the receipt table
      // itself still prints and stays fully assertable. Provider lag can also
      // leave the receipts section empty under its heading — tolerate that,
      // but not a wrong receipt.
      assert.match(output, /Receipts.*dest|No execution receipt/i)
      // Provider shards disagree on which historic receipt row they serve:
      // require A receipt row when one is rendered, only pin the hash when the
      // successful one shows up
      if (/\bstate\b|No execution receipt/i.test(output)) {
        assert.match(output, /state.*(success|failed)|No execution receipt/i)
        assert.match(output, new RegExp(`contract.*${OFFRAMP}`, 'i'))
        if (/state.*success/i.test(output)) {
          assert.match(
            output,
            /transactionHash.*0xfc7ba4cbdeca8c322d0ced6aa2f0668a96263312287fde2e532d27493cb0a6f8/i,
          )
        }
      }
    },
  )
})

// TON testnet lane selectors: TON testnet and ethereum-sepolia, the two chains
// every TON lane in this repo touches.
const TON_TESTNET_SELECTOR = 1399300952838017768n
const SEPOLIA_SELECTOR = 16015286601757825753n

// Every TON fixture below is selected at RUNTIME through the same default CCIP API
// the CLI resolves ids with: the pinned Jan-2026 sends are gone, and `show` needs a
// recent send on each direction to print the commit and receipt sections.
const TON_FIXTURE_MAX_AGE_MS = 48 * 3600_000

/**
 * Picks a recent executed send on a TON testnet lane. Only SUCCESS messages qualify
 * (the tests need an on-chain receipt), and only single-message transactions (a
 * multi-message tx takes `show`'s "display all" early return, which never prints the
 * commit/receipt sections these tests assert on).
 */
async function selectFreshTonFixture(sourceChainSelector: bigint, destChainSelector: bigint) {
  const api = CCIPAPIClient.fromUrl(undefined, {
    // keep the test output clean; real problems still surface
    logger: { debug: () => {}, info: () => {}, warn: console.warn, error: console.error },
  })
  const page = await api.searchMessages({ sourceChainSelector, destChainSelector }, { limit: 50 })
  for (const msg of page.data) {
    if (msg.status !== MessageStatus.Success) continue
    if (Date.now() - Date.parse(msg.sendTimestamp) > TON_FIXTURE_MAX_AGE_MS) continue
    const inTx = await api.searchMessages(
      { sourceTransactionHash: msg.sendTransactionHash },
      { limit: 2 },
    )
    if (inTx.data.length !== 1) continue
    const { sendTransactionHash: txHash, messageId, origin, sender, receiver } = msg
    return { txHash, messageId, origin, sender, receiver }
  }
  throw new Error(
    `no single-message SUCCESS send younger than 48h among the CCIP API's ${page.data.length} ` +
      `newest ${sourceChainSelector} -> ${destChainSelector} messages`,
  )
}

describe('e2e command show TON', () => {
  useResourceForDescribe(['ton-testnet', 'sepolia'])

  let tonToEvm$: ReturnType<typeof selectFreshTonFixture> | undefined
  let evmToTon$: ReturnType<typeof selectFreshTonFixture> | undefined
  const tonToEvmFixture = () =>
    (tonToEvm$ ??= selectFreshTonFixture(TON_TESTNET_SELECTOR, SEPOLIA_SELECTOR))
  const evmToTonFixture = () =>
    (evmToTon$ ??= selectFreshTonFixture(SEPOLIA_SELECTOR, TON_TESTNET_SELECTOR))

  it('should show complete CCIP transaction details TON to EVM', { timeout: 210000 }, async () => {
    const fixture = await tonToEvmFixture()

    const args = buildShowArgs(fixture.txHash, [...TON_TESTNET_RPCS, ...SEPOLIA_RPCS])
    const result = await spawnCLI(args, 180000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)
    const output = result.stdout

    // Lane information: the source onRamp is a TON friendly address, dest is EVM
    assert.match(output, /name.*ton-testnet.*ethereum-testnet-sepolia/i)
    assert.match(output, /chainId.*-3.*11155111/)
    assert.match(output, /chainSelector.*1399300952838017768n?.*16015286601757825753n?/)
    assert.match(output, /onRamp\/version.*(EQ|UQ)[A-Za-z0-9_-]{46}.*\d+\.\d+\.\d+/i)

    // Request information
    assert.match(output, new RegExp(`messageId.*${fixture.messageId}`, 'i'))
    // The API renders TON addresses in raw form; `show` always prints the friendly one
    assert.match(output, /sender.*(EQ|UQ)[A-Za-z0-9_-]{46}/i)
    assert.match(output, new RegExp(`receiver.*${fixture.receiver}`, 'i'))
    assert.match(output, /sequenceNumber.*\d+/)
    assert.match(output, /nonce.*0.*allow out-of-order/)
    assert.match(output, /gasLimit.*\d+n?/)
    assert.match(output, new RegExp(`transactionHash.*${fixture.txHash}`, 'i'))
    assert.match(output, /allowOutOfOrderExecution.*true/)

    // Commit information (dest is EVM)
    assert.match(output, /Commit.*dest/i)
    assert.match(output, /merkleRoot.*0x[a-f0-9]{64}/i)
    assert.match(output, /min.*\d+/)
    assert.match(output, /max.*\d+/)
    assert.match(output, /contract.*0x[a-fA-F0-9]{40}/)

    // Execution receipt: the fixture is a SUCCESS message, so it has one
    assert.match(output, /Receipts.*dest/i)
    assert.match(output, /state.*success/i)
    assert.match(output, /gasUsed.*\d+/)
  })

  it('should show complete CCIP transaction details EVM to TON', { timeout: 210000 }, async () => {
    const fixture = await evmToTonFixture()

    const args = buildShowArgs(fixture.txHash, [...SEPOLIA_RPCS, ...TON_TESTNET_RPCS])
    const result = await spawnCLI(args, 180000)

    assert.equal(result.exitCode, 0, result.stdout + result.stderr)
    const output = result.stdout

    // Lane information: source onRamp is EVM, receiver and dest are TON
    assert.match(output, /name.*ethereum-testnet-sepolia.*ton-testnet/i)
    assert.match(output, /chainId.*11155111.*-3/)
    assert.match(output, /chainSelector.*16015286601757825753n?.*1399300952838017768n?/)
    assert.match(output, /onRamp\/version.*0x[a-fA-F0-9]{40}.*\d+\.\d+\.\d+/i)

    // Request information
    assert.match(output, new RegExp(`messageId.*${fixture.messageId}`, 'i'))
    assert.match(output, new RegExp(`origin.*${fixture.origin}`, 'i'))
    // The API renders TON addresses in raw form; `show` always prints the friendly one
    assert.match(output, /receiver.*(EQ|UQ)[A-Za-z0-9_-]{46}/i)
    assert.match(output, /sequenceNumber.*\d+/)
    assert.match(output, /nonce.*0.*allow out-of-order/)
    assert.match(output, /gasLimit.*\d+n?/)
    assert.match(output, new RegExp(`transactionHash.*${fixture.txHash}`, 'i'))
    assert.match(output, /allowOutOfOrderExecution.*true/)

    // Commit information (dest is TON - friendly format)
    assert.match(output, /Commit.*dest/i)
    assert.match(output, /merkleRoot.*0x[a-f0-9]{64}/i)
    assert.match(output, /min.*\d+/)
    assert.match(output, /max.*\d+/)
    assert.match(output, /origin.*(EQ|UQ)[A-Za-z0-9_-]{46}/i)
    assert.match(output, /contract.*(EQ|UQ)[A-Za-z0-9_-]{46}/i)
    // Transaction hashes stay plain 64-char hex (not the composite lt form)
    assert.match(output, /transactionHash.*[a-f0-9]{64}/i)

    // Execution receipt. TON keeps the whole execution history, and an automated
    // attempt that failed before a manual exec still renders — require a success,
    // not a particular first state.
    assert.match(output, /Receipts.*dest/i)
    assert.match(output, /state.*success/i)
    assert.match(output, /origin.*(EQ|UQ)[A-Za-z0-9_-]{46}/i)
    assert.match(output, /contract.*(EQ|UQ)[A-Za-z0-9_-]{46}/i)
    assert.match(output, /logIndex.*\d+/)

    const receiptsSection = output.split(/Receipts.*dest/i)[1] || ''
    const successMatches = receiptsSection.match(/success/gi) || []
    assert.ok(successMatches.length >= 1, 'Should have at least one successful execution')
  })
})
