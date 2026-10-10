/**
 * HTTP resilience for the requests this plugin issues itself.
 *
 * This plugin never proxies chat traffic: the host's `dsh-llm-pi-ai` adapter
 * owns protocol serialization, streaming and retries for the three
 * `sub2api-*` routes. Only a few request paths belong to this plugin —
 * `web-search.ts` (POST `/responses`), `image-tools.ts` (`gatewayFetch` and the
 * remote-image download) and the reasoning probe, which already carries its own
 * `Retry-After` handling and is deliberately left untouched.
 *
 * Those paths used to accept only the caller's `AbortSignal`: a gateway that
 * accepted the connection and then stopped sending data held the request until
 * the caller's *total* timeout, which cannot tell "still generating" from
 * "already dead"; and a `429` was reported to the user even when the gateway
 * had just said how long to wait. This module supplies the two primitives that
 * close that gap. Both are pure, host-independent functions so they can be
 * unit-tested on their own:
 *
 * - {@link idleWatchdog}: abort a request that produced no data for a while,
 *   while keeping "the gateway went quiet" distinguishable from "the caller
 *   cancelled".
 * - {@link retryAfterDelay} and {@link fetchWithResilience}: at most one extra
 *   attempt, and only for a `429` whose delay this module can actually parse.
 *
 * Every default here is bounded and observable. Retries never exceed
 * {@link RATE_LIMIT_RETRY_LIMIT}; an unparseable `Retry-After` means no retry
 * at all; and no code path retries a non-`429` status. Nothing in this module
 * invents an unbounded retry loop.
 *
 * @module dsh-sub2api/http-resilience
 */

/** What a failed gateway response means for the caller. */
export type HttpFailureKind = 'rate-limited' | 'auth' | 'quota' | 'transient' | 'permanent'

/** Classification of one failed response plus the wait it implies. */
export interface HttpFailure {
  kind: HttpFailureKind
  /** Milliseconds the caller should wait before touching this route again. */
  cooldownMs: number
}

/*
 * Fallback cooldowns, used only when the gateway states no parseable delay.
 * Rationale per bucket:
 *
 * - rate-limited 60s: a 429 without a usable `Retry-After` is usually a
 *   per-minute window, so one minute backs off past a typical window without
 *   parking the route for long.
 * - auth 5min: a rejected credential cannot heal itself; five minutes stops a
 *   retry loop from hammering the gateway while a human replaces the key.
 * - quota 15min: exhausted quota resets on an hour/day window, so a longer
 *   floor avoids treating a long window as if it were about to reopen.
 * - transient 5s: a 5xx is usually momentary overload; five seconds is the
 *   conventional backoff and keeps a retryable route responsive.
 * - permanent 0: a malformed request (400/404/422) does not become valid on
 *   retry, so no cooldown is claimed at all.
 */
export const RATE_LIMITED_COOLDOWN_MS: number = 60_000
export const AUTH_COOLDOWN_MS: number = 300_000
export const QUOTA_COOLDOWN_MS: number = 900_000
export const TRANSIENT_COOLDOWN_MS: number = 5_000
export const PERMANENT_COOLDOWN_MS: number = 0

/** Header carrying the RFC 9110 `Retry-After` delay. */
const RETRY_AFTER_HEADER = 'retry-after'

/** Vendor headers some gateways use instead of `Retry-After`. */
const RATE_LIMIT_RESET_HEADERS: readonly string[] = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']

/** A bare number at or above this is an epoch-second timestamp, not a duration. */
const EPOCH_SECONDS_FLOOR = 1_000_000_000

const DURATION_UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
const DURATION_PATTERN = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g
const BARE_SECONDS_PATTERN = /^\d+(?:\.\d+)?$/

/*
 * The three HTTP-date forms RFC 9110 allows: IMF-fixdate, the obsolete RFC 850
 * form, and asctime. Matching them explicitly keeps `Date.parse`'s much looser
 * grammar (which happily reads `-5` as a date in the distant past) from turning
 * junk into a confident "wait 0ms".
 */
const HTTP_DATE_PATTERNS: readonly RegExp[] = [
  /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  /^[A-Za-z]{6,9}, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
  /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/,
]

/** Milliseconds, never negative and never `NaN`/`Infinity`. */
function asDelay(value: number): number | undefined {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined
}

/**
 * RFC 9110 `Retry-After`: `delay-seconds` or one of the three HTTP-date forms.
 * Anything else — a signed value, a unit-less word, a duration string the ABNF
 * does not allow — is reported as unparseable instead of guessed at.
 */
