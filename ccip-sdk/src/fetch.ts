import { type AxiosAdapter, getAdapter } from 'axios'

import {
  CCIPAbortError,
  CCIPError,
  CCIPTimeoutError,
  isTransientHttpStatus,
} from './errors/index.ts'
import type { WithLogger } from './types.ts'
import { sleep } from './utils.ts'

/* eslint-disable jsdoc/require-jsdoc */
/**
 * Tuning for the rate-limited fetch wrapper.
 * - `maxRetries`: attempts on transient (429/5xx) responses.
 * - `seed`: optional proactive starting cap for hosts known to always throttle
 *   (e.g. TON public). When set, the default scope starts ACTIVE at this rate
 *   instead of full speed. It still adapts (relaxes up / tightens down).
 */
export type RateLimitOpts = {
  maxRetries: number
  /** Max concurrent in-flight requests per endpoint (default 5). */
  maxInFlight?: number
  seed?: { limit: number; windowMs: number }
}

/** Default (ceiling) max concurrent in-flight requests per endpoint. */
const DEFAULT_MAX_IN_FLIGHT = 5

/**
 * Adaptive concurrency limiter (AIMD on the in-flight cap).
 *
 * Starts at `ceiling` concurrent slots. A freed slot is handed straight to the
 * next waiter (FIFO), so the queue drains as soon as ANY in-flight request
 * finishes. On a rate-limit signal the effective cap is HALVED (down to 1) — so
 * under sustained limiting only a single request is in flight, retried with
 * exponential backoff until it succeeds; each success then bumps the cap back up
 * by one toward the ceiling. This collapses a "5-in, 5-out 429 storm" into one
 * patient retry, then re-expands once the endpoint recovers.
 */
class AdaptiveSemaphore {
  private inUse = 0
  private max: number
  private consecutiveOk = 0
  private readonly ceiling: number
  private readonly waiters: Array<() => void> = []
  /** Clean successes required before the cap grows by 1 (kept sticky at low cap). */
  private static readonly GROW_AFTER = 3
  constructor(ceiling: number) {
    this.ceiling = Math.max(1, ceiling)
    this.max = this.ceiling
  }
  /** Current effective concurrency cap (for tests/inspection). */
  get cap(): number {
    return this.max
  }
  async acquire(): Promise<void> {
    if (this.inUse < this.max) {
      this.inUse++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve)) // granted via grant()
  }
  release(): void {
    this.inUse = Math.max(0, this.inUse - 1)
    this.grant()
  }
  private grant(): void {
    while (this.inUse < this.max && this.waiters.length) {
      this.inUse++
      this.waiters.shift()!()
    }
  }
  /** Multiplicative decrease on a rate-limit signal (floored at 1). Resets the
   * success streak so the cap stays collapsed while 429s keep arriving. */
  decrease(): void {
    this.max = Math.max(1, Math.floor(this.max / 2))
    this.consecutiveOk = 0
  }
  /** Additive increase, but only after a clean run of successes with no 429 in
   * between — so under sustained limiting the cap sticks at 1 (one serial
   * request retried until it succeeds) and only re-expands once recovered. */
  increase(): void {
    if (this.max >= this.ceiling) return
    if (++this.consecutiveOk >= AdaptiveSemaphore.GROW_AFTER) {
      this.consecutiveOk = 0
      this.max++
      this.grant()
    }
  }
}

/** No-header window guess; slides between these bounds as limits are/aren't hit. */
const DEFAULT_WINDOW_MS = 1_000
const MIN_WINDOW_MS = 250
const MAX_WINDOW_MS = 60_000

function clampWindow(ms: number): number {
  return Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, Math.round(ms)))
}

/**
 * Adaptive per-(endpoint, scope) rate pacer.
 *
 * Stays INACTIVE — full speed, zero pacing — until pacing is warranted: either a
 * seed (known always-throttled host) or a 429 that carries an explicit reset
 * window (`Retry-After`/`RateLimit-Reset`). When active it paces evenly to
 * `limit` per `windowMs` (leaky bucket via `nextSendAt`). A 429 with NO window
 * (e.g. Solana's `x-ratelimit-method-limit`: count, no window) deliberately does
 * NOT activate pacing — those endpoints tolerate bursts and refill sub-second, so
 * burst + retry beats pacing to a guessed window. Sustained success speeds the
 * pace up and eventually deactivates, re-probing full speed.
 */
