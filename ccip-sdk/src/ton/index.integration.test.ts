import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { Address } from '@ton/core'

import '../index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { CCIPAPIClient } from '../api/index.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import { NetworkType } from '../networks.ts'
import { type ChainLog, type Lane, CCIPVersion, ExecutionState, MessageStatus } from '../types.ts'
import {
  type TonIndex,
  bodyPrefix,
  newestLogRows,
  patientIndexFetch,
  txBlock,
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
 * This suite needs one real log of each kind, and takes each from the lane's NEWEST
 * activity, whatever its age: the newest TON -> sepolia send and the newest executed
 * sepolia -> TON message from the CCIP API (and the commit that carried it, from the
 * index), read through `getTransaction` like any caller would. TON testnet lanes can be
 * quiet for days, longer than the public v2 endpoint keeps a transaction (about two
 * days); the SDK then reads such a transaction from the index (see indexed-tx.ts), so
 * these tests cover both routes and never wait for traffic. The getLogs scans run on
 * the OffRamp's own newest activity, which its price commits keep within minutes.
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
/** Every log an OffRamp emits while it commits and executes. */
const RECENT_TOPICS = ['OCR3Base_Transmitted', 'CommitReportAccepted', 'ExecutionStateChanged']
/**
 * A sepolia -> TON message executed on 2026-11-13: far older than the public v2 endpoint
 * keeps transactions, so its commit and receipts come through the SDK's index fallback
 * there (see indexed-tx.ts) — a pinned regression guard for that route, which the
 * newest-message fixtures only reach while the lane is quiet.
 */
const OLD_MESSAGE_ID = '0xb63066957be861a6f100c09e3841374f632f983d7ad524455f30de4ea81aaf74'

describe('TON index integration tests (live testnet)', { skip }, () => {
  let chain: TONChain
  let index: TonIndex
  const api = CCIPAPIClient.fromUrl(undefined, {
    logger: { ...LOGGER, info: () => {} },
  })
  type Fixture<T> = Promise<{ log: ChainLog } & T>
  /** The newest TON -> sepolia send. */
  let message$: Fixture<{ message: CCIPMessage_V1_6_EVM }> | undefined
  let router$: Promise<string> | undefined
  let offRamp$: Promise<string> | undefined
  type Report = NonNullable<ReturnType<typeof TONChain.decodeCommits>>[number]
  type Receipt = NonNullable<ReturnType<typeof TONChain.decodeReceipt>>
  /** The commit that carried the receipt fixture's message. */
  let commit$: Fixture<{ report: Report }> | undefined
  /** The Success receipt of the newest executed sepolia -> TON message. */
  let receipt$: Fixture<{ receipt: Receipt }> | undefined
  /** The OffRamp's newest log, with the one-block scan window that holds it. */
  let recent$: Promise<{ log: ChainLog; startTime: number; endBlock: number }> | undefined

  /** The newest message of a lane in the CCIP API, Success only if asked. */
  const newestMessage = async (source: bigint, dest: bigint, executed: boolean) => {
    const page = await api.searchMessages(
      { sourceChainSelector: source, destChainSelector: dest },
      { limit: 50 },
    )
    const msg = page.data.find((m) => !executed || m.status === MessageStatus.Success)
    assert.ok(msg, `the CCIP API has no ${executed ? 'executed ' : ''}${source} -> ${dest} message`)
    return msg
  }

  /** The log of transaction `hash` that `accept` takes. */
  const logInTx = async <T>(hash: string, accept: (log: ChainLog) => T | undefined) => {
    const tx = await chain.getTransaction(hash)
    for (const log of tx.logs) {
      const value = accept(log)
      if (value !== undefined) return { log, value }
    }
    assert.fail(
      `transaction ${tx.hash} holds no accepted log (topics: ${tx.logs.map((l) => l.topics[0]).join(',')})`,
    )
  }

  const messageFixture = () =>
    (message$ ??= (async () => {
      const { messageId, sendTransactionHash } = await newestMessage(
        TON_TESTNET_CHAIN_SELECTOR,
        SEPOLIA_CHAIN_SELECTOR,
        false,
      )
      const { log, value: message } = await logInTx(sendTransactionHash, (log) => {
        const message = TONChain.decodeMessage(log) as CCIPMessage_V1_6_EVM | undefined
        return message?.messageId === messageId ? message : undefined
      })
      return { log, message }
    })())

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

  const receiptFixture = () =>
    (receipt$ ??= (async () => {
      const { messageId } = await newestMessage(
        SEPOLIA_CHAIN_SELECTOR,
        TON_TESTNET_CHAIN_SELECTOR,
        true,
      )
      const { metadata } = await api.getMessageById(messageId)
      assert.ok(metadata.receiptTransactionHash, `the CCIP API has no receipt for ${messageId}`)
      const { log, value: receipt } = await logInTx(metadata.receiptTransactionHash, (log) => {
        const receipt = TONChain.decodeReceipt(log)
        return receipt?.messageId === messageId && receipt.state === ExecutionState.Success
          ? receipt
          : undefined
      })
      return { log, receipt }
    })())

  const commitFixture = () =>
    (commit$ ??= (async () => {
      const { log: receiptLog, receipt } = await receiptFixture()
      // The newest rooted sepolia commits up to the execution: one of them carried it.
      const rows = await newestLogRows(index, await offRampFixture(), {
        opcode: bodyPrefix.rootedCommitFrom(SEPOLIA_CHAIN_SELECTOR),
        notAfter: receiptLog.blockTimestamp,
      })
      for (const row of rows) {
        const hash = Buffer.from(row.txHash, 'base64').toString('hex')
        const tx = await chain.getTransaction(hash)
        for (const log of tx.logs) {
          const report = TONChain.decodeCommits(log)?.find(
            (r) =>
              r.sourceChainSelector === SEPOLIA_CHAIN_SELECTOR &&
              r.minSeqNr <= receipt.sequenceNumber &&
              receipt.sequenceNumber <= r.maxSeqNr,
          )
          if (report) return { log, report }
        }
      }
      assert.fail(`no rooted sepolia commit before the execution covers ${receipt.sequenceNumber}`)
    })())

  const recentFixture = () =>
    (recent$ ??= (async () => {
      const offRamp = await offRampFixture()
      const [row] = await newestLogRows(index, offRamp, { limit: 1 })
      assert.ok(row, `the index has no log of OffRamp ${offRamp}`)
      const window = {
        startTime: row.createdAt,
        endBlock: await txBlock(index, offRamp, row.txHash),
      }
      for await (const log of chain.getLogs({ address: offRamp, topics: RECENT_TOPICS, ...window }))
        if (log.index === Number(row.createdLt)) return { log, ...window }
      assert.fail(`the scan of ${JSON.stringify(window)} misses the OffRamp log ${row.createdLt}`)
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
    it('should return well-formed logs for the OffRamp', async () => {
      const { log } = await recentFixture()

      assert.ok(log.address, 'log should have address')
      assert.equal(typeof log.data, 'string', 'log data should be a base64 BOC string')
      assert.ok((log.data as string).length > 0, 'log data should not be empty')
      assert.ok(log.blockNumber > 0, 'log should have positive blockNumber')
      assert.ok(log.transactionHash.includes(':'), 'transactionHash should be composite format')
      assert.equal(log.transactionHash.split(':').length, 4, 'composite hash has 4 parts')
      assert.equal(typeof log.index, 'number', 'log should have numeric index')
      assert.ok(Array.isArray(log.topics), 'log should have topics array')
      assert.ok(
        RECENT_TOPICS.map((topic) => crc32(topic)).includes(log.topics[0]!),
        `topics[0] ${log.topics[0]} should be one of ${RECENT_TOPICS.join(', ')}`,
      )
    })

    it('should respect the endBlock filter', async () => {
      const { log, startTime } = await recentFixture()
      const scan = async (endBlock: number) => {
        const logs: ChainLog[] = []
        for await (const found of chain.getLogs({
          address: log.address,
          topics: RECENT_TOPICS,
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

    /** `it` with `message` and `messageLog` read from the fixture. */
    const itMessage = (name: string, fn: () => void) =>
      it(name, async () => {
        ;({ message, log: messageLog } = await messageFixture())
        fn()
      })

    itMessage('should decode CCIPMessageSent from the transaction log', () => {
      assert.ok(message, 'Should successfully decode message')
      assert.ok(messageLog.transactionHash, 'Should have found a valid transaction')
    })

    itMessage('should have CCIPMessageSent CRC32 as topics[0]', () => {
      assert.equal(messageLog.topics[0], CCIP_MESSAGE_SENT_TOPIC)
    })

    itMessage('should decode messageId as 32-byte hex', () => {
      assert.ok(message.messageId.startsWith('0x'), 'messageId should be hex prefixed')
      assert.match(message.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be 32 bytes')
    })

    itMessage('should decode sourceChainSelector as TON testnet', () => {
      assert.equal(message.sourceChainSelector, TON_TESTNET_CHAIN_SELECTOR)
    })

    itMessage('should decode destChainSelector as Sepolia', () => {
      assert.equal(message.destChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    itMessage('should decode sequenceNumber as positive bigint', () => {
      assert.equal(typeof message.sequenceNumber, 'bigint')
      assert.ok(message.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    itMessage('should decode nonce as bigint (typically 0 for out-of-order)', () => {
      assert.equal(typeof message.nonce, 'bigint')
      // nonce is 0 when allowOutOfOrderExecution is true
      if (message.allowOutOfOrderExecution) {
        assert.equal(message.nonce, 0n, 'nonce should be 0 for out-of-order execution')
      }
    })

    itMessage('should decode sender as a TON address', () => {
      // The body carries the sender in canonical raw form ("workchain:hash").
      assert.ok(message.sender.length > 0, 'sender should be set')
      assert.doesNotThrow(
        () => Address.parse(message.sender),
        'sender should be parseable TON address',
      )
    })

    itMessage('should decode receiver as checksummed EVM address', () => {
      assert.ok(message.receiver.startsWith('0x'), 'receiver should be hex prefixed')
      // Receiver should be a checksummed 20-byte EVM address (42 chars with 0x prefix)
      assert.equal(message.receiver.length, 42, 'receiver should be 20 bytes (42 chars with 0x)')
      assert.match(message.receiver, /^0x[a-fA-F0-9]{40}$/, 'receiver should be valid EVM address')
    })

    itMessage('should decode data as hex bytes', () => {
      assert.ok(message.data.startsWith('0x'), 'data should be hex prefixed')
      assert.match(message.data, /^0x([a-f0-9]{2})*$/, 'data should be valid hex bytes')
    })

    itMessage('should decode tokenAmounts as array', () => {
      assert.ok(Array.isArray(message.tokenAmounts), 'tokenAmounts should be array')
      for (const ta of message.tokenAmounts) {
        assert.ok('sourcePoolAddress' in ta, 'tokenAmount should have sourcePoolAddress')
        assert.ok('destTokenAddress' in ta, 'tokenAmount should have destTokenAddress')
      }
    })

    itMessage('should decode feeToken as TON address', () => {
      assert.ok(message.feeToken, 'feeToken should be present')
      assert.doesNotThrow(
        () => Address.parse(message.feeToken),
        'feeToken should be parseable TON address',
      )
    })

    itMessage('should decode feeTokenAmount as positive bigint', () => {
      assert.equal(typeof message.feeTokenAmount, 'bigint')
      assert.ok(message.feeTokenAmount > 0n, 'feeTokenAmount should be positive')
    })

    itMessage('should decode feeValueJuels as positive bigint', () => {
      assert.equal(typeof message.feeValueJuels, 'bigint')
      assert.ok(message.feeValueJuels > 0n, 'feeValueJuels should be positive')
    })

    itMessage('should decode extraArgs as a BOC carrying EVMExtraArgsV2', () => {
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

    itMessage('should decode gasLimit as positive bigint', () => {
      assert.ok('gasLimit' in message, 'message should have gasLimit property')
      const { gasLimit } = message as { gasLimit: bigint }
      assert.equal(typeof gasLimit, 'bigint')
      assert.ok(gasLimit > 0n, 'gasLimit should be positive')
    })

    itMessage('should decode allowOutOfOrderExecution as boolean', () => {
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

    /** `it` with `commitLog` and `commitReport` read from the fixture. */
    const itCommit = (name: string, fn: () => void) =>
      it(name, async () => {
        ;({ log: commitLog } = await commitFixture())
        commitReport = TONChain.decodeCommits(commitLog) ?? []
        fn()
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

    itCommit('should have CommitReportAccepted CRC32 as topics[0]', () => {
      assert.ok(commitLog.topics.length > 0, 'topics should not be empty')
      assert.equal(commitLog.topics[0], COMMIT_REPORT_ACCEPTED_TOPIC)
    })

    itCommit('should decode commit reports with correct lane info', () => {
      assert.ok(commitReport.length > 0, 'Should decode commit report')
      const report = commitReport[0]!
      assert.equal(report.sourceChainSelector, SEPOLIA_CHAIN_SELECTOR)
      assert.match(
        report.onRampAddress,
        /^0x[a-fA-F0-9]{40}$/,
        'onRampAddress should be an EVM address',
      )
    })

    itCommit('should decode valid sequence number range', () => {
      const report = commitReport[0]!
      assert.ok(report.minSeqNr > 0n, 'minSeqNr should be positive')
      assert.ok(report.maxSeqNr >= report.minSeqNr, 'maxSeqNr >= minSeqNr')
    })

    itCommit('should decode valid merkleRoot', () => {
      const report = commitReport[0]!
      assert.match(report.merkleRoot, /^0x[a-f0-9]{64}$/, 'merkleRoot should be 32-byte hex')
    })

    itCommit('should filter commits by lane', () => {
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

    /** `it` with `receiptLog` and `receipt` read from the fixture. */
    const itReceipt = (name: string, fn: () => void) =>
      it(name, async () => {
        ;({ log: receiptLog, receipt } = await receiptFixture())
        fn()
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

    itReceipt('should have ExecutionStateChanged CRC32 as topics[0]', () => {
      assert.ok(receiptLog.topics.length > 0, 'topics should not be empty')
      assert.equal(receiptLog.topics[0], EXECUTION_STATE_CHANGED_TOPIC)
    })

    itReceipt('should decode receipt with valid sourceChainSelector', () => {
      assert.equal(receipt.sourceChainSelector, SEPOLIA_CHAIN_SELECTOR)
    })

    itReceipt('should decode valid sequenceNumber', () => {
      assert.equal(typeof receipt.sequenceNumber, 'bigint')
      assert.ok(receipt.sequenceNumber > 0n, 'sequenceNumber should be positive')
    })

    itReceipt('should decode valid messageId', () => {
      assert.match(receipt.messageId, /^0x[a-f0-9]{64}$/, 'messageId should be 32-byte hex')
    })

    itReceipt('should decode valid state', () => {
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

    /** `it` with `knownTxHash` read from the message fixture. */
    const itTx = (name: string, fn: () => Promise<void>) =>
      it(name, async () => {
        ;({
          log: { transactionHash: knownTxHash },
        } = await messageFixture())
        await fn()
      })

    itTx('should fetch transaction by composite hash', async () => {
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

    itTx('should fetch transaction by raw 64-char hex hash via TonCenter', async () => {
      const parts = knownTxHash.split(':')
      assert.equal(parts.length, 4, 'Should have 4 parts in composite hash')
      const rawHash = parts[3]!

      // The raw hash resolves through the TonCenter V3 index — the same index the
      // fixture was found in, so it is there.
      const tx = await chain.getTransaction(rawHash)

      assert.equal(tx.hash, knownTxHash, 'Should resolve to same composite hash')
      assert.ok(tx.blockNumber > 0, 'blockNumber should be positive')
    })

    itTx('should fetch transaction by 0x-prefixed raw hash', async () => {
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
      const commit = await commitFixture()
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

  describe('old message (index fallback where v2 no longer keeps it)', () => {
    it('finds the commit and the Success receipt the CCIP API reports', async () => {
      const request = await api.getMessageById(OLD_MESSAGE_ID)
      const offRamp = request.metadata.offRamp
      assert.ok(offRamp, 'the CCIP API names the OffRamp')
      assert.ok(request.metadata.receiptTransactionHash, 'the CCIP API has its receipt')

      const verifications = await chain.getVerifications({ offRamp, request })
      assert.ok('report' in verifications, 'a commit report')
      const { report, log: commitLog } = verifications
      assert.ok(
        report.minSeqNr <= request.message.sequenceNumber &&
          request.message.sequenceNumber <= report.maxSeqNr,
        'the commit covers the message',
      )
      assert.equal(commitLog.topics[0], COMMIT_REPORT_ACCEPTED_TOPIC)

      const execs = []
      for await (const exec of chain.getExecutionReceipts({
        offRamp,
        messageId: OLD_MESSAGE_ID,
        sourceChainSelector: SEPOLIA_CHAIN_SELECTOR,
        sequenceNumber: request.message.sequenceNumber,
        startTime: request.log.blockTimestamp,
        verifications,
      }))
        execs.push(exec)
      const last = execs[execs.length - 1]
      assert.ok(last, 'a receipt')
      assert.equal(last.receipt.state, ExecutionState.Success)
      assert.equal(
        last.log.transactionHash.split(':')[3],
        request.metadata.receiptTransactionHash.replace(/^0x/, '').toLowerCase(),
        'the receipt transaction the CCIP API reports',
      )
      assert.ok(last.log.blockNumber >= commitLog.blockNumber, 'executed at or after its commit')
    })
  })

  describe('getBlockTimestamp', () => {
    it('should return timestamp for finalized block', async () => {
      const timestamp = await chain.getBlockTimestamp('finalized')
      assert.ok(timestamp > 0, 'timestamp should be positive')
    })

    it('should return cached timestamp after getLogs', async () => {
      const { log } = await recentFixture()

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