function parseRetryAfterValue(value: string, now: number): number | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (BARE_SECONDS_PATTERN.test(trimmed)) return asDelay(Number(trimmed) * 1_000)
  if (!HTTP_DATE_PATTERNS.some((pattern) => pattern.test(trimmed))) return undefined
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return undefined
  return asDelay(parsed - now)
}

/**
 * The `x-ratelimit-reset-*` family: `"14s"`, `"1m30s"`, `"500ms"`, a bare
 * number of seconds, or a bare epoch-second timestamp.
 */
function parseResetValue(value: string, now: number): number | undefined {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0) return undefined
  if (BARE_SECONDS_PATTERN.test(trimmed)) {
    const numeric = Number(trimmed)
    return asDelay(numeric >= EPOCH_SECONDS_FLOOR ? numeric * 1_000 - now : numeric * 1_000)
  }
  const matches = [...trimmed.matchAll(DURATION_PATTERN)]
  if (matches.length === 0) return undefined
  // Every character must belong to a duration component: "14s soon" is junk,
  // not a 14-second wait.
  if (matches.map((match) => match[0]).join('').length !== trimmed.length) return undefined
  let total = 0
  for (const match of matches) total += Number(match[1]) * (DURATION_UNITS[match[2] ?? ''] ?? 0)
  return asDelay(total)
}

/**
 * The wait a gateway asks for, in milliseconds, or `undefined` when it states
 * none this module can understand.
 *
 * `retry-after` wins over the vendor reset headers. Parsing never throws and
 * never returns a negative or non-finite number: a header format problem must
 * not become a request failure.
 */
export function retryAfterDelay(headers: Headers | undefined, now: number): number | undefined {
  if (headers === undefined) return undefined
  try {
    const direct = headers.get(RETRY_AFTER_HEADER)
    if (direct !== null) {
      const delay = parseRetryAfterValue(direct, now)
      if (delay !== undefined) return delay
    }
    for (const name of RATE_LIMIT_RESET_HEADERS) {
      const value = headers.get(name)
      if (value === null) continue
      const delay = parseResetValue(value, now)
      if (delay !== undefined) return delay
    }
  } catch {
    // An unusable header bag means "no stated delay".
  }
  return undefined
}

/**
 * Classify one failed response.
 *
 * `429` is rate limiting, `401`/`403` are authentication, `402` is an exhausted
 * quota, `>= 500` is transient, and any other 4xx is a permanent request error.
 * `cooldownMs` prefers the delay the gateway itself stated and otherwise uses
 * the bucket's conservative constant.
 */
export function classifyHttpFailure(status: number, headers?: Headers, now: number = Date.now()): HttpFailure {
  const stated = retryAfterDelay(headers, now)
  const bucket = (kind: HttpFailureKind, fallback: number): HttpFailure => ({
    kind,
    cooldownMs: stated ?? fallback,
  })
  if (status === 429) return bucket('rate-limited', RATE_LIMITED_COOLDOWN_MS)
  if (status === 401 || status === 403) return bucket('auth', AUTH_COOLDOWN_MS)
  if (status === 402) return bucket('quota', QUOTA_COOLDOWN_MS)
  if (status >= 500) return bucket('transient', TRANSIENT_COOLDOWN_MS)
  return bucket('permanent', PERMANENT_COOLDOWN_MS)
}

/** Raised when a request produced no data for the watchdog window. */
export class HttpIdleTimeoutError extends Error {
  /** The idle window that elapsed, in milliseconds. */
  readonly idleMs: number

  constructor(idleMs: number, options?: { cause?: unknown }) {
    super(`no response data for ${idleMs}ms (idle timeout)`, options)
    this.name = 'HttpIdleTimeoutError'
    this.idleMs = idleMs
  }
}

/** A composed abort signal that also fires when the request goes quiet. */
export interface IdleWatchdog {
  /** Signal to hand to `fetch`: aborts on inactivity or when the parent aborts. */
  readonly signal: AbortSignal
  /** Report activity; restarts the idle window. */
  touch(): void
  /** Stop watching: clears the timer, never aborts, detaches from the parent. */
  dispose(): void
  /** True when the signal was aborted for inactivity, never for a parent abort. */
  wasIdle(): boolean
}

/**
 * Watch one request for inactivity.
 *
 * The returned signal aborts when no `touch()` arrived within `idleMs`, or when
 * the parent signal aborts — {@link IdleWatchdog.wasIdle} tells the two apart,
 * which is what lets a caller report "the gateway went silent" instead of
 * "the caller cancelled". A non-positive or non-finite `idleMs` disables the
 * watchdog rather than aborting at once, so a misconfigured threshold cannot
 * fail a request by itself.
 */