class AdaptiveLimiter {
  active: boolean
  limit: number
  windowMs: number
  private nextSendAt = 0
  private lastLimitTs = 0
  private successStreak = 0

  constructor(seed?: { limit: number; windowMs: number }) {
    this.active = seed != null
    this.limit = Math.max(1, seed?.limit ?? 1)
    this.windowMs = clampWindow(seed?.windowMs ?? DEFAULT_WINDOW_MS)
  }

  /** Wait (only when active) for this scope's evenly-paced slot. */
  async acquire(): Promise<void> {
    if (!this.active) return
    const now = Date.now()
    const at = Math.max(now, this.nextSendAt)
    this.nextSendAt = at + this.windowMs / this.limit // reserve next slot synchronously
    if (at > now) await sleep(at - now)
  }

  /** On a 429: activate + pace ONLY when an explicit reset window is known.
   * For already-active (seeded) limiters with no reset hint, back off by doubling
   * the window so retries space out exponentially instead of hammering at fixed pace. */
  onLimited(hint: { limit?: number; windowMs?: number }): void {
    if (hint.windowMs == null) {
      // No explicit reset window. Inactive limiters (e.g. Solana) rely on jittered backoff
      // in the retry loop. Active (seeded) limiters — like TON — double the pacing window
      // so each consecutive 429 waits twice as long before the next attempt.
      if (this.active) {
        this.windowMs = clampWindow(this.windowMs * 2)
        this.lastLimitTs = Date.now()
      }
      return
    }
    this.limit = Math.max(1, hint.limit ?? this.limit)
    this.windowMs = clampWindow(hint.windowMs)
    this.lastLimitTs = Date.now()
    this.nextSendAt = this.lastLimitTs
    this.successStreak = 0
    this.active = true
  }

  /** Record header limit/window without activating (used if a 429 later hits). */
  learn(limit?: number, windowMs?: number): void {
    if (limit != null) this.limit = Math.max(1, limit)
    if (windowMs != null) this.windowMs = clampWindow(windowMs)
  }

  /** On success: probe faster after a clean run, deactivate after a long one. */
  onSuccess(): void {
    if (!this.active) return
    const now = Date.now()
    if (now - this.lastLimitTs > this.windowMs && ++this.successStreak >= this.limit) {
      this.windowMs = clampWindow(this.windowMs * 0.7)
      this.limit += Math.max(1, Math.floor(this.limit / 4))
      this.successStreak = 0
    }
    if (now - this.lastLimitTs > Math.max(5_000, this.windowMs * 8)) this.active = false
  }
}

/** Per-endpoint shared state: concurrency gate + per-scope limiters + learned getLogs range. */
interface EndpointState {
  sem: AdaptiveSemaphore
  limiters: Map<string, AdaptiveLimiter>
  /** Seed applied to newly-created limiters for this endpoint (known hosts). */
  seed?: { limit: number; windowMs: number }
  /** True once we've seen method-scoped rate headers; routes by JSON-RPC method. */
  methodScoped: boolean
  logRange?: { maxRange: number; source: 'error' | 'success' }
}

/** Module-global registry keyed by origin + pathname (query/hash stripped). */
const endpointRegistry = new Map<string, EndpointState>()

/** Derive a stable key from a fetch input (string | URL | Request). */
export function endpointKey(input: Parameters<typeof fetch>[0]): string {
  try {
    let url: URL
    if (typeof input === 'string') {
      url = new URL(input)
    } else if (input instanceof Request) {
      url = new URL(input.url)
    } else {
      url = input
    }
    return url.origin + url.pathname
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return typeof input === 'string' ? input : String(input)
  }
}

function getOrCreateEndpoint(
  input: Parameters<typeof fetch>[0],
  seed?: { limit: number; windowMs: number },
  maxInFlight: number = DEFAULT_MAX_IN_FLIGHT,
): EndpointState {
  const key = endpointKey(input)
  let state = endpointRegistry.get(key)
  if (!state) {
    state = {
      sem: new AdaptiveSemaphore(maxInFlight),
      limiters: new Map(),
      seed,
      methodScoped: false,
    }
    endpointRegistry.set(key, state)
  }
  return state
}

