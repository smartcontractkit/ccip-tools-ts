/**
 * OS-level network locks for the networked test suites (integration / e2e / fork).
 *
 * `node --test` spawns one child process per test file and runs them all
 * concurrently, so suites that share a public RPC endpoint can trip its rate
 * limiter. Each network tag is a directory under a well-known lock root:
 * `fs.mkdir` is atomic on POSIX and NTFS, so exactly one process can hold a tag
 * at a time and any other acquirer simply waits for it to be released — the
 * filesystem itself is the queue, and a waiting suite starts the moment the
 * previous holder finishes, with no batch scheduling at all.
 *
 * Usage — module top-level of a networked test file (the file's tests do not
 * start until every requested lock is held; the locks auto-release on process
 * exit, or earlier via the returned handle):
 *
 * ```ts
 * import { useResource } from '../../../scripts/useResource.ts'
 * await useResource(['sepolia', 'fuji'])
 * ```
 *
 * Suites that touch DIFFERENT networks per block should instead hold each
 * network only for the describe block that needs it (see
 * {@link useResourceForDescribe}), so unrelated blocks of the same file do not
 * serialize against other suites.
 *
 * Staleness: crashed holders self-heal. The next acquirer steals the directory
 * when the recorded owner process is no longer alive, or — when the owner file
 * is unreadable — when the directory is older than `UNOWNED_STALE_MS`. A lock
 * held by a live process is never stolen, no matter its age.
 *
 * Locks are per-machine (a directory cannot arbitrate across hosts), so all
 * networked suites must run inside a single CI job/runner.
 *
 * Env overrides:
 *   CCIP_TOOLS_TEST_LOCK_DIR         lock root (default: `<os.tmpdir()>/ccip-tools-ts-network-locks`)
 *   CCIP_TOOLS_TEST_LOCK_TIMEOUT_MS  max total wait for all requested locks (default: 60 min)
 *   CCIP_TOOLS_TEST_LOCK_VERBOSE     force lock diagnostics on in CI (default: local only)
 */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before } from 'node:test'

const LOCK_ROOT =
  process.env['CCIP_TOOLS_TEST_LOCK_DIR'] || join(tmpdir(), 'ccip-tools-ts-network-locks')
const TIMEOUT_MS = Number(process.env['CCIP_TOOLS_TEST_LOCK_TIMEOUT_MS']) || 3_600_000
const POLL_MS = 200
const LOG_INTERVAL_MS = 5_000
/** A lock directory without a readable owner.json is stolen once this old. */
const UNOWNED_STALE_MS = 10 * 60_000

/**
 * Lock diagnostics (acquire/wait/release lines) are for local debugging: they are
 * silent in CI unless VERBOSE is set, so they cannot pollute CI logs or the PR
 * coverage comment (which captures the full test output).
 */
const lockLoggingEnabled =
  !process.env['CI'] || !!process.env['VERBOSE'] || !!process.env['CCIP_TOOLS_TEST_LOCK_VERBOSE']

const RESOURCE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** resource tag → number of times this process has acquired it (refcounted). */
const held = new Map<string, number>()

export interface ResourceHandle {
  /** Releases the requested locks (idempotent). */
  release(): Promise<void>
}

function lockDir(resource: string): string {
  return join(LOCK_ROOT, resource)
}

