import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_COOLDOWN_MS,
  DEFAULT_RATE_LIMIT_RETRY_POLICY,
  HttpIdleTimeoutError,
  PERMANENT_COOLDOWN_MS,
  QUOTA_COOLDOWN_MS,
  RATE_LIMITED_COOLDOWN_MS,
  RATE_LIMIT_RETRY_LIMIT,
  TRANSIENT_COOLDOWN_MS,
  classifyHttpFailure,
  fetchWithResilience,
  idleWatchdog,
  retryAfterDelay,
} from '../src/http-resilience.ts'

/** A whole-second clock keeps the HTTP-date and epoch-second cases exact. */
const NOW = Date.UTC(2026, 9, 21, 7, 28, 0)

const headers = (init = {}) => new Headers(init)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('retryAfterDelay reads the delay-seconds and HTTP-date forms', () => {
  assert.equal(retryAfterDelay(headers({ 'retry-after': '14' }), NOW), 14_000)
  assert.equal(retryAfterDelay(headers({ 'retry-after': '0' }), NOW), 0)
  assert.equal(retryAfterDelay(headers({ 'retry-after': ' 3 ' }), NOW), 3_000)
  assert.equal(retryAfterDelay(headers({ 'retry-after': new Date(NOW + 5_000).toUTCString() }), NOW), 5_000)
  // A date already in the past means "now", never a negative wait.
  assert.equal(retryAfterDelay(headers({ 'retry-after': new Date(NOW - 60_000).toUTCString() }), NOW), 0)
})

test('retryAfterDelay reports no delay for absent or unusable headers', () => {
  assert.equal(retryAfterDelay(undefined, NOW), undefined)
  assert.equal(retryAfterDelay(headers(), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'retry-after': '' }), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'retry-after': 'soon' }), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'retry-after': '14 seconds' }), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'retry-after': '-5' }), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'retry-after': 'Infinity' }), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-requests': 'later' }), NOW), undefined)
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-requests': '14s soon' }), NOW), undefined)
})

test('retryAfterDelay understands the vendor reset headers', () => {
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-requests': '14s' }), NOW), 14_000)
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-requests': '1m30s' }), NOW), 90_000)
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-tokens': '500ms' }), NOW), 500)
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-tokens': '2h' }), NOW), 7_200_000)
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-requests': '14' }), NOW), 14_000)
  // A bare number that large is an epoch-second timestamp, not a duration.
  assert.equal(retryAfterDelay(headers({ 'x-ratelimit-reset-requests': String(NOW / 1_000 + 30) }), NOW), 30_000)
})

test('retryAfterDelay prefers retry-after and falls back when it is unusable', () => {
  assert.equal(
    retryAfterDelay(headers({ 'retry-after': '5', 'x-ratelimit-reset-requests': '60s' }), NOW),
    5_000,
  )
  assert.equal(
    retryAfterDelay(headers({ 'retry-after': 'nonsense', 'x-ratelimit-reset-requests': '60s' }), NOW),
    60_000,
  )
})

