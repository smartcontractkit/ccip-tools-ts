/**
 * Executable-fixture selection for the fork-based manual-execution tests.
 *
 * The tests re-execute real FAILED messages on live-forked testnets. A pinned
 * message rots: someone executes it on the live chain, or public RPCs prune its
 * source transaction. So the pin is only the first candidate; the lane's newest
 * failed messages from the staging CCIP API follow it.
 */
import type { CCIPAPIClient } from '../api/index.ts'
import { CCIPError, CCIPErrorCode, CCIPMessageIdNotFoundError } from '../errors/index.ts'
import { type CCIPVersion, MessageStatus } from '../types.ts'
import { isTransientForkError, withForkRetry } from './fork-retry.test.helpers.ts'

/** An executable failed-message fixture: message id plus its source tx hash. */
export type ExecFixture = { messageId: string; txHash?: string }

/** Cap on candidates per test: bounds API calls and execution attempts. */
const MAX_FIXTURES = 3

/**
 * The pinned message (when the API still reports it failed and ready for manual
 * execution), then the lane's newest such messages to the same receiver, on
 * `version`. Transient API errors (e.g. a timeout) are retried; when they persist, the
 * pin is kept unverified and the search is skipped, so one slow API call cannot cancel a
 * whole suite (the test itself then reports whether the pin still executes). Other API
 * errors fail the caller.
 */
export async function rankExecFixtures(opts: {
  api: Pick<CCIPAPIClient, 'getMessageById' | 'searchMessages'>
  pinned: ExecFixture
  version: CCIPVersion
  sourceSelector: bigint
  destSelector: bigint
}): Promise<ExecFixture[]> {
  const { api, pinned, version, sourceSelector, destSelector } = opts
  const lookup = (messageId: string) =>
    withForkRetry(() => api.getMessageById(messageId)).catch((err: unknown) => {
      if (err instanceof CCIPMessageIdNotFoundError) return undefined
      throw err
    })
  const executable = (msg: Awaited<ReturnType<typeof lookup>>) =>
    msg?.metadata.status === MessageStatus.Failed &&
    msg.metadata.readyForManualExecution &&
    msg.lane.version === version &&
    BigInt(msg.lane.sourceChainSelector) === sourceSelector &&
    BigInt(msg.lane.destChainSelector) === destSelector

  let pinMsg
  try {
    pinMsg = await lookup(pinned.messageId)
  } catch (err) {
    if (!isTransientForkError(err)) throw err
    return [pinned] // the API is unreachable: try the pin as it is
  }
  const receiver = (pinMsg?.message as { receiver?: string } | undefined)?.receiver?.toLowerCase()
  const fixtures: ExecFixture[] = executable(pinMsg) ? [pinned] : []

  let page
  try {
    page = await withForkRetry(() =>
      api.searchMessages(
        {
          sourceChainSelector: sourceSelector,
          destChainSelector: destSelector,
          readyForManualExecOnly: true,
        },
        { limit: 25 },
      ),
    )
  } catch (err) {
    if (!isTransientForkError(err)) throw err
    return fixtures // the search is unreachable: the verified pin, if any
  }
  const hits = page.data
    .filter(
      (hit) =>
        hit.messageId !== pinned.messageId &&
        hit.status === MessageStatus.Failed &&
        (!receiver || hit.receiver.toLowerCase() === receiver),
    )
    .sort((a, b) => Date.parse(b.sendTimestamp) - Date.parse(a.sendTimestamp))
  for (const hit of hits) {
    if (fixtures.length >= MAX_FIXTURES) break
    const msg = await lookup(hit.messageId).catch((err: unknown) => {
      if (!isTransientForkError(err)) throw err
      return undefined // an unreachable candidate is skipped
    })
    if (executable(msg))
      fixtures.push({ messageId: hit.messageId, txHash: hit.sendTransactionHash })
  }
  return fixtures
}

/**
 * Runs `attempt` on each fixture not in `usedIds` until one succeeds. Each tried id
 * joins `usedIds`: a message executed (or found unusable) by one test is not tried
 * again by the next. A transient fork error is retried (`withForkRetry`); an
 * assertion failure rethrows at once. When no fixture executes, fails with every
 * fixture's error.
 */
export async function tryExecFixtures(
  fixtures: readonly ExecFixture[],
  usedIds: Set<string>,
  attempt: (fixture: ExecFixture) => Promise<void>,
): Promise<void> {
  const errors: string[] = []
  for (const fixture of fixtures) {
    if (usedIds.has(fixture.messageId)) continue
    usedIds.add(fixture.messageId)
    try {
      return await withForkRetry(() => attempt(fixture))
    } catch (err) {
      if (err instanceof Error && err.name === 'AssertionError') throw err
      errors.push(`${fixture.messageId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new CCIPError(
    CCIPErrorCode.UNKNOWN,
    `no fixture executed (${fixtures.length} ranked, others already used):\n${errors.join('\n')}`,
  )
}