function log(message: string): void {
  if (lockLoggingEnabled) console.error(`[network-locks] ${message}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isHeldHere(resource: string): boolean {
  return (held.get(resource) ?? 0) > 0
}

function describeHolder(resource: string): string {
  try {
    const info = JSON.parse(readFileSync(join(lockDir(resource), 'owner.json'), 'utf8')) as {
      pid?: unknown
      startedAt?: unknown
    }
    const startedAt =
      typeof info.startedAt === 'number' ? new Date(info.startedAt).toISOString() : '?'
    return `pid ${String(info.pid)} since ${startedAt}`
  } catch {
    return 'unknown owner'
  }
}

/**
 * A directory is stale when its recorded owner process is dead, or when no
 * readable owner is recorded and the directory is old enough that its creator
 * must have crashed mid-write (or the owner file was tampered with).
 */
function isStale(resource: string): boolean {
  const dir = lockDir(resource)
  let ownerPid: number | undefined
  try {
    const info = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')) as { pid?: unknown }
    if (typeof info.pid === 'number') ownerPid = info.pid
  } catch {
    // missing/corrupt owner.json → fall through to the mtime heuristic
  }
  if (ownerPid !== undefined) {
    try {
      process.kill(ownerPid, 0) // same-machine pid: locks are per-machine
      return false // alive → never steal, regardless of age
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ESRCH' // dead → stale
    }
  }
  try {
    return Date.now() - statSync(dir).mtimeMs > UNOWNED_STALE_MS
  } catch {
    return false // dir vanished (racing acquirer) → not stale, just retry
  }
}

/**
 * The lock root and tag dirs live at predictable names in the OS temp dir, which is
 * the point (unrelated test processes must find each other's locks) — so they are
 * hardened instead of randomized: restrictive perms, and a real, owned directory
 * that is never a planted symlink.
 */
function assertSafeLockPath(dir: string, what: string): void {
  const st = lstatSync(dir)
  if (!st.isDirectory() || (process.platform !== 'win32' && st.uid !== process.getuid?.())) {
    throw new Error(
      `refusing to use ${what} at ${dir}: not an own directory (symlink or foreign ownership)`,
    )
  }
}

/** Creates the coordination root if needed, with owner-only permissions. */
function ensureLockRoot(): void {
  mkdirSync(LOCK_ROOT, { recursive: true, mode: 0o700 })
  assertSafeLockPath(LOCK_ROOT, 'lock root')
  // Sweep abandoned stale-steal tombstones (renamed dead locks) that are older than
  // an hour; recent ones may still be the subject of an in-flight claim.
  const now = Date.now()
  for (const entry of readdirSync(LOCK_ROOT)) {
    if (!entry.startsWith('.tombstone-')) continue
    const tomb = join(LOCK_ROOT, entry)
    try {
      if (now - statSync(tomb).mtimeMs > 3_600_000) rmSync(tomb, { recursive: true, force: true })
    } catch {
      // raced away
    }
  }
}

/** Tries to take the lock; `false` means contended or stolen-just-now (retry). */
function tryAcquire(resource: string): boolean {
  const dir = lockDir(resource)
  if (isHeldHere(resource)) return true
  try {
    mkdirSync(dir, { mode: 0o700 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // A planted symlink must never be followed — remove the link itself and retry.
    try {
      if (lstatSync(dir).isSymbolicLink()) {
        rmSync(dir, { force: true })
        log(`removed symlink planted at lock path "${resource}"`)
        return false
      }
    } catch {
      // raced away; the retry loop re-checks
    }
    if (!isStale(resource)) return false
    const holder = describeHolder(resource)
    // Steal atomically: rename the stale dir to a unique tombstone so only one
    // waiter can claim it (a concurrent stealer's rename fails ENOENT). Without
    // this, two waiters can both see staleness and one can delete the other's
    // freshly re-created live lock, letting both proceed as owners.
    try {
      renameSync(dir, join(LOCK_ROOT, `.tombstone-${process.pid}-${Date.now()}`))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false // another waiter claimed it
      throw err
    }
    log(`stale lock stolen for "${resource}" (${holder})`)
    return false // outer loop retries immediately
  }
  try {
    // Predictable names in os.tmpdir() are required for cross-process coordination, so
    // the path is hardened instead: every dir above is validated owned+non-symlink
    // (assertSafeLockPath) and created 0o700, and the marker file itself is
    // owner-only (never readable/writable by other users).
    writeFileSync(
      join(dir, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      { mode: 0o600 },
    )
  } catch {
    // owner.json write failed (e.g. disk error) — drop the dir and retry
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`failed to write lock owner file for "${resource}" in ${dir}`)
  }
  log(`acquired "${resource}"`)
  return true
}

/**
 * Waits until every requested network is locked by this process, then returns.
 * Acquisition is all-or-nothing: if any single lock is contended the attempt is
 * rolled back and retried, which makes lock-order deadlocks impossible (two
 * processes each holding one lock the other wants can never wedge).
 */
export async function useResource(resources: string[]): Promise<ResourceHandle> {
  // The root may live under an env-overridden or sandboxed tmpdir that does not exist yet.
  ensureLockRoot()
  const wanted = [...new Set(resources)].sort()
  for (const resource of wanted) {
    if (!RESOURCE_NAME_RE.test(resource)) {
      throw new Error(`invalid network lock resource name: ${JSON.stringify(resource)}`)
    }
  }
  const deadline = Date.now() + TIMEOUT_MS
  let lastLogAt = 0
  for (;;) {
    const fresh: string[] = []
    let contended: string | undefined
    for (const resource of wanted) {
      if (isHeldHere(resource)) continue // already owned by this process: counted below
      if (tryAcquire(resource)) {
        fresh.push(resource)
      } else {
        contended = resource
        break
      }
    }
    if (contended === undefined) {
      // Count every requested resource against THIS handle — freshly acquired ones
      // and pre-held ones alike — so each handle's release withdraws exactly its
      // own share and the lock survives while any handle is still active.
      for (const resource of wanted) held.set(resource, (held.get(resource) ?? 0) + 1)
      let released = false
      return {
        release: async () => {
          if (released) return // idempotent: a second release must not touch shared state
          released = true
          for (const resource of [...wanted].reverse()) {
            const remaining = (held.get(resource) ?? 0) - 1
            if (remaining <= 0) {
              held.delete(resource)
              rmSync(lockDir(resource), { recursive: true, force: true })
              log(`released "${resource}"`)
            } else {
              held.set(resource, remaining)
            }
          }
        },
      }
    }
    // Roll back the partial attempt so other acquirers never see a half-set.
    // Only the freshly acquired dirs (never pre-held, never counted) are removed.
    for (const resource of fresh) {
      held.delete(resource)
      rmSync(lockDir(resource), { recursive: true, force: true })
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${TIMEOUT_MS} ms waiting for network lock "${contended}" ` +
          `(currently held by ${describeHolder(contended)} in ${lockDir(contended)}), ` +
          `lock root: ${LOCK_ROOT}`,
      )
    }
    if (Date.now() - lastLogAt >= LOG_INTERVAL_MS) {
      lastLogAt = Date.now()
      log(`waiting for "${contended}" — held by ${describeHolder(contended)}`)
    }
    await sleep(POLL_MS)
  }
}