export function idleWatchdog(parent: AbortSignal | undefined, idleMs: number): IdleWatchdog {
  const controller = new AbortController()
  let idle = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  const abortFromParent = (): void => {
    clear()
    controller.abort(parent?.reason)
  }
  const arm = (): void => {
    if (disposed || controller.signal.aborted) return
    clear()
    if (!(idleMs > 0) || !Number.isFinite(idleMs)) return
    timer = setTimeout(() => {
      idle = true
      controller.abort(new HttpIdleTimeoutError(idleMs))
    }, idleMs)
  }

  if (parent !== undefined) {
    if (parent.aborted) abortFromParent()
    else parent.addEventListener('abort', abortFromParent, { once: true })
  }
  arm()

  return {
    signal: controller.signal,
    touch: arm,
    dispose(): void {
      disposed = true
      clear()
      parent?.removeEventListener('abort', abortFromParent)
    },
    wasIdle: () => idle,
  }
}

/**
 * Bounded retry policy for a `429` the gateway answered with a stated delay.
 *
 * Exported as the explicit switch for the behavior this module adds: pass
 * `{ enabled: false }` (or `maxRetries: 0`) to keep every plugin request
 * strictly single-shot. `maxRetries` is additionally capped by
 * {@link RATE_LIMIT_RETRY_LIMIT}, so no caller can widen this into an
 * unbounded loop.
 */
export interface RateLimitRetryPolicy {
  enabled: boolean
  maxRetries: number
}

/**
 * Plugin-wide default: one extra attempt, and only for a `429` that carries a
 * delay this module can parse. A `429` without a usable `Retry-After` is never
 * retried on a guess.
 */
export const DEFAULT_RATE_LIMIT_RETRY_POLICY: RateLimitRetryPolicy = { enabled: true, maxRetries: 1 }

/** Hard ceiling this module enforces regardless of the supplied policy. */
export const RATE_LIMIT_RETRY_LIMIT: number = 1

export interface ResilientFetchOptions {
  /** The caller's signal; the per-attempt watchdog composes with it. */
  signal?: AbortSignal
  /** Idle window for one attempt, in milliseconds. Non-positive disables it. */
  idleMs: number
  /** Retry policy; defaults to {@link DEFAULT_RATE_LIMIT_RETRY_POLICY}. */
  policy?: RateLimitRetryPolicy
  /** Clock used to resolve a stated delay; defaults to `Date.now`. */
  now?: () => number
  /** Sleep hook, injectable so tests never wait on real time. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface ResilientFetchResult {
  response: Response
  /** Extra attempts made after the first one (0 or 1 with the default policy). */
  retries: number
  /** True when the returned response followed a rate-limited retry. */
  rateLimited: boolean
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('aborted')
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortReason(signal))
  if (!(ms > 0)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortReason(signal as AbortSignal))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Run one request under an idle watchdog, retrying a stated `429` at most once.
 *
 * The attempt receives the watchdog's composed signal, so an idle request is
 * aborted rather than left hanging. Only a `429` is retried, only when
 * {@link retryAfterDelay} produced a definite wait, and only while the caller's
 * own signal is still live — a caller who cancelled is never re-requested on.
 * Any other status, and any `429` without a usable delay, is returned to the
 * caller exactly as the gateway sent it.
 */
export async function fetchWithResilience(
  attempt: (signal: AbortSignal) => Promise<Response>,
  options: ResilientFetchOptions,
): Promise<ResilientFetchResult> {
  const policy = options.policy ?? DEFAULT_RATE_LIMIT_RETRY_POLICY
  const maxRetries = policy.enabled
    ? Math.max(0, Math.min(RATE_LIMIT_RETRY_LIMIT, Math.floor(policy.maxRetries)))
    : 0
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepWithSignal
  let retries = 0

  for (;;) {
    const watchdog = idleWatchdog(options.signal, options.idleMs)
    let response: Response
    try {
      response = await attempt(watchdog.signal)
    } catch (error) {
      const wentIdle = watchdog.wasIdle()
      watchdog.dispose()
      if (wentIdle) throw new HttpIdleTimeoutError(options.idleMs, { cause: error })
      throw error
    }
    watchdog.dispose()

    if (response.status !== 429 || retries >= maxRetries) {
      return { response, retries, rateLimited: retries > 0 }
    }
    const delay = retryAfterDelay(response.headers, now())
    if (delay === undefined) return { response, retries, rateLimited: retries > 0 }
    if (options.signal?.aborted === true) throw abortReason(options.signal)
    retries += 1
    await sleep(delay, options.signal)
  }
}