function getLimiter(ep: EndpointState, scope: string): AdaptiveLimiter {
  let lim = ep.limiters.get(scope)
  if (!lim) {
    lim = new AdaptiveLimiter(ep.seed)
    ep.limiters.set(scope, lim)
  }
  return lim
}
/* eslint-enable jsdoc/require-jsdoc */

/**
 * Parses a Retry-After header value into an epoch-ms wait-until time.
 * Handles both delta-seconds (integer) and HTTP-date formats.
 * @param value - The raw header value.
 * @returns Epoch-ms when retry is allowed, or null if unparseable.
 */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  // Try delta-seconds first
  const deltaSeconds = Number(trimmed)
  if (!isNaN(deltaSeconds) && isFinite(deltaSeconds)) {
    return Date.now() + deltaSeconds * 1000
  }
  // Try HTTP-date
  const parsed = Date.parse(trimmed)
  if (!isNaN(parsed)) return parsed
  return null
}

/** Parsed rate-limit header information. */
export interface ParsedRateLimitHeaders {
  /** Remaining allowed requests in the current window. */
  remaining?: number
  /** Total limit for the window. */
  limit?: number
  /** Epoch-ms when the window resets. */
  resetAt?: number
  /** Epoch-ms when retry is allowed (from Retry-After). */
  retryAfterAt?: number
}

/**
 * Parses standard and de-facto rate-limit response headers.
 *
 * Supports:
 * - `Retry-After`: delta-seconds or HTTP-date
 * - IETF draft: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (delta-seconds)
 * - Combined `RateLimit:` header (e.g. `limit=100, remaining=50, reset=10`)
 * - De-facto: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
 *   (reset heuristic: if value \> (now/1000 - 1e9) treat as epoch-seconds, else delta-seconds)
 * @param headers - Response headers.
 * @returns Parsed rate-limit info.
 */
export function parseRateLimitHeaders(headers: Headers): ParsedRateLimitHeaders {
  const result: ParsedRateLimitHeaders = {}
  const now = Date.now()
  const num = (name: string): number | undefined => {
    const raw = headers.get(name)
    const v = raw == null ? NaN : Number(raw)
    return isNaN(v) ? undefined : v
  }

  const retryAfter = parseRetryAfter(headers.get('Retry-After'))
  if (retryAfter !== null) result.retryAfterAt = retryAfter

  // Combined IETF header, e.g. "RateLimit: limit=100, remaining=50, reset=10".
  const combined = headers.get('RateLimit')
  if (combined) {
    for (const part of combined.split(',')) {
      const [k, v] = part.split('=').map((s) => s.trim())
      const val = Number(v)
      if (!k || isNaN(val)) continue
      if (k.toLowerCase() === 'limit') result.limit = val
      else if (k.toLowerCase() === 'remaining') result.remaining = val
      else if (k.toLowerCase() === 'reset') result.resetAt = now + val * 1000 // delta-seconds
    }
  }

  // Individual headers override the combined one: IETF (`RateLimit-*`, reset is
  // delta-seconds) then de-facto `X-RateLimit-*` (reset > 1e9 = epoch-seconds,
  // else delta-seconds — a >31yr delta window is implausible).
  for (const [prefix, resetMayBeEpoch] of [
    ['RateLimit', false],
    ['X-RateLimit', true],
  ] as const) {
    const limit = num(`${prefix}-Limit`)
    if (limit !== undefined) result.limit = limit
    const remaining = num(`${prefix}-Remaining`)
    if (remaining !== undefined) result.remaining = remaining
    const reset = num(`${prefix}-Reset`)
    if (reset !== undefined)
      result.resetAt = resetMayBeEpoch && reset > 1e9 ? reset * 1000 : now + reset * 1000
  }

  return result
}

/** A learned rate hint for one response: limit/window/remaining + whether method-scoped. */
interface RateHint {
  limit?: number
  windowMs?: number
  remaining?: number
  methodScoped: boolean
}

