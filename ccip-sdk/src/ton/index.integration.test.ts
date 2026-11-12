import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import '../index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import { NetworkType } from '../networks.ts'
import { type ChainLog, type Lane, CCIPVersion, ExecutionState } from '../types.ts'
import {
  type TonIndex,
  bodyPrefix,
  newestLog,
  patientIndexFetch,
} from './live-fixtures.integration.test.ts'
import { tonV3BaseUrl } from './logs.ts'
import { crc32 } from './utils.ts'
import { TONChain } from './index.ts'

await useResource(['ton-testnet'])

/**
 * Live-testnet coverage of the TON index-level APIs that the unit tests mock or
 * never reach: router/OffRamp bindings, CCIPMessageSent / CommitReportAccepted /
 * ExecutionStateChanged decoding against real BOCs, getTransaction, getMessagesInTx,
 * getExecutionReceipts, getBlockTimestamp, getTokenInfo and getBalance. The getLogs
 * scan SHAPES (index vs walk, wire call counts) are logs.integration.test.ts's job.
 *
 * This suite needs one real log of each kind. Each is the NEWEST one the lane has —
 * found with one index call and read through the SDK over the single block that
 * holds it (see live-fixtures.integration.test.ts) — so no test waits for traffic
 * inside a fixed lookback, and nothing is retried. What remains is the endpoint's own
 * limit: the public v2 endpoint serves a transaction for about two days, so a lane
 * silent for longer than that leaves its newest log unreadable, and the tests that
 * need it fail with the endpoint's error.
 *
 * Run against any TON v2 endpoint; defaults to the public index (paced, so slow):
 *   node --test src/ton/index.integration.test.ts
 *   SKIP_INTEGRATION_TESTS=1 npm test   # CI hermetic runs
 */
const TON_TESTNET_RPC = rpcEndpoint('RPC_TON_TESTNET')
const V3_BASE = tonV3BaseUrl(TON_TESTNET_RPC, NetworkType.Testnet)
const skip = !!process.env.SKIP_INTEGRATION_TESTS
const VERBOSE = !!process.env.VERBOSE
const LOGGER = VERBOSE ? console : { ...console, debug: () => {} }

// The ton-testnet OnRamp that both ccip-o11y pollers target (same address as
// logs.integration.test.ts); verified active 2026-10-23.
const ONRAMP = 'EQDioi9PI32Wo1oBwkUp0pj1AhwvAHiKiZCfgrr0iDqu3lTA'
const USDT_TESTNET = 'kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy'
const TON_FAUCET = 'EQAuz15H1ZHrZ_psVrAra7HealMIVeFq0wguqlmFno1f3EJj'

const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n
const TON_TESTNET_CHAIN_SELECTOR = 1399300952838017768n

// CRC32 hex values for TON external message topics
const CCIP_MESSAGE_SENT_TOPIC = crc32('CCIPMessageSent') // 0xa45d293c
const COMMIT_REPORT_ACCEPTED_TOPIC = crc32('CommitReportAccepted') // 0x27d3bce8
const EXECUTION_STATE_CHANGED_TOPIC = crc32('ExecutionStateChanged') // 0x4c94c360