test('classifyHttpFailure maps every status bucket', () => {
  assert.deepEqual(classifyHttpFailure(429, undefined, NOW), { kind: 'rate-limited', cooldownMs: RATE_LIMITED_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(401, undefined, NOW), { kind: 'auth', cooldownMs: AUTH_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(403, undefined, NOW), { kind: 'auth', cooldownMs: AUTH_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(402, undefined, NOW), { kind: 'quota', cooldownMs: QUOTA_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(500, undefined, NOW), { kind: 'transient', cooldownMs: TRANSIENT_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(503, undefined, NOW), { kind: 'transient', cooldownMs: TRANSIENT_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(400, undefined, NOW), { kind: 'permanent', cooldownMs: PERMANENT_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(404, undefined, NOW), { kind: 'permanent', cooldownMs: PERMANENT_COOLDOWN_MS })
  assert.deepEqual(classifyHttpFailure(422, undefined, NOW), { kind: 'permanent', cooldownMs: PERMANENT_COOLDOWN_MS })
})

test('classifyHttpFailure prefers the stated delay over the bucket constant', () => {
  assert.deepEqual(classifyHttpFailure(429, headers({ 'retry-after': '9' }), NOW), { kind: 'rate-limited', cooldownMs: 9_000 })
  assert.deepEqual(classifyHttpFailure(503, headers({ 'retry-after': '2' }), NOW), { kind: 'transient', cooldownMs: 2_000 })
  assert.deepEqual(
    classifyHttpFailure(429, headers({ 'x-ratelimit-reset-requests': '1m' }), NOW),
    { kind: 'rate-limited', cooldownMs: 60_000 },
  )
  // A permanent failure carries no stated delay either way.
  assert.deepEqual(classifyHttpFailure(400, headers({ 'retry-after': '9' }), NOW), { kind: 'permanent', cooldownMs: 9_000 })
  assert.deepEqual(classifyHttpFailure(400, undefined, NOW), { kind: 'permanent', cooldownMs: 0 })
})

test('idleWatchdog reports a parent abort as not idle', () => {
  const parent = new AbortController()
  const reason = new Error('caller cancelled')
  parent.abort(reason)
  const watchdog = idleWatchdog(parent.signal, 10_000)
  assert.equal(watchdog.signal.aborted, true)
  assert.equal(watchdog.signal.reason, reason)
  assert.equal(watchdog.wasIdle(), false)
  watchdog.dispose()
})

test('idleWatchdog aborts an untouched request with a distinguishable error', async () => {
  const watchdog = idleWatchdog(undefined, 30)
  assert.equal(watchdog.signal.aborted, false)
  await sleep(90)
  assert.equal(watchdog.signal.aborted, true)
  assert.equal(watchdog.wasIdle(), true)
  assert.ok(watchdog.signal.reason instanceof HttpIdleTimeoutError)
  assert.equal(watchdog.signal.reason.idleMs, 30)
  watchdog.dispose()
})

test('idleWatchdog keeps a touched request alive', async () => {
  const watchdog = idleWatchdog(undefined, 40)
  for (let i = 0; i < 3; i += 1) {
    await sleep(20)
    watchdog.touch()
  }
  assert.equal(watchdog.signal.aborted, false)
  await sleep(90)
  assert.equal(watchdog.signal.aborted, true)
  assert.equal(watchdog.wasIdle(), true)
  watchdog.dispose()
})

test('idleWatchdog dispose clears the timer and detaches from the parent', async () => {
  const parent = new AbortController()
  const watchdog = idleWatchdog(parent.signal, 30)
  watchdog.dispose()
  await sleep(80)
  assert.equal(watchdog.signal.aborted, false)
  assert.equal(watchdog.wasIdle(), false)
  parent.abort(new Error('late parent abort'))
  await sleep(20)
  assert.equal(watchdog.signal.aborted, false)
})

test('idleWatchdog with a non-positive window never aborts', async () => {
  const disabled = idleWatchdog(undefined, 0)
  const notANumber = idleWatchdog(undefined, Number.NaN)
  await sleep(40)
  assert.equal(disabled.signal.aborted, false)
  assert.equal(notANumber.signal.aborted, false)
  assert.equal(disabled.wasIdle(), false)
  disabled.dispose()
  notANumber.dispose()
})

test('fetchWithResilience retries a stated 429 exactly once', async () => {
  const calls = []
  const sleeps = []
  const limited = new Response(null, { status: 429, headers: { 'retry-after': '14' } })
  const ok = new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
  const result = await fetchWithResilience(
    async () => {
      calls.push(1)
      return calls.length === 1 ? limited : ok
    },
    { idleMs: 1_000, sleep: async (ms) => { sleeps.push(ms) } },
  )
  assert.equal(calls.length, 2)
  assert.equal(result.response, ok)
  assert.equal(result.retries, 1)
  assert.equal(result.rateLimited, true)
  assert.deepEqual(sleeps, [14_000])
})

test('fetchWithResilience does not retry a 429 without a stated delay', async () => {
  let calls = 0
  const sleeps = []
  const limited = new Response(null, { status: 429 })
  const result = await fetchWithResilience(
    async () => {
      calls += 1
      return limited
    },
    { idleMs: 1_000, sleep: async (ms) => { sleeps.push(ms) } },
  )
  assert.equal(calls, 1)
  assert.equal(result.response, limited)
  assert.equal(result.retries, 0)
  assert.equal(result.rateLimited, false)
  assert.deepEqual(sleeps, [])
})

test('fetchWithResilience honours the explicit opt-out and the hard ceiling', async () => {
  let opted = 0
  const optedOut = await fetchWithResilience(
    async () => {
      opted += 1
      return new Response(null, { status: 429, headers: { 'retry-after': '1' } })
    },
    { idleMs: 1_000, policy: { enabled: false, maxRetries: 5 }, sleep: async () => {} },
  )
  assert.equal(opted, 1)
  assert.equal(optedOut.retries, 0)

  let capped = 0
  const cappedResult = await fetchWithResilience(
    async () => {
      capped += 1
      return new Response(null, { status: 429, headers: { 'retry-after': '1' } })
    },
    { idleMs: 1_000, policy: { enabled: true, maxRetries: 99 }, sleep: async () => {} },
  )
  assert.equal(capped, 2)
  assert.equal(cappedResult.retries, RATE_LIMIT_RETRY_LIMIT)
  assert.equal(cappedResult.rateLimited, true)
})

test('fetchWithResilience never retries a status other than 429', async () => {
  for (const status of [200, 400, 401, 500, 503]) {
    let calls = 0
    const response = new Response(null, { status, headers: { 'retry-after': '1' } })
    const result = await fetchWithResilience(
      async () => {
        calls += 1
        return response
      },
      { idleMs: 1_000, sleep: async () => {} },
    )
    assert.equal(calls, 1, `status ${status} must not be retried`)
    assert.equal(result.response, response)
    assert.equal(result.retries, 0)
  }
})

test('fetchWithResilience refuses to retry after the caller cancelled', async () => {
  const parent = new AbortController()
  const sleeps = []
  let calls = 0
  await assert.rejects(
    () =>
      fetchWithResilience(
        async () => {
          calls += 1
          parent.abort(new Error('caller cancelled'))
          return new Response(null, { status: 429, headers: { 'retry-after': '14' } })
        },
        { signal: parent.signal, idleMs: 1_000, sleep: async (ms) => { sleeps.push(ms) } },
      ),
    /caller cancelled/,
  )
  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test('fetchWithResilience surfaces an idle attempt as HttpIdleTimeoutError', async () => {
  await assert.rejects(
    () =>
      fetchWithResilience(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
        { idleMs: 30 },
      ),
    (error) => {
      assert.ok(error instanceof HttpIdleTimeoutError)
      assert.equal(error.idleMs, 30)
      return true
    },
  )
})

test('fetchWithResilience forwards the watchdog signal to the attempt', async () => {
  const seen = []
  await fetchWithResilience(
    async (signal) => {
      seen.push(signal instanceof AbortSignal)
      return new Response(null, { status: 200 })
    },
    { idleMs: 1_000 },
  )
  assert.deepEqual(seen, [true])
})

test('the exported default retry policy is explicit and bounded', () => {
  assert.equal(DEFAULT_RATE_LIMIT_RETRY_POLICY.enabled, true)
  assert.equal(DEFAULT_RATE_LIMIT_RETRY_POLICY.maxRetries, 1)
  assert.equal(RATE_LIMIT_RETRY_LIMIT, 1)
})