/** Best-effort cleanup so crashed children self-heal on the next acquirer. */
process.on('exit', () => {
  for (const resource of held.keys()) {
    try {
      rmSync(lockDir(resource), { recursive: true, force: true })
    } catch {
      // noop — next acquirer's staleness check handles leftovers
    }
  }
})

/**
 * Holds the given networks for the enclosing `describe` block only, releasing
 * them when it finishes (also on failure — the `after` hook runs regardless).
 *
 * A whole-file `useResource` top-level call is right for suites that use the
 * same networks throughout. For suites whose blocks touch different networks,
 * holding every network for the file's whole lifetime serializes blocks
 * against other suites that need the same network for THEIR blocks — the
 * queue grows by the file duration, not by the time actually spent on the
 * contended network. Per-describe holding keeps each network locked only for
 * the block that reaches it, so unrelated work overlaps.
 *
 * MUST be called synchronously inside a `describe` body. The `before` hook has
 * no timeout on purpose: a `before` hook whose `timeout` fires is silently
 * abandoned and its tests RUN ANYWAY (node:test semantics), which would run
 * them unlocked. Instead the wait is bounded by `useResource`'s own
 * `CCIP_TOOLS_TEST_LOCK_TIMEOUT_MS`; when that expires the hook rejects, which
 * properly cancels the block's tests.
 *
 * ```ts
 * import { useResourceForDescribe } from '../../../scripts/useResource.ts'
 * describe('EVM to Solana', () => {
 *   useResourceForDescribe(['base-sepolia', 'solana-devnet'])
 *   it('…', async () => { … })
 * })
 * ```
 */
export function useResourceForDescribe(resources: string[]): void {
  let handle: ResourceHandle | undefined
  before(async () => {
    handle = await useResource(resources)
  })
  after(async () => {
    await handle?.release()
  })
}