/*
 * Endpoint-level failure memory.
 *
 * `fetchWithResilience` above bounds *one* request. What it cannot see is the
 * caller's *next* request: an endpoint that is down is asked again by the next
 * search, the next image edit, the next tool call — each one paying the full
 * connect and idle timeout again, and each one reporting a different generic
 * failure. This tracker remembers, per endpoint, that the last requests failed
 * and parks that endpoint for a bounded while, so a repeat answers immediately
 * with a readable reason instead of holding the user for another idle window.
 *
 * Every bound is explicit:
 *
 * - {@link ENDPOINT_FAILURE_THRESHOLD} consecutive failures are required. A
 *   single failure can be one blip; the amplification this closes is a
 *   *repeat* against the same endpoint, which the second failure is what
 *   proves.
 * - {@link ENDPOINT_FAILURE_MEMORY_MS} is how long a failure keeps counting as
 *   "the previous failure". After a quiet minute the endpoint counts as
 *   recovered, so two failures an hour apart never add up.
 * - {@link MAX_ENDPOINT_COOLDOWN_MS} caps what an upstream `Retry-After` may
 *   ask for. A gateway is free to state hours; this plugin still re-probes
 *   within fifteen minutes, so a cooldown can never become a permanent outage.
 * - {@link MAX_TRACKED_ENDPOINTS} bounds memory. Endpoints come from the
 *   user's own route list, and the least recently touched record is dropped
 *   first.
 * - One success clears the endpoint immediately, every record expires on its
 *   own, and nothing is written to disk: the memory is per-process only.
 */

/** Consecutive failures before an endpoint is parked. */
export const ENDPOINT_FAILURE_THRESHOLD: number = 2

/** How long a failure keeps counting as "the previous failure". */
export const ENDPOINT_FAILURE_MEMORY_MS: number = 60_000

/** Hard ceiling for one endpoint cooldown, whatever the gateway states. */
export const MAX_ENDPOINT_COOLDOWN_MS: number = QUOTA_COOLDOWN_MS

/** Upper bound on remembered endpoints; the least recently touched is dropped. */
export const MAX_TRACKED_ENDPOINTS: number = 64

/** What is remembered about one endpoint. */
export interface EndpointFailureRecord {
  /** Kind of the most recent failure. */
  kind: HttpFailureKind
  /** Consecutive failures inside the memory window. */
  count: number
  /** When the cooldown ends; `0` while the endpoint is not parked. */
  until: number
  /** When this record itself goes stale. */
  expiresAt: number
}

/** A parked endpoint, as reported to the caller kept away from it. */
export interface EndpointCooldown {
  /** Kind of the failure that parked the endpoint. */
  kind: HttpFailureKind
  /** Consecutive failures that produced the cooldown. */
  failures: number
  /** Milliseconds left before the endpoint is tried again. */
  retryAfterMs: number
  /** One-line, human-readable reason, suitable for an error message. */
  message: string
}

export interface EndpointCooldownOptions {
  /** Clock; defaults to `Date.now`. Injectable so tests never wait. */
  now?: () => number
  /** Consecutive failures required to park; defaults to the module constant. */
  threshold?: number
  /** Memory window; defaults to the module constant. */
  memoryMs?: number
  /** Cooldown ceiling; defaults to the module constant. */
  maxCooldownMs?: number
  /** Endpoint cap; defaults to the module constant. */
  maxEndpoints?: number
}

/**
 * Canonical key for one endpoint: case-folded scheme and authority, trailing
 * slashes removed. The path keeps its case because paths are case-sensitive.
 */
export function normalizeEndpointKey(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return ''
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/.exec(trimmed)
  if (match === null) return trimmed
  return `${(match[1] ?? '').toLowerCase()}${(match[2] ?? '').toLowerCase()}${match[3] ?? ''}`
}

/**
 * Bounded, in-process memory of endpoint failures.
 *
 * Every method takes the endpoint the way the caller knows it (a `baseURL`) and
 * normalizes it, so `https://GW.example/V1/` and `https://gw.example/V1` share
 * one record. An empty key is neither remembered nor parked: an endpoint that
 * cannot be identified must not be able to silence anything.
 */