/**
 * Extracts a rate hint from a response. Prefers method-scoped headers
 * (`x-ratelimit-method-*`, e.g. Solana — limit is per JSON-RPC method, window
 * unknown so left to the limiter's estimate) over standard
 * `RateLimit-*`/`X-RateLimit-*`/`Retry-After` (which carry a reset window).
 * @param response - The fetch Response.
 * @param method - The JSON-RPC method, if known.
 * @returns The parsed hint.
 */
function extractRateHint(response: Response, method?: string): RateHint {
  const mLimitRaw = response.headers.get('x-ratelimit-method-limit')
  const mRemainingRaw = response.headers.get('x-ratelimit-method-remaining')
  // Header must be PRESENT — Number(null) is 0, not NaN, so a missing header
  // would otherwise read as a (bogus) method limit of 0 and throttle everything.
  if (method && mLimitRaw != null && mRemainingRaw != null) {
    const limit = Number(mLimitRaw)
    const remaining = Number(mRemainingRaw)
    if (!isNaN(limit) && !isNaN(remaining)) {
      return { limit, remaining, methodScoped: true }
    }
  }
  const std = parseRateLimitHeaders(response.headers)
  const resetAt = std.resetAt ?? std.retryAfterAt
  const windowMs = resetAt != null ? resetAt - Date.now() : undefined
  return {
    limit: std.limit,
    remaining: std.remaining,
    windowMs: windowMs != null && windowMs > 0 ? windowMs : undefined,
    methodScoped: false,
  }
}

/**
 * Returns starting rate-limit opts for a host. Most hosts get NO proactive seed
 * (they start at full speed and only adapt if they actually return 429s). Known
 * always-throttled public hosts get an informed `seed` so they start paced — but
 * the seed is just a starting point; the adaptive limiter still relaxes up or
 * tightens down from there based on observed responses.
 * Chain files call `createRateLimitedFetch(fetchProfileForUrl(url), ctx)`.
 * @param url - The endpoint URL string.
 * @returns Partial RateLimitOpts (optionally with a `seed`) for the host.
 */
export function fetchProfileForUrl(url: string): Partial<RateLimitOpts> {
  try {
    const { hostname } = new URL(url)
    // TON public gateways genuinely cap at ~1 req/sec and 429 constantly from a
    // cold start, so seed them paced. Still adapts from there.
    if (
      hostname === 'toncenter.com' ||
      hostname.endsWith('.toncenter.com') ||
      hostname === 'tonapi.io' ||
      hostname.endsWith('.tonapi.io')
    ) {
      return { seed: { limit: 1, windowMs: 1500 }, maxRetries: 6 }
    }
    // Public Solana: no proactive seed. Its responses carry precise per-method
    // limit headers (`x-ratelimit-method-*`), so the adaptive limiter learns the
    // exact per-method rate (e.g. getSignaturesForAddress: 2/s) from the first
    // responses and paces only that method — faster and more accurate than a
    // static seed. Left to start at full speed.
  } catch {
    // Invalid URL — fall through to the default (no seed)
  }
  // Default: start at full speed, adapt reactively on 429.
  return {}
}

/**
 * Returns the learned getLogs max range for an endpoint, if set.
 * @param input - Fetch input (string, URL, or Request).
 * @returns Max block range, or undefined if not learned.
 */
export function getEndpointLogRange(input: Parameters<typeof fetch>[0]): number | undefined {
  return endpointRegistry.get(endpointKey(input))?.logRange?.maxRange
}

/**
 * Sets the learned getLogs max range for an endpoint.
 * @param input - Fetch input (string, URL, or Request).
 * @param maxRange - The learned max block range.
 * @param source - Whether learned from an error or a success.
 */
export function setEndpointLogRange(
  input: Parameters<typeof fetch>[0],
  maxRange: number,
  source: 'error' | 'success',
): void {
  getOrCreateEndpoint(input).logRange = { maxRange, source }
}

/** Buffer in ms added after a rate-limit reset before sending next request. */
const RESET_BUFFER_MS = 200

/** Best-effort printable form of a request body (JSON string) for debug logs. */
function bodyStr(body: RequestInit['body']): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  return undefined
}