describe('TON index integration tests (live testnet)', { skip }, () => {
  let chain: TONChain
  let index: TonIndex
  type Fixture<T> = Promise<{ log: ChainLog; startTime: number; endBlock: number } & T>
  /** The newest TON -> sepolia send of the OnRamp. */
  let message$: Fixture<{ message: CCIPMessage_V1_6_EVM }> | undefined
  let router$: Promise<string> | undefined
  let offRamp$: Promise<string> | undefined
  type Report = NonNullable<ReturnType<typeof TONChain.decodeCommits>>[number]
  type Receipt = NonNullable<ReturnType<typeof TONChain.decodeReceipt>>
  /** The newest sepolia commit report WITH a merkle root on the OffRamp. */
  let commit$: Fixture<{ report: Report }> | undefined
  /** The newest SUCCESSFUL sepolia execution on the OffRamp. */
  let receipt$: Fixture<{ receipt: Receipt }> | undefined

  const messageFixture = () =>
    (message$ ??= newestLog(chain, index, {
      address: ONRAMP,
      topic: 'CCIPMessageSent',
      accept: (log) => {
        const message = TONChain.decodeMessage(log) as CCIPMessage_V1_6_EVM | undefined
        return message?.destChainSelector === SEPOLIA_CHAIN_SELECTOR ? message : undefined
      },
    }).then(({ value: message, ...fixture }) => ({ ...fixture, message })))

  const routerFixture = () => (router$ ??= chain.getRouterForOnRamp(ONRAMP, SEPOLIA_CHAIN_SELECTOR))

  const offRampFixture = () =>
    (offRamp$ ??= (async () => {
      const offRamps = await chain.getOffRampsForRouter(
        await routerFixture(),
        SEPOLIA_CHAIN_SELECTOR,
      )
      assert.ok(offRamps[0], 'the router has an OffRamp for sepolia')
      return offRamps[0]
    })())

  /** The newest rooted sepolia commit at or before `notAfter` that `covers` accepts. */
  const findCommit = async (covers: (report: Report) => boolean, notAfter?: number) =>
    newestLog(chain, index, {
      address: await offRampFixture(),
      topic: 'CommitReportAccepted',
      opcode: bodyPrefix.rootedCommitFrom(SEPOLIA_CHAIN_SELECTOR),
      ...(notAfter != null && { notAfter }),
      accept: (log) =>
        TONChain.decodeCommits(log)?.find(
          (r) => r.sourceChainSelector === SEPOLIA_CHAIN_SELECTOR && covers(r),
        ),
    }).then(({ value: report, ...fixture }) => ({ ...fixture, report }))

  const commitFixture = () => (commit$ ??= findCommit(() => true))

  const receiptFixture = () =>
    (receipt$ ??= (async () => {
      const { value: receipt, ...fixture } = await newestLog(chain, index, {
        address: await offRampFixture(),
        topic: 'ExecutionStateChanged',
        opcode: bodyPrefix.executionFrom(SEPOLIA_CHAIN_SELECTOR),
        accept: (log) => {
          const receipt = TONChain.decodeReceipt(log)
          return receipt?.sourceChainSelector === SEPOLIA_CHAIN_SELECTOR &&
            receipt.state === ExecutionState.Success
            ? receipt
            : undefined
        },
      })
      return { ...fixture, receipt }
    })())

  before(async () => {
    index = { fetch: patientIndexFetch(V3_BASE, LOGGER), v3Base: V3_BASE }
    chain = await TONChain.fromUrl(TON_TESTNET_RPC, { logger: LOGGER, v3Fetch: index.fetch })
  })
  after(() => chain.destroy())

  describe('RPC connectivity', () => {
    it('should create TONChain from URL', async () => {
      const chain = await TONChain.fromUrl(TON_TESTNET_RPC)
      assert.equal(chain.network.name, 'ton-testnet')
      assert.equal(chain.network.chainId, -3)
      assert.equal(chain.network.chainSelector, TON_TESTNET_CHAIN_SELECTOR)
    })
  })

  describe('OnRamp bindings', () => {
    it('TONChain.getRouterForOnRamp should return a Router address', async () => {
      const router = await routerFixture()
      assert.ok(router, 'Should return router address')
      // The value is a TON address the chain can read a typeAndVersion from.
      const [type, version] = await chain.typeAndVersion(router)
      assert.equal(type, 'Router', 'Should be a Router contract')
      assert.match(version, /^\d+\.\d+\.\d+/, 'Version should be semver format')
    })
  })

  describe('OffRamp bindings', () => {
    it('TONChain.getRouterForOffRamp should get the router from the OffRamp config', async () => {
      const router = await chain.getRouterForOffRamp(await offRampFixture(), SEPOLIA_CHAIN_SELECTOR)
      assert.ok(router, 'Should return router address')
      assert.doesNotThrow(() => Address.parse(router), 'Should be a parseable TON address')
    })

    it('TONChain.getOnRampsForOffRamp should return source chain onRamp addresses', async () => {
      const onRamps = await chain.getOnRampsForOffRamp(
        await offRampFixture(),
        SEPOLIA_CHAIN_SELECTOR,
      )
      assert.ok(onRamps.length > 0, 'Should return at least one onRamp')
      // The onRamps are on the source chain, so they are EVM addresses.
      for (const onRamp of onRamps) assert.match(onRamp, /^0x[a-fA-F0-9]{40}$/)
    })
  })

  describe('Router bindings', () => {
    it('TONChain.getOffRampsForRouter should return offRamps for the source chain', async () => {
      const router = await routerFixture()
      const offRamps = await chain.getOffRampsForRouter(router, SEPOLIA_CHAIN_SELECTOR)

      assert.ok(Array.isArray(offRamps), 'Should return an array')
      assert.ok(offRamps.length > 0, 'Should find at least one OffRamp')
      assert.ok(
        offRamps.includes(await offRampFixture()),
        `Should include the offRamp the scans use: got=[${offRamps.join(', ')}]`,
      )
    })

    it('TONChain.getOnRampForRouter should return the onRamp for the destination chain', async () => {
      const onRamp = await chain.getOnRampForRouter(await routerFixture(), SEPOLIA_CHAIN_SELECTOR)
      assert.equal(
        Address.parse(onRamp).toRawString(),
        Address.parse(ONRAMP).toRawString(),
        'Should match the lane onRamp',
      )
    })
  })

  describe('getLogs', () => {
    it('should return well-formed logs for the OnRamp', async () => {
      const { log } = await messageFixture()

      assert.ok(log.address, 'log should have address')
      assert.equal(typeof log.data, 'string', 'log data should be a base64 BOC string')
      assert.ok((log.data as string).length > 0, 'log data should not be empty')
      assert.ok(log.blockNumber > 0, 'log should have positive blockNumber')
      assert.ok(log.transactionHash.includes(':'), 'transactionHash should be composite format')
      assert.equal(log.transactionHash.split(':').length, 4, 'composite hash has 4 parts')
      assert.equal(typeof log.index, 'number', 'log should have numeric index')
      assert.ok(Array.isArray(log.topics), 'log should have topics array')
      assert.equal(log.topics[0], CCIP_MESSAGE_SENT_TOPIC, 'topics[0] should be CCIPMessageSent')
    })

    it('should respect the endBlock filter', async () => {
      const { log, startTime } = await messageFixture()
      const scan = async (endBlock: number) => {
        const logs: ChainLog[] = []
        for await (const found of chain.getLogs({
          address: ONRAMP,
          topics: ['CCIPMessageSent'],
          startTime,
          endBlock,
        }))
          logs.push(found)
        return logs
      }

      const upTo = await scan(log.blockNumber)
      assert.ok(
        upTo.some((l) => l.transactionHash === log.transactionHash && l.index === log.index),
        'endBlock is inclusive: the log of that block is returned',
      )
      for (const found of upTo) {
        assert.ok(
          found.blockNumber <= log.blockNumber,
          `log.blockNumber ${found.blockNumber} should be <= endBlock ${log.blockNumber}`,
        )
      }

      const below = await scan(log.blockNumber - 1)
      assert.deepEqual(below, [], 'nothing at or above the block after endBlock')
    })
  })

  describe('decodeMessage', () => {
    let message: CCIPMessage_V1_6_EVM
    let messageLog: ChainLog

    before(async () => {
      ;({ message, log: messageLog } = await messageFixture())
    })

    it('should decode CCIPMessageSent from the transaction log', () => {
      assert.ok(message, 'Should successfully decode message')
      assert.ok(messageLog.transactionHash, 'Should have found a valid transaction')
    })

    it('should decode messageId as 32-byte hex', () => {
      assert.ok(message.messageId.startsWith('0x'), 'messageId should be hex prefixed')
      assert.match(message.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be 32 bytes')
    })

    it('should decode sourceChainSelector as TON testnet', () => {
      assert.equal(message.sourceChainSelector, TON_TESTNET_CHAIN_SELECTOR)
    })

    it('should decode destChainSelector as Sepolia', () => {
      assert.equal(message.destChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    it('should decode sequenceNumber as positive bigint', () => {
      assert.equal(typeof message.sequenceNumber, 'bigint')
      assert.ok(message.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    it('should decode nonce as bigint (typically 0 for out-of-order)', () => {
      assert.equal(typeof message.nonce, 'bigint')
      // nonce is 0 when allowOutOfOrderExecution is true
      if (message.allowOutOfOrderExecution) {
        assert.equal(message.nonce, 0n, 'nonce should be 0 for out-of-order execution')
      }
    })

    it('should decode sender as a TON address', () => {
      // The body carries the sender in canonical raw form ("workchain:hash").
      assert.ok(message.sender.length > 0, 'sender should be set')
      assert.doesNotThrow(
        () => Address.parse(message.sender),
        'sender should be parseable TON address',
      )
    })

    it('should decode receiver as checksummed EVM address', () => {
      assert.ok(message.receiver.startsWith('0x'), 'receiver should be hex prefixed')
      // Receiver should be a checksummed 20-byte EVM address (42 chars with 0x prefix)
      assert.equal(message.receiver.length, 42, 'receiver should be 20 bytes (42 chars with 0x)')
      assert.match(message.receiver, /^0x[a-fA-F0-9]{40}$/, 'receiver should be valid EVM address')
    })

    it('should decode data as hex bytes', () => {
      assert.ok(message.data.startsWith('0x'), 'data should be hex prefixed')
      assert.match(message.data, /^0x([a-f0-9]{2})*$/, 'data should be valid hex bytes')
    })

    it('should decode tokenAmounts as array', () => {
      assert.ok(Array.isArray(message.tokenAmounts), 'tokenAmounts should be array')
      for (const ta of message.tokenAmounts) {
        assert.ok('sourcePoolAddress' in ta, 'tokenAmount should have sourcePoolAddress')
        assert.ok('destTokenAddress' in ta, 'tokenAmount should have destTokenAddress')
      }
    })

    it('should decode feeToken as TON address', () => {
      assert.ok(message.feeToken, 'feeToken should be present')
      assert.doesNotThrow(
        () => Address.parse(message.feeToken),
        'feeToken should be parseable TON address',
      )
    })

    it('should decode feeTokenAmount as positive bigint', () => {
      assert.equal(typeof message.feeTokenAmount, 'bigint')
      assert.ok(message.feeTokenAmount > 0n, 'feeTokenAmount should be positive')
    })

    it('should decode feeValueJuels as positive bigint', () => {
      assert.equal(typeof message.feeValueJuels, 'bigint')
      assert.ok(message.feeValueJuels > 0n, 'feeValueJuels should be positive')
    })

    it('should decode extraArgs as a BOC carrying EVMExtraArgsV2', () => {
      // The wire format is a serialized cell graph (BOC), not a bare tag+fields.
      assert.match(message.extraArgs, /^0x([a-f0-9]{2})+$/, 'extraArgs should be hex bytes')
      const decoded = TONChain.decodeExtraArgs(message.extraArgs)
      assert.ok(decoded, 'extraArgs should decode')
      assert.equal(decoded._tag, 'EVMExtraArgsV2', 'dest is an EVM chain')
      assert.equal(
        decoded.gasLimit,
        (message as { gasLimit?: bigint }).gasLimit,
        'extraArgs gasLimit should match the decoded message',
      )
    })

    it('should decode gasLimit as positive bigint', () => {
      assert.ok('gasLimit' in message, 'message should have gasLimit property')
      const { gasLimit } = message as { gasLimit: bigint }
      assert.equal(typeof gasLimit, 'bigint')
      assert.ok(gasLimit > 0n, 'gasLimit should be positive')
    })

    it('should decode allowOutOfOrderExecution as boolean', () => {
      assert.equal(typeof message.allowOutOfOrderExecution, 'boolean')
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeMessage({ data: '' } as ChainLog), undefined, 'empty string')
      assert.equal(
        TONChain.decodeMessage({ data: undefined as unknown as string } as ChainLog),
        undefined,
        'undefined',
      )
      assert.equal(
        TONChain.decodeMessage({ data: 'not-valid-base64!!!' } as ChainLog),
        undefined,
        'invalid base64',
      )
      assert.equal(
        TONChain.decodeMessage({ data: 'SGVsbG8gV29ybGQ=' } as ChainLog),
        undefined,
        'valid base64 but not BOC',
      )
    })
  })

  describe('decodeCommits', () => {
    let commitLog: ChainLog
    let commitReport: NonNullable<ReturnType<typeof TONChain.decodeCommits>>

    before(async () => {
      ;({ log: commitLog } = await commitFixture())
      commitReport = TONChain.decodeCommits(commitLog) ?? []
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeCommits({ data: '' } as ChainLog), undefined, 'empty data')
      assert.equal(
        TONChain.decodeCommits({ data: undefined } as unknown as ChainLog),
        undefined,
        'undefined data',
      )
      assert.equal(
        TONChain.decodeCommits({ data: 'not-valid-base64!!!' } as ChainLog),
        undefined,
        'invalid base64',
      )
    })

    it('should return undefined for non-commit BOC data', async () => {
      const { log } = await messageFixture()
      assert.equal(
        TONChain.decodeCommits(log),
        undefined,
        'CCIPMessageSent should not decode as commit',
      )
    })

    it('should have CommitReportAccepted CRC32 as topics[0]', () => {
      assert.ok(commitLog.topics.length > 0, 'topics should not be empty')
      assert.equal(commitLog.topics[0], COMMIT_REPORT_ACCEPTED_TOPIC)
    })

    it('should decode commit reports with correct lane info', () => {
      assert.ok(commitReport.length > 0, 'Should decode commit report')
      const report = commitReport[0]!
      assert.equal(report.sourceChainSelector, SEPOLIA_CHAIN_SELECTOR)
      assert.match(
        report.onRampAddress,
        /^0x[a-fA-F0-9]{40}$/,
        'onRampAddress should be an EVM address',
      )
    })

    it('should decode valid sequence number range', () => {
      const report = commitReport[0]!
      assert.ok(report.minSeqNr > 0n, 'minSeqNr should be positive')
      assert.ok(report.maxSeqNr >= report.minSeqNr, 'maxSeqNr >= minSeqNr')
    })

    it('should decode valid merkleRoot', () => {
      const report = commitReport[0]!
      assert.match(report.merkleRoot, /^0x[a-f0-9]{64}$/, 'merkleRoot should be 32-byte hex')
    })

    it('should filter commits by lane', () => {
      const lane: Lane = {
        sourceChainSelector: SEPOLIA_CHAIN_SELECTOR,
        destChainSelector: TON_TESTNET_CHAIN_SELECTOR,
        onRamp: commitReport[0]!.onRampAddress,
        version: CCIPVersion.V1_6,
      }

      // Matching lane returns commits
      const match = TONChain.decodeCommits(commitLog, lane)
      assert.ok(match && match.length > 0, 'Should return commits for matching lane')

      // Wrong selector returns undefined
      const wrongSelector = TONChain.decodeCommits(commitLog, {
        ...lane,
        sourceChainSelector: 123n,
      })
      assert.equal(wrongSelector, undefined, 'Wrong sourceChainSelector should return undefined')

      // Wrong onRamp returns undefined
      const wrongOnRamp = TONChain.decodeCommits(commitLog, {
        ...lane,
        onRamp: '0x0000000000000000000000000000000000000000',
      })
      assert.equal(wrongOnRamp, undefined, 'Wrong onRamp should return undefined')
    })
  })

  describe('decodeReceipt', () => {
    let receiptLog: ChainLog
    let receipt: NonNullable<ReturnType<typeof TONChain.decodeReceipt>>

    before(async () => {
      ;({ log: receiptLog, receipt } = await receiptFixture())
    })

    it('should return undefined for invalid inputs', () => {
      assert.equal(TONChain.decodeReceipt({ data: '' } as ChainLog), undefined, 'empty data')
      assert.equal(
        TONChain.decodeReceipt({ data: undefined } as unknown as ChainLog),
        undefined,
        'undefined data',
      )
      assert.equal(
        TONChain.decodeReceipt({ data: 'not-valid-base64!!!' } as ChainLog),
        undefined,
        'invalid base64',
      )
    })

    it('should return undefined for non-receipt BOC data', async () => {
      const { log } = await messageFixture()
      assert.equal(
        TONChain.decodeReceipt(log),
        undefined,
        'CCIPMessageSent should not decode as receipt',
      )
    })

    it('should have ExecutionStateChanged CRC32 as topics[0]', () => {
      assert.ok(receiptLog.topics.length > 0, 'topics should not be empty')
      assert.equal(receiptLog.topics[0], EXECUTION_STATE_CHANGED_TOPIC)
    })

    it('should decode receipt with valid sourceChainSelector', () => {
      assert.equal(receipt.sourceChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    it('should decode valid sequenceNumber', () => {
      assert.equal(typeof receipt.sequenceNumber, 'bigint')
      assert.ok(receipt.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    it('should decode valid messageId', () => {
      assert.match(receipt.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be 32-byte hex')
    })

    it('should decode valid state', () => {
      assert.ok(
        [0, 1, 2, 3].includes(receipt.state),
        'state should be Untouched(0), InProgress(1), Success(2), or Failure(3)',
      )
    })
  })

  describe('typeAndVersion', () => {
    it('should return valid typeAndVersion for OffRamp', async () => {
      const result = await chain.typeAndVersion(await offRampFixture())

      assert.ok(result.length >= 3, 'Should return at least [type, version, typeAndVersion]')
      assert.equal(result[0], 'OffRamp', 'Type should be OffRamp')
      assert.match(result[1], /^\d+\.\d+\.\d+/, 'Version should be semver format')
      assert.ok(result[2].includes('OffRamp'), 'typeAndVersion should contain OffRamp')
    })

    it('should return valid typeAndVersion for OnRamp', async () => {
      const result = await chain.typeAndVersion(ONRAMP)

      assert.equal(result[0], 'OnRamp', 'Type should be OnRamp')
      assert.match(result[1], /^\d+\.\d+\.\d+/, 'Version should be semver format')
    })

    it('should return valid typeAndVersion for Router', async () => {
      const result = await chain.typeAndVersion(await routerFixture())

      assert.equal(result[0], 'Router', 'Type should be Router')
      assert.match(result[1], /^\d+\.\d+\.\d+/, 'Version should be semver format')
    })
  })

  describe('getTokenInfo', () => {
    it('should parse testnet USDT jetton metadata', async () => {
      // TEP-64 metadata served by the token's data cell, read through get_jetton_data.
      const result = await chain.getTokenInfo(USDT_TESTNET)

      assert.equal(result.symbol, 'USDT', 'symbol mismatch')
      assert.equal(result.decimals, 6, 'decimals mismatch')
    })

    it('should return defaults for non-Jetton contract', async () => {
      // The Router has no get_jetton_data
      const result = await chain.getTokenInfo(await routerFixture())

      assert.equal(result.symbol, '', 'Should return default symbol')
      assert.equal(result.decimals, 9, 'Should return default decimals')
    })

    it('should throw for invalid address format', async () => {
      await assert.rejects(
        () => chain.getTokenInfo('invalid-address'),
        /Unknown address type|Invalid address/i,
        'Should throw for invalid address',
      )
    })
  })

  describe('getTransaction', () => {
    let knownTxHash: string

    before(async () => {
      ;({
        log: { transactionHash: knownTxHash },
      } = await messageFixture())
    })

    it('should fetch transaction by composite hash', async () => {
      const tx = await chain.getTransaction(knownTxHash)

      assert.equal(tx.hash, knownTxHash)
      assert.ok(tx.blockNumber > 0, 'blockNumber should be positive')
      assert.ok(tx.timestamp > 0, 'timestamp should be positive')
      assert.ok(Array.isArray(tx.logs), 'logs should be an array')
      for (const log of tx.logs) {
        assert.ok(log.address, 'log should have address')
        assert.ok(log.data, 'log should have data')
        assert.equal(log.transactionHash, knownTxHash, 'log transactionHash should match')
        assert.equal(typeof log.index, 'number', 'log index should be a number')
      }
    })

    it('should fetch transaction by raw 64-char hex hash via TonCenter', async () => {
      const parts = knownTxHash.split(':')
      assert.equal(parts.length, 4, 'Should have 4 parts in composite hash')
      const rawHash = parts[3]!

      // The raw hash resolves through the TonCenter V3 index — the same index the
      // fixture was found in, so it is there.
      const tx = await chain.getTransaction(rawHash)

      assert.equal(tx.hash, knownTxHash, 'Should resolve to same composite hash')
      assert.ok(tx.blockNumber > 0, 'blockNumber should be positive')
    })

    it('should fetch transaction by 0x-prefixed raw hash', async () => {
      const rawHash = `0x${knownTxHash.split(':')[3]!}`

      const tx = await chain.getTransaction(rawHash)

      assert.equal(tx.hash, knownTxHash, 'Should resolve to same composite hash')
    })

    it('should throw for invalid hash format', async () => {
      await assert.rejects(
        chain.getTransaction('invalid-format'),
        /Invalid TON transaction hash format/,
        'Should throw for invalid format',
      )
    })
  })

  describe('getExecutionReceipts', () => {
    it('finds an execution through its commit and through a scan, with the same result', async () => {
      const offRamp = await offRampFixture()
      const { log, receipt } = await receiptFixture()
      // The commit that carried this message: the newest rooted one before the
      // execution whose sequence number range covers it.
      const commit = await findCommit(
        (r) => r.minSeqNr <= receipt.sequenceNumber && receipt.sequenceNumber <= r.maxSeqNr,
        log.blockTimestamp,
      )
      const query = {
        offRamp,
        messageId: receipt.messageId,
        sourceChainSelector: SEPOLIA_CHAIN_SELECTOR,
        sequenceNumber: receipt.sequenceNumber,
        startTime: commit.log.blockTimestamp,
      }
      const collect = async (opts: Parameters<TONChain['getExecutionReceipts']>[0]) => {
        const out = []
        for await (const exec of chain.getExecutionReceipts(opts)) out.push(exec)
        return out
      }
      const key = (execs: Awaited<ReturnType<typeof collect>>) =>
        execs.map((e) => `${e.log.transactionHash}#${e.log.index}:${e.receipt.state}`)

      // With the commit report: read through the report's MerkleRoot contract.
      const viaCommit = await collect({
        ...query,
        verifications: { report: commit.report, log: commit.log },
      })
      assert.ok(viaCommit.length > 0, 'the commit leads to the execution')
      const last = viaCommit[viaCommit.length - 1]!
      assert.equal(last.receipt.state, ExecutionState.Success)
      assert.equal(last.receipt.messageId, receipt.messageId)
      assert.equal(last.log.transactionHash, log.transactionHash, 'the same log as the fixture')
      assert.equal(last.log.index, log.index)
      assert.equal(last.log.blockNumber, log.blockNumber, 'stamped with the same block')

      // Without it: a scan from the commit time on, narrowed to the source chain.
      assert.deepEqual(key(await collect(query)), key(viaCommit), 'both routes agree')
    })
  })

  describe('getBlockTimestamp', () => {
    it('should return timestamp for finalized block', async () => {
      const timestamp = await chain.getBlockTimestamp('finalized')
      assert.ok(timestamp > 0, 'timestamp should be positive')
    })

    it('should return cached timestamp after getLogs', async () => {
      const { log } = await messageFixture()

      // The scan cached the masterchain timestamp of each emitted block.
      const timestamp = await chain.getBlockTimestamp(log.blockNumber)
      assert.ok(timestamp > 0, 'timestamp should be positive')
    })
  })

  describe('getMessagesInTx', () => {
    it('should parse CCIP request from the OnRamp transaction', async () => {
      const { log, message } = await messageFixture()
      const requests = await chain.getMessagesInTx(log.transactionHash)

      assert.ok(requests.length > 0, 'Should find at least one CCIP request')

      const request = requests[0]!
      assert.ok(request.message, 'request should have message')
      assert.ok(request.log, 'request should have log')
      assert.ok(request.lane, 'request should have lane')
      assert.equal(request.lane.sourceChainSelector, TON_TESTNET_CHAIN_SELECTOR)
      assert.equal(request.lane.destChainSelector, SEPOLIA_CHAIN_SELECTOR)
      assert.equal(
        request.message.messageId,
        message.messageId,
        'Should resolve the same message as the log scan',
      )
    })
  })

  describe('getBalance', () => {
    it('should return native GRAM balance', async () => {
      const balance = await chain.getBalance({
        holder: TON_FAUCET,
      })

      assert.equal(typeof balance, 'bigint')
      assert.ok(balance > 0n, 'Faucet should have positive GRAM balance')
    })

    it('should return USDT jetton balance', async () => {
      const balance = await chain.getBalance({
        holder: TON_FAUCET,
        token: USDT_TESTNET,
      })

      assert.equal(typeof balance, 'bigint')
      assert.ok(balance >= 0n, 'balance should be non-negative')
    })
  })
})
