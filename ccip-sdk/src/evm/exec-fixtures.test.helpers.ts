/**
 * Executable-fixture selection for the fork-based manual-execution tests.
 *
 * The tests re-execute real FAILED messages on live-forked testnets. A pinned
 * message rots: someone executes it on the live chain, or public RPCs prune its
 * source transaction. So the pin is only the first candidate; the lane's newest
 * failed messages from the staging CCIP API follow it.
 */
import type { CCIPAPIClient } from '../api/index.ts'
import {
  CCIPError,
  CCIPErrorCode,
  CCIPMessageIdNotFoundError,
  shouldRetry,
} from '../errors/index.ts'
import { type CCIPVersion, MessageStatus } from '../types.ts'

/** An executable failed-message fixture: message id plus its source tx hash. */
export type ExecFixture = { messageId: string; txHash?: string }

/** Cap on candidates per test: bounds API calls and execution attempts. */
const MAX_FIXTURES = 3

/**
 * The pinned message (when the API still reports it failed and ready for manual
 * execution), then the lane's newest such messages to the same receiver, on
 * `version`. API errors other than "not found" fail the caller.
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
    api.getMessageById(messageId).catch((err: unknown) => {
      if (err instanceof CCIPMessageIdNotFoundError) return undefined
      throw err
    })
  const executable = (msg: Awaited<ReturnType<typeof lookup>>) =>
    msg?.metadata.status === MessageStatus.Failed &&
    msg.metadata.readyForManualExecution &&
    msg.lane.version === version &&
    BigInt(msg.lane.sourceChainSelector) === sourceSelector &&
    BigInt(msg.lane.destChainSelector) === destSelector

  const pinMsg = await lookup(pinned.messageId)
  const receiver = (pinMsg?.message as { receiver?: string } | undefined)?.receiver?.toLowerCase()
  const fixtures: ExecFixture[] = executable(pinMsg) ? [pinned] : []

  const page = await api.searchMessages(
    {
      sourceChainSelector: sourceSelector,
      destChainSelector: destSelector,
      readyForManualExecOnly: true,
    },
    { limit: 25 },
  )
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
    if (executable(await lookup(hit.messageId)))
      fixtures.push({ messageId: hit.messageId, txHash: hit.sendTransactionHash })
  }
  return fixtures
}

/** Upstream trouble seen through the forks: SDK transient errors, 429s, and the
 * empty revert an anvil fork reports when its upstream rate-limits it. */
const isTransient = (err: unknown) =>
  shouldRetry(err) || /\b429\b|missing revert data/i.test((err as Error | null)?.message ?? '')

/**
 * Runs `attempt` on each fixture not in `usedIds` until one succeeds. Each tried id
 * joins `usedIds`: a message executed (or found unusable) by one test is not tried
 * again by the next. A transient failure is retried once; an assertion failure
 * rethrows at once. When no fixture executes, fails with every fixture's error.
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
    for (let retry = 0; ; retry++) {
      try {
        return await attempt(fixture)
      } catch (err) {
        if (err instanceof Error && err.name === 'AssertionError') throw err
        if (retry === 0 && isTransient(err)) continue
        errors.push(`${fixture.messageId}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
    }
  }
  throw new CCIPError(
    CCIPErrorCode.UNKNOWN,
    `no fixture executed (${fixtures.length} ranked, others already used):\n${errors.join('\n')}`,
  )
}