/** Extracts the JSON-RPC method name from a request body, if present. */
function extractMethod(init?: RequestInit): string | undefined {
  if (!init?.body || (typeof init.body !== 'string' && typeof init.body !== 'object')) return
  try {
    const parsed = (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) as
      | { method?: string }
      | undefined
    if (parsed && typeof parsed.method === 'string') return parsed.method
  } catch {
    // Not JSON or no method field
  }
}

/**
 * Creates a fetch wrapper that runs at full speed by default and adaptively
 * paces only when an endpoint actually rate-limits it. Per (endpoint, method)
 * limiters learn the real limit/window from response headers or observed timing,
 * pace to it, tighten on repeat 429s, and relax back to full speed when limits
 * stop. Shares learned state per endpoint across all instances.
 * @returns The wrapped fetch function.
 */
export function createRateLimitedFetch(
  opts: Partial<RateLimitOpts> = {},
  { logger = console, abort }: { abort?: AbortSignal } & WithLogger = {},
): typeof fetch {
  opts.maxRetries ??= 15
  const opts_ = opts as RateLimitOpts

  const isRetryableError = (error: unknown): boolean => {
    if (error instanceof Error) return !!error.message.match(/\b(429\b|rate.?limit)/i)
    return false
  }

  // Backoff used when the limiter is NOT pacing (occasional/bursty 429s). Uses
  // FULL JITTER over a 250ms→2s ramp: critical because callers often fire a
  // burst of requests concurrently, so a fixed delay would retry them all in
  // lock-step and re-trip the limit (thundering herd). Jitter spreads the
  // retries out, letting most land in a freed slot.
  const backoffMs = (attempt: number): number =>
    Math.floor(Math.random() * Math.min(15_000, 250 * 2 ** attempt))

  return async (input, init?) => {
    let lastError: Error | null = null
    const method = extractMethod(init)
    const ep = getOrCreateEndpoint(input, opts_.seed, opts_.maxInFlight)

    for (let attempt = 0; attempt <= opts_.maxRetries; attempt++) {
      // Resolve the limiter for this request's scope (re-resolved each attempt:
      // methodScoped may flip after the first response).
      const scope = ep.methodScoped && method ? method : '*'
      const lim = getLimiter(ep, scope)
      let response: Response
      let retryDelay = 0
      try {
        // Concurrency gate: at most `maxInFlight` requests per endpoint are in
        // flight at once. The slot is held ONLY across the fetch + header read,
        // then released so the next queued request starts immediately (it sees
        // any limit learned from this response). Backoff/retry happen outside
        // the slot so a backing-off request doesn't occupy a slot.
        await ep.sem.acquire()
        try {
          // Pace only if this scope is currently rate-limited; full speed otherwise.
          await lim.acquire()

          if (init?.signal && abort) init.signal = AbortSignal.any([init.signal, abort])
          else if (abort) {
            if (!init) init = {}
            init.signal = abort
          }
          abort?.throwIfAborted()
          response = await globalThis.fetch(input instanceof Request ? input.clone() : input, init)

          // Learn from rate-limit headers BEFORE releasing the slot, so the next
          // queued request paces against the freshest known limit. The "target"
          // limiter owns this scope (a method limiter once the host is known
          // method-scoped, else the per-endpoint '*' limiter).
          const hint = extractRateHint(response, method)
          if (hint.methodScoped) ep.methodScoped = true
          const target = ep.methodScoped && method ? getLimiter(ep, method) : lim
          target.learn(hint.limit, hint.windowMs)
          if (response.ok) {
            target.onSuccess()
            ep.sem.increase() // AIMD: a success widens the concurrency cap by one
          } else if (isTransientHttpStatus(response.status)) {
            target.onLimited({ limit: hint.limit, windowMs: hint.windowMs })
            ep.sem.decrease() // AIMD: a 429/5xx halves the cap (toward 1)
            if (attempt < opts_.maxRetries) {
              // Decide the retry wait now (executed after the slot is released):
              // explicit reset → honor it; active pacing → acquire() handles it;
              // else jittered backoff.
              if (hint.windowMs != null && hint.remaining === 0)
                retryDelay = hint.windowMs + RESET_BUFFER_MS
              else if (!target.active) retryDelay = backoffMs(attempt)
            }
          }
        } finally {
          ep.sem.release()
        }
      } catch (error) {
        logger.debug('fetch errored', attempt, error, input, bodyStr(init?.body))
        lastError = error instanceof Error ? error : CCIPError.from(error, 'HTTP_ERROR')

        // Only retry on retryable network errors (rate-limit pattern); rethrow everything else
        if (!isRetryableError(lastError)) throw lastError
        if (attempt >= opts_.maxRetries) break
        // Treat a rate-limit-flavored network error as a limit signal: narrow the
        // concurrency cap and back off before retrying (no header → no pacing).
        ep.sem.decrease()
        if (!lim.active) await sleep(backoffMs(attempt))
        continue
      }

      // Slot released — now handle the response (and back off off-slot if retrying).
      if (response.ok) {
        logger.debug('fetched', response.status, bodyStr(init?.body))
        return response
      }
      if (isTransientHttpStatus(response.status)) {
        if (attempt < opts_.maxRetries) {
          logger.debug('fetch transient error, retrying', response.status, attempt, retryDelay)
          if (retryDelay > 0) await sleep(retryDelay)
          continue
        }
        logger.debug('fetch transient error, retries exhausted', response.status)
        return response
      }
      // Non-transient non-ok (4xx etc): return immediately, no retry.
      logger.debug('fetch non-retryable status', input, response.status, bodyStr(init?.body))
      return response
    }

    throw lastError || CCIPError.from('Request failed after all retries', 'HTTP_ERROR')
  }
}

