/* eslint-disable no-restricted-syntax */
/**
 * CCIP CLI Exec Command
 *
 * Monitors a source chain for CCIP send requests and executes unexecuted messages
 * on the destination chain. Supports time-based filtering and concurrent execution.
 *
 * @example
 * ```bash
 * # Execute messages from the last 72 hours, at least 1h old
 * ccip-cli exec --source sepolia --dest fuji --router 0xRouter... --since 72h --until 1h --wallet $PRIVATE_KEY
 *
 * # Execute messages since a specific date
 * ccip-cli exec --source sepolia --dest fuji --router 0xRouter... --since "2024-01-01T00:00:00Z" --until 30m
 *
 * # Also re-execute failed messages
 * ccip-cli exec --source sepolia --dest fuji --router 0xRouter... --since 24h --until 1h --exec-failed
 * ```
 *
 * @packageDocumentation
 */

import {
  type CCIPExecution,
  type CCIPRequest,
  type ChainStatic,
  type ChainTransaction,
  type ExecutionInput,
  ExecutionState,
  discoverOffRamp,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import type { Ctx } from './types.ts'
import { getCtx, logParsedError } from './utils.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../providers/index.ts'

const MAX_IN_FLIGHT = 25

export const command = 'exec'
export const describe =
  'Monitor source chain for CCIP requests and execute pending messages on destination'

/**
 * Parse a duration string like "72h", "30m", "1h30m" into milliseconds.
 */
function parseDuration(dur: string): number {
  const re = /(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/
  const m = dur.match(re)
  if (!m || m[0] === '') throw new Error(`Invalid duration: ${dur}`)
  const days = parseInt(m[1] || '0', 10)
  const hours = parseInt(m[2] || '0', 10)
  const minutes = parseInt(m[3] || '0', 10)
  const seconds = parseInt(m[4] || '0', 10)
  const ms = ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000
  if (ms <= 0) throw new Error(`Duration must be positive: ${dur}`)
  return ms
}

/**
 * Parse --since: either an ISO date string or a duration (e.g. "72h").
 * Returns a Unix timestamp in seconds (fixed at script start).
 */
function parseSince(value: string, now: number): number {
  // Try duration first
  if (/^\d+[dhms]/.test(value)) {
    const ms = parseDuration(value)
    return Math.floor((now - ms) / 1000)
  }
  // Otherwise parse as date
  const date = new Date(value)
  if (isNaN(date.getTime())) throw new Error(`Invalid --since value: ${value}`)
  return Math.floor(date.getTime() / 1000)
}

/**
 * Parse --until: a duration string like "1h" meaning "at least this old".
 * Returns milliseconds.
 */
function parseUntil(value: string): number {
  return parseDuration(value)
}

/**
 * Yargs builder for the exec command.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('source', {
      alias: 's',
      type: 'string',
      demandOption: true,
      describe: 'Source chain: chainId, selector, or name',
    })
    .option('dest', {
      alias: 'd',
      type: 'string',
      demandOption: true,
      describe: 'Destination chain: chainId, selector, or name',
    })
    .option('router', {
      alias: 'r',
      type: 'string',
      demandOption: true,
      describe: 'Router contract address on source chain',
    })
    .option('since', {
      type: 'string',
      demandOption: true,
      describe: 'Start time: ISO date/time or duration like "72h" (fixed at script start)',
    })
    .option('until', {
      type: 'string',
      demandOption: true,
      describe:
        'Minimum message age as duration, e.g. "1h" means only execute messages older than 1h (sliding window)',
    })
    .options({
      'gas-limit': {
        alias: ['L', 'compute-units'],
        type: 'number',
        describe: 'Override gas limit or compute units for receiver callback (0 keeps original)',
      },
      'tokens-gas-limit': {
        type: 'number',
        describe: 'Override gas limit for tokens releaseOrMint calls (0 keeps original)',
      },
      wallet: {
        alias: 'w',
        type: 'string',
        describe:
          'Wallet to send transactions with; pass `ledger[:index]` for Ledger or private key via USER_KEY env var',
      },
      'exec-failed': {
        type: 'boolean',
        default: false,
        describe: 'Also re-execute messages that failed (not just missing executions)',
      },
      'max-in-flight': {
        type: 'number',
        default: MAX_IN_FLIGHT,
        describe: 'Maximum number of concurrent in-flight executions',
      },
    })

type ExecArgv = Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts

/**
 * Handler for the exec command.
 */
export async function handler(argv: ExecArgv) {
  const [ctx, destroy] = getCtx(argv)
  return execCommand(ctx, argv, destroy)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function execCommand(ctx: Ctx, argv: ExecArgv, destroy: () => void) {
  const { logger } = ctx
  const now = Date.now()

  const startTimestamp = parseSince(argv.since, now)
  const untilDurationMs = parseUntil(argv.until)

  logger.info(
    `Exec: scanning since ${new Date(startTimestamp * 1000).toISOString()}, ` +
      `until messages are at least ${argv.until} old, maxInFlight=${argv.maxInFlight}`,
  )

  // Setup SIGINT handler to gracefully stop
  let cancelResolve: () => void
  const cancel$ = new Promise<void>((resolve) => {
    cancelResolve = resolve
  })
  const onSigint = () => {
    logger.info('\nGracefully shutting down...')
    cancelResolve()
    destroy()
  }
  process.on('SIGINT', onSigint)

  try {
    // Connect to chains
    const sourceNetwork = networkInfo(argv.source)
    const destNetwork = networkInfo(argv.dest)
    const getChain = fetchChainsFromRpcs(ctx, argv)
    const source = await getChain(sourceNetwork.name)
    const dest = await getChain(destNetwork.name)

    // Discover onRamp and offRamp
    const onRamp = await source.getOnRampForRouter(argv.router, destNetwork.chainSelector)
    logger.info(`OnRamp: ${onRamp}`)

    const offRamp = await discoverOffRamp(source, dest, onRamp, source)
    logger.info(`OffRamp: ${offRamp}`)

    // Load wallet on dest chain
    const [walletAddress, wallet] = await loadChainWallet(dest, argv)
    logger.info(`Wallet: ${walletAddress}`)

    // State: execution receipts by messageId
    const executions = new Map<string, ExecutionState>()
    // Queue of requests pending execution
    const pendingQueue: CCIPRequest[] = []
    // Track in-flight executions
    let inFlight = 0
    // Promise that resolves when an in-flight execution completes (to unblock queue processing)
    let inflightResolve: (() => void) | undefined
    let inflightPromise: Promise<void> | undefined

    // Track whether receipts have caught up to the --until sliding window
    let receiptsCaughtUp = false

    // Stats
    let totalFound = 0
    let totalExecuted = 0
    let totalSkipped = 0
    let totalFailed = 0

    /**
     * Returns whether a message should be executed based on its execution state.
     */
    function shouldExecute(request: CCIPRequest): boolean {
      const state = executions.get(request.message.messageId)
      if (state === undefined) return true // not executed
      if (argv.execFailed && state !== ExecutionState.Success) return true // re-execute failed
      return false
    }

    /**
     * Returns whether the message is old enough per --until
     */
    function isOldEnough(timestampSec: number): boolean {
      return timestampSec * 1000 + untilDurationMs <= Date.now()
    }

    /**
     * Wait until a message becomes old enough, or cancel.
     */
    function waitUntilOldEnough(timestampSec: number): Promise<boolean> {
      const targetMs = timestampSec * 1000 + untilDurationMs
      const waitMs = targetMs - Date.now()
      if (waitMs <= 0) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(true), waitMs)
        void cancel$.then(() => {
          clearTimeout(timer)
          resolve(false)
        })
      })
    }

    /**
     * Execute a single request on the destination chain.
     */
    async function executeRequest(request: CCIPRequest): Promise<void> {
      const messageId = request.message.messageId
      try {
        logger.info(`⚙️  Executing messageId=${messageId} ...`)

        // Get verifications (commit report)
        const verifications = await dest.getVerifications({
          ...argv,
          offRamp,
          request,
        })

        // Build execution input from source
        const input: ExecutionInput = await source.getExecutionInput({
          ...argv,
          request,
          verifications,
        })

        // Execute on dest — may return CCIPExecution or ChainTransaction
        const result: CCIPExecution | ChainTransaction = (await dest.execute({
          offRamp,
          input,
          wallet,
          ...(argv.gasLimit != null && { gasLimit: argv.gasLimit }),
          ...(argv.tokensGasLimit != null && { tokensGasLimit: argv.tokensGasLimit }),
          ...{ returnTx: true },
        })) as CCIPExecution | ChainTransaction

        if ('receipt' in result) {
          // CCIPExecution — we know the execution state
          executions.set(messageId, result.receipt.state)

          if (result.receipt.state === ExecutionState.Success) {
            totalExecuted++
            logger.info(
              `✅ messageId=${messageId} executed successfully, tx=${result.log.transactionHash}`,
            )
          } else {
            totalFailed++
            logger.warn(
              `⚠️  messageId=${messageId} execution state=${result.receipt.state}, tx=${result.log.transactionHash}`,
            )
          }
        } else {
          // ChainTransaction — just log the hash and count as executed
          totalExecuted++
          logger.info(`✅ messageId=${messageId} sent, tx=${result.hash}`)
        }
      } catch (err) {
        totalFailed++
        logger.error(`❌ messageId=${messageId} execution failed:`, err)
      }
    }

    /**
     * Manage in-flight execution concurrency.
     */
    function spawnExecution(request: CCIPRequest): void {
      inFlight++
      void executeRequest(request).finally(() => {
        inFlight--
        inflightResolve?.()
      })
    }

    /**
     * Wait until an in-flight slot opens up.
     */
    async function waitForSlot(): Promise<void> {
      while (inFlight >= argv.maxInFlight) {
        inflightPromise = new Promise<void>((r) => (inflightResolve = r))
        await Promise.race([inflightPromise, cancel$])
      }
    }

    /**
     * Flush the pending queue: execute anything that is old enough and not yet executed.
     */
    async function flushQueue(): Promise<void> {
      while (pendingQueue.length > 0) {
        const next = pendingQueue[0]!
        if (!shouldExecute(next)) {
          pendingQueue.shift()
          totalSkipped++
          continue
        }
        if (!isOldEnough(next.tx.timestamp)) {
          // Next message isn't old enough yet; wait for it or stop
          const ready = await waitUntilOldEnough(next.tx.timestamp)
          if (!ready) return // cancelled
          continue // re-check
        }
        pendingQueue.shift()
        await waitForSlot()
        spawnExecution(next)
      }
    }

    // cancelled flag
    let cancelled = false
    void cancel$.then(() => {
      cancelled = true
    })

    // Track the last seen receipt block so re-polls can resume from there
    let lastReceiptBlock: number | undefined

    /**
     * One-shot scan of ExecutionStateChanged logs on dest, starting from
     * `fromBlock` (or `startTimestamp` on first call). Returns the count of
     * new receipts found.
     */
    async function scanReceipts(fromBlock?: number): Promise<number> {
      let count = 0
      try {
        const filter: Parameters<typeof dest.getLogs>[0] = {
          address: offRamp,
          topics: ['ExecutionStateChanged'],
          ...(fromBlock != null ? { startBlock: fromBlock } : { startTime: startTimestamp }),
          ...(argv.page != null && { page: argv.page }),
        }
        for await (const log of dest.getLogs(filter)) {
          const receipt = (dest.constructor as ChainStatic).decodeReceipt(log)
          if (!receipt) continue

          // Filter by source chain
          if (
            receipt.sourceChainSelector &&
            receipt.sourceChainSelector !== sourceNetwork.chainSelector
          )
            continue

          executions.set(receipt.messageId, receipt.state)
          count++

          if (lastReceiptBlock == null || log.blockNumber > lastReceiptBlock) {
            lastReceiptBlock = log.blockNumber
          }
        }
      } catch (err) {
        if (!cancelled) logger.error('Error fetching receipts:', err)
      }
      return count
    }

    // ─── PHASE 1: Initial one-shot receipts scan on dest ───
    const receiptsDone$ = (async () => {
      logger.info('Fetching execution receipts on destination...')
      const count = await scanReceipts()
      receiptsCaughtUp = true
      logger.info(
        `📋 Receipts scan complete (${count} found). Starting to flush pending requests...`,
      )
    })()

    // ─── PHASE 2: Fetch send requests from source ───
    const requestsDone$ = (async () => {
      logger.info('Fetching send requests from source...')
      let lastProgressLog = Date.now()
      try {
        for await (const log of source.getLogs({
          address: onRamp,
          topics: ['CCIPMessageSent', 'CCIPSendRequested'],
          startTime: startTimestamp,
          watch: cancel$,
          ...(argv.page != null && { page: argv.page }),
        })) {
          const message = (source.constructor as ChainStatic).decodeMessage(log)
          if (!message) continue

          // Filter for our dest chain if the message has destChainSelector
          if (
            'destChainSelector' in message &&
            message.destChainSelector !== destNetwork.chainSelector
          )
            continue

          totalFound++

          if (Date.now() - lastProgressLog >= 10_000) {
            logger.info(
              `📡 Source scan progress: ${totalFound} requests found, ${totalSkipped} skipped, ${pendingQueue.length} queued, block=${log.blockNumber}`,
            )
            lastProgressLog = Date.now()
          }

          const timestamp =
            log.tx?.timestamp ?? (await source.getBlockTimestamp(log.blockNumber).catch(() => 0))

          // Build a minimal CCIPRequest for execution
          const [, version] = await source.typeAndVersion(log.address)
          const lane = {
            sourceChainSelector: sourceNetwork.chainSelector,
            destChainSelector: destNetwork.chainSelector,
            onRamp: log.address,
            version,
          }
          const request: CCIPRequest = {
            lane,
            message,
            log,
            tx: log.tx ?? {
              hash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp,
              from: '',
            },
          } as CCIPRequest

          // If receipts have caught up, we can immediately decide whether to queue
          if (receiptsCaughtUp) {
            if (!shouldExecute(request)) {
              totalSkipped++
              continue
            }
            pendingQueue.push(request)
            // Try to flush immediately
            await flushQueue()
          } else {
            // Receipts haven't caught up yet; queue and wait
            pendingQueue.push(request)
          }

          if (cancelled) break
        }
      } catch (err) {
        if (!cancelled) logger.error('Error fetching requests:', err)
      }
    })()

    // ─── PHASE 3: Wait for receipts to catch up, then flush + periodically re-poll receipts ───
    const flushLoop$ = (async () => {
      // Wait for the initial receipts scan to complete
      await receiptsDone$
      if (cancelled) return

      // Initial flush of everything queued while receipts were scanning
      await flushQueue()

      // Keep flushing as new items arrive, and periodically re-poll dest for new receipts
      const REPOLL_INTERVAL_MS = 30_000
      let lastRepoll = Date.now()
      while (!cancelled) {
        if (pendingQueue.length > 0) {
          await flushQueue()
        }

        // Periodically re-scan receipts from dest (picks up DON/other executor activity)
        if (Date.now() - lastRepoll >= REPOLL_INTERVAL_MS) {
          const fromBlock = lastReceiptBlock != null ? lastReceiptBlock + 1 : undefined
          const newCount = await scanReceipts(fromBlock)
          if (newCount > 0) {
            logger.debug(`Re-poll found ${newCount} new receipts`)
          }
          lastRepoll = Date.now()
        }

        // Wait a bit before checking again
        await new Promise<void>((r) => {
          const t = setTimeout(r, 2000)
          void cancel$.then(() => {
            clearTimeout(t)
            r()
          })
        })
      }
    })()

    // Wait for all phases
    await Promise.allSettled([receiptsDone$, requestsDone$, flushLoop$])

    // Wait for remaining in-flight executions
    if (inFlight > 0) {
      logger.info(`Waiting for ${inFlight} in-flight executions to complete...`)
      while (inFlight > 0) {
        inflightPromise = new Promise<void>((r) => (inflightResolve = r))
        await inflightPromise
      }
    }

    logger.info(
      `\nDone. Found: ${totalFound}, Executed: ${totalExecuted}, ` +
        `Skipped: ${totalSkipped}, Failed: ${totalFailed}`,
    )
  } finally {
    process.removeListener('SIGINT', onSigint)
  }
}