export class EndpointCooldownTracker {
  private readonly records = new Map<string, EndpointFailureRecord>()
  private readonly now: () => number
  private readonly threshold: number
  private readonly memoryMs: number
  private readonly maxCooldownMs: number
  private readonly maxEndpoints: number

  constructor(options: EndpointCooldownOptions = {}) {
    this.now = options.now ?? Date.now
    this.threshold = Math.max(1, Math.floor(options.threshold ?? ENDPOINT_FAILURE_THRESHOLD))
    this.memoryMs = Math.max(0, options.memoryMs ?? ENDPOINT_FAILURE_MEMORY_MS)
    this.maxCooldownMs = Math.max(0, options.maxCooldownMs ?? MAX_ENDPOINT_COOLDOWN_MS)
    this.maxEndpoints = Math.max(1, Math.floor(options.maxEndpoints ?? MAX_TRACKED_ENDPOINTS))
  }

  /** How many endpoints are remembered right now (never above the cap). */
  size(): number {
    this.purge()
    return this.records.size
  }

  /**
   * The cooldown keeping callers away from this endpoint, or `undefined` when
   * the endpoint may be tried. Records whose cooldown deadline has passed are
   * reported as available, so a cooldown always ends by itself.
   */
  check(baseURL: string): EndpointCooldown | undefined {
    const key = normalizeEndpointKey(baseURL)
    if (key.length === 0) return undefined
    this.purge()
    const record = this.records.get(key)
    if (record === undefined || record.until <= this.now()) return undefined
    return this.describe(record)
  }

  /**
   * Remember one failed attempt.
   *
   * Returns the cooldown when this failure *started* one, so the caller can
   * append the reason to the error it is about to throw; otherwise `undefined`.
   * A failure that claims no cooldown at all (`permanent`, or a gateway that
   * stated `0`) is not remembered either: parking an endpoint over a malformed
   * request would punish a healthy route.
   */
  recordFailure(baseURL: string, failure: HttpFailure): EndpointCooldown | undefined {
    const key = normalizeEndpointKey(baseURL)
    if (key.length === 0 || !(failure.cooldownMs > 0)) return undefined
    this.purge()
    const now = this.now()
    const count = (this.records.get(key)?.count ?? 0) + 1
    const until = count >= this.threshold ? now + Math.min(failure.cooldownMs, this.maxCooldownMs) : 0
    const record: EndpointFailureRecord = {
      kind: failure.kind,
      count,
      until,
      expiresAt: Math.max(until, now + this.memoryMs),
    }
    // Re-insert so the map order keeps meaning "least recently touched first".
    this.records.delete(key)
    this.records.set(key, record)
    this.evict()
    return until > now ? this.describe(record) : undefined
  }

  /** Forget this endpoint: one success means it is healthy again. */
  recordSuccess(baseURL: string): void {
    const key = normalizeEndpointKey(baseURL)
    if (key.length === 0) return
    this.records.delete(key)
  }

  /** Drop every record. */
  clear(): void {
    this.records.clear()
  }

  private describe(record: EndpointFailureRecord): EndpointCooldown {
    const retryAfterMs = Math.max(0, record.until - this.now())
    return {
      kind: record.kind,
      failures: record.count,
      retryAfterMs,
      message: `endpoint cooling down after ${record.count} consecutive failures (${record.kind}); retry in ${retryAfterMs}ms`,
    }
  }

  private purge(): void {
    const now = this.now()
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(key)
    }
  }

  private evict(): void {
    while (this.records.size > this.maxEndpoints) {
      const oldest = this.records.keys().next()
      if (oldest.done === true) return
      this.records.delete(oldest.value)
    }
  }
}

/**
 * Process-wide tracker shared by every request path this plugin issues, so an
 * endpoint that is down for a search is known to be down for image edits too.
 */
export const endpointCooldowns: EndpointCooldownTracker = new EndpointCooldownTracker()

/**
 * The failure a transport-level error implies. A connection that never
 * answered, or went silent past the idle window, says nothing about *why*; the
 * conservative reading is momentary overload, which is exactly the bucket whose
 * cooldown is shortest.
 */
export const TRANSIENT_HTTP_FAILURE: HttpFailure = { kind: 'transient', cooldownMs: TRANSIENT_COOLDOWN_MS }

/**
 * Render a cooldown that a failure just started as a suffix for an error
 * message, or nothing at all when the endpoint is still considered healthy.
 */
export function cooldownNote(cooldown: EndpointCooldown | undefined): string {
  return cooldown === undefined ? '' : ` (${cooldown.message})`
}