/**
 * Creates an axios adapter that routes requests through a custom `fetch` function,
 * with optional `AbortSignal` propagation.
 *
 * Wraps axios's built-in `'fetch'` adapter so that all HTTP traffic goes through
 * the provided `fetchFn` (e.g. a rate-limited fetch). When `abort` is supplied,
 * it is merged (via `AbortSignal.any`) with any per-request signal already set on
 * the axios config, so callers don't need to thread the abort signal manually.
 *
 * @param fetchFn - The `fetch` implementation to bind (e.g. from `createRateLimitedFetch`).
 * @param abort - Optional `AbortSignal` to merge into every request's signal.
 * @returns An axios adapter ready to pass as `httpAdapter` in an axios/TonClient config.
 *
 * @example
 * ```typescript
 * const fetchFn = createRateLimitedFetch(fetchProfileForUrl(url), ctx)
 * const httpAdapter = createAxiosFetchAdapter(fetchFn, ctx?.abort)
 * const client = new TonClient({ endpoint: url, httpAdapter })
 * ```
 */
export function createAxiosFetchAdapter(fetchFn: typeof fetch, abort?: AbortSignal): AxiosAdapter {
  const base = (getAdapter as (name: string, config: object) => AxiosAdapter)('fetch', {
    env: { fetch: fetchFn },
  })
  if (!abort) return base
  return (config) =>
    base({
      ...config,
      signal: config.signal ? AbortSignal.any([config.signal as AbortSignal, abort]) : abort,
    })
}

/**
 * Performs a fetch request with timeout and abort signal support.
 *
 * @param url - URL to fetch
 * @param operation - Operation name for error context
 * @param opts - Optional configuration:
 *   - `timeoutMs` — request timeout in milliseconds (default: 30000).
 *   - `signal` — an external `AbortSignal` to cancel the request.
 *   - `fetch` — custom fetch function (defaults to `globalThis.fetch`).
 *   - `init` — additional `RequestInit` fields merged into the fetch call.
 * @returns Promise resolving to Response
 * @throws CCIPTimeoutError if request times out
 * @throws CCIPAbortError if request is aborted via signal
 */
export async function fetchWithTimeout(
  url: string,
  operation: string,
  opts?: {
    timeoutMs?: number
    signal?: AbortSignal
    fetch?: typeof globalThis.fetch
    init?: RequestInit
  },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 30_000
  const fetchFn = opts?.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = opts?.signal
    ? AbortSignal.any([timeoutSignal, opts.signal])
    : timeoutSignal

  try {
    return await fetchFn(url, { ...opts?.init, signal: combinedSignal })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      if (opts?.signal?.aborted) {
        throw new CCIPAbortError(operation)
      }
      throw new CCIPTimeoutError(operation, timeoutMs)
    }
    throw error
  }
}

/** Range error info from a getLogs "range too large" error. */
export interface LogRangeErrorInfo {
  /** Maximum allowed block range, if extractable from the error message. */
  maxRange?: number
  /** Suggested [from, to] block range in decimal, if provided by the RPC. */
  suggestedRange?: [number, number]
}

/**
 * Parses RPC errors for "getLogs block range too large" messages.
 *
 * Covers Alchemy, Infura, QuickNode, and generic EVM provider patterns.
 * Also checks JSON-RPC error code -32005.
 *
 * @param err - The caught error (any shape).
 * @returns Non-null LogRangeErrorInfo if the error is a range error, null otherwise.
 */
export function parseLogRangeError(err: unknown): LogRangeErrorInfo | null {
  if (err == null) return null

  // Gather candidate message strings from common error shapes
  const messages: string[] = []

  const extractMessages = (val: unknown): void => {
    if (typeof val === 'string') {
      messages.push(val)
    } else if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>
      // JSON-RPC code -32005
      if ('code' in obj && (obj.code === -32005 || obj.code === '-32005')) {
        // Treat as a range error even if message doesn't match; will return {}
        messages.push('__code32005__')
      }
      for (const key of ['message', 'error', 'data', 'body', 'details'] as const) {
        if (key in obj) extractMessages(obj[key])
      }
    }
  }
  extractMessages(err)

  const isCode32005 = messages.includes('__code32005__')
  const textMessages = messages.filter((m) => m !== '__code32005__')

  // Range-error patterns (case-insensitive)
  const RANGE_ERROR_PATTERNS = [
    // Alchemy: "up to a 10000 block range"
    /up to a (\d+) block range/i,
    // Infura: "query returned more than 10000 results"
    /query returned more than (\d+) results/i,
    // QuickNode
    /eth_getLogs is limited to a (\d+) range/i,
    /exceeds the range/i,
    // Generic
    /range too large/i,
    /limit exceeded/i,
    /too many (?:results|logs|blocks)/i,
    /response size exceeded/i,
  ]

  // Generic block-range detector: any message mentioning a block "range" is
  // treated as a range error, and any number in that same message is taken as
  // the max range (e.g. Astar/erpc "block range is too wide (maximum 1024)").
  const BLOCK_RANGE_RE = /\bblock\b.*\brange\b/i
  const FIRST_NUMBER_RE = /\b(\d+)\b/

  // Alchemy suggested range: [0x..., 0x...]
  const ALCHEMY_SUGGESTED_RANGE = /\[(0x[0-9a-f]+),\s*(0x[0-9a-f]+)\]/i

  let isRangeError = isCode32005
  let maxRange: number | undefined
  let suggestedRange: [number, number] | undefined

  for (const msg of textMessages) {
    for (const pattern of RANGE_ERROR_PATTERNS) {
      const match = pattern.exec(msg)
      if (match) {
        isRangeError = true
        // First capture group = the limit number
        if (match[1] !== undefined) {
          const n = Number(match[1])
          if (!isNaN(n) && (maxRange === undefined || n < maxRange)) maxRange = n
        }
      }
    }
    // Generic: a message about a block range is a range error; any number in
    // that same message is the max range (covers "(maximum N)", "limited to N", …).
    if (BLOCK_RANGE_RE.test(msg)) {
      isRangeError = true
      const numMatch = FIRST_NUMBER_RE.exec(msg)
      if (numMatch) {
        const n = Number(numMatch[1])
        if (!isNaN(n) && n > 0 && (maxRange === undefined || n < maxRange)) maxRange = n
      }
    }

    // Alchemy-style suggested range
    const rangeMatch = ALCHEMY_SUGGESTED_RANGE.exec(msg)
    if (rangeMatch) {
      isRangeError = true
      const from = parseInt(rangeMatch[1]!, 16)
      const to = parseInt(rangeMatch[2]!, 16)
      if (!isNaN(from) && !isNaN(to)) suggestedRange = [from, to]
    }
  }

  if (!isRangeError) return null

  const info: LogRangeErrorInfo = {}
  if (maxRange !== undefined) info.maxRange = maxRange
  if (suggestedRange !== undefined) info.suggestedRange = suggestedRange
  return info
}
