import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTH_COOLDOWN_MS,
  ENDPOINT_FAILURE_MEMORY_MS,
  ENDPOINT_FAILURE_THRESHOLD,
  MAX_ENDPOINT_COOLDOWN_MS,
  MAX_TRACKED_ENDPOINTS,
  RATE_LIMITED_COOLDOWN_MS,
  TRANSIENT_COOLDOWN_MS,
  EndpointCooldownTracker,
  classifyHttpFailure,
  cooldownNote,
  normalizeEndpointKey,
} from '../src/http-resilience.ts'
import { Sub2ApiWebError, Sub2ApiWebSearchProvider } from '../src/web-search.ts'

const FAKE_KEY = 'sk-sub2api-fake-key-never-echo'
const ENDPOINT = 'https://gw.test'
// The plugin sends to the endpoint's gateway root, which is what it remembers.
const GATEWAY_ROOT = 'https://gw.test/v1'

/** A clock the tests move by hand, so no cooldown is ever waited out. */
function makeClock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

const limited = () => classifyHttpFailure(429)

function park(tracker, baseURL = ENDPOINT, failure = limited()) {
  tracker.recordFailure(baseURL, failure)
  return tracker.recordFailure(baseURL, failure)
}

// ---------------------------------------------------------------- the key ---

test('an endpoint key folds case and trailing slashes but keeps the path case', () => {
  assert.equal(normalizeEndpointKey('HTTPS://GW.Test/V1/'), 'https://gw.test/V1')
  assert.equal(normalizeEndpointKey('  https://gw.test/V1  '), 'https://gw.test/V1')
  assert.equal(normalizeEndpointKey('https://gw.test'), 'https://gw.test')
  assert.notEqual(normalizeEndpointKey('https://gw.test/V1'), normalizeEndpointKey('https://gw.test/v2'))
  assert.equal(normalizeEndpointKey('   '), '')
})

test('the same endpoint written two ways shares one record', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  tracker.recordFailure('HTTPS://GW.Test/V1/', limited())
  assert.ok(park(tracker, 'https://gw.test/V1') !== undefined, 'the second failure is counted on the same record')
  assert.equal(tracker.size(), 1)
})

// ------------------------------------------------------------- threshold ---

test('one failure is a blip; the second consecutive one parks the endpoint', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  assert.equal(ENDPOINT_FAILURE_THRESHOLD, 2)

  assert.equal(tracker.recordFailure(ENDPOINT, limited()), undefined)
  assert.equal(tracker.check(ENDPOINT), undefined, 'a single failure never silences an endpoint')

  const cooldown = tracker.recordFailure(ENDPOINT, limited())
  assert.ok(cooldown !== undefined)
  assert.equal(cooldown.kind, 'rate-limited')
  assert.equal(cooldown.failures, 2)
  assert.equal(cooldown.retryAfterMs, RATE_LIMITED_COOLDOWN_MS)
  assert.equal(
    cooldown.message,
    'endpoint cooling down after 2 consecutive failures (rate-limited); retry in 60000ms',
  )
  assert.equal(tracker.check(ENDPOINT).retryAfterMs, RATE_LIMITED_COOLDOWN_MS)
})

test('a cooldown ends by itself when its deadline passes', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  park(tracker)

  clock.advance(RATE_LIMITED_COOLDOWN_MS - 1)
  assert.ok(tracker.check(ENDPOINT) !== undefined, 'still parked one millisecond before the deadline')

  clock.advance(1)
  assert.equal(tracker.check(ENDPOINT), undefined, 'the deadline itself releases the endpoint')
})

test('one success clears the endpoint immediately', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  park(tracker)
  assert.equal(tracker.size(), 1)

  tracker.recordSuccess(ENDPOINT)
  assert.equal(tracker.size(), 0)
  assert.equal(tracker.check(ENDPOINT), undefined)
  assert.equal(tracker.recordFailure(ENDPOINT, limited()), undefined, 'the count restarts at one')
})

test('failures separated by more than the memory window never add up', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  assert.equal(ENDPOINT_FAILURE_MEMORY_MS, 60_000)

  tracker.recordFailure(ENDPOINT, limited())
  clock.advance(ENDPOINT_FAILURE_MEMORY_MS)
  assert.equal(tracker.size(), 0, 'the stale record is dropped')
  assert.equal(tracker.recordFailure(ENDPOINT, limited()), undefined, 'a quiet minute means recovered')
})

// ---------------------------------------------------------------- the span ---

test('the three failure kinds park for visibly different spans', () => {
  const span = (failure) => {
    const clock = makeClock()
    const tracker = new EndpointCooldownTracker({ now: clock.now })
    tracker.recordFailure(ENDPOINT, failure)
    return tracker.recordFailure(ENDPOINT, failure).retryAfterMs
  }

  assert.equal(span(classifyHttpFailure(429)), RATE_LIMITED_COOLDOWN_MS)
  assert.equal(span(classifyHttpFailure(401)), AUTH_COOLDOWN_MS)
  assert.equal(span(classifyHttpFailure(503)), TRANSIENT_COOLDOWN_MS)
  assert.equal(new Set([RATE_LIMITED_COOLDOWN_MS, AUTH_COOLDOWN_MS, TRANSIENT_COOLDOWN_MS]).size, 3)
})

test('an upstream stated delay wins over the kind default', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  const failure = classifyHttpFailure(429, new Headers({ 'retry-after': '7' }))

  tracker.recordFailure(ENDPOINT, failure)
  const cooldown = tracker.recordFailure(ENDPOINT, failure)
  assert.equal(cooldown.kind, 'rate-limited', 'the kind still names the failure')
  assert.equal(cooldown.retryAfterMs, 7_000)
  assert.ok(cooldown.retryAfterMs < RATE_LIMITED_COOLDOWN_MS)
})

test('a gateway cannot park an endpoint past the ceiling', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  const failure = classifyHttpFailure(429, new Headers({ 'retry-after': '86400' }))

  tracker.recordFailure(ENDPOINT, failure)
  const cooldown = tracker.recordFailure(ENDPOINT, failure)
  assert.equal(cooldown.retryAfterMs, MAX_ENDPOINT_COOLDOWN_MS)
  assert.ok(MAX_ENDPOINT_COOLDOWN_MS < 86_400_000, 'the ceiling is well inside a day')
})

test('a failure that claims no cooldown is not remembered at all', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  const malformed = classifyHttpFailure(400)
  assert.equal(malformed.cooldownMs, 0)

  assert.equal(tracker.recordFailure(ENDPOINT, malformed), undefined)
  assert.equal(tracker.size(), 0, 'a malformed request must not punish a healthy route')
  assert.equal(tracker.check(ENDPOINT), undefined)
})

// ---------------------------------------------------------------- memory ---

test('the registry stays bounded and drops the least recently touched endpoint', () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now, maxEndpoints: 4 })
  const url = (index) => `https://gw${index}.test`

  for (let index = 0; index < 40; index += 1) park(tracker, url(index))

  assert.equal(tracker.size(), 4)
  assert.ok(tracker.check(url(39)) !== undefined, 'the newest endpoint keeps its cooldown')
  assert.equal(tracker.check(url(0)), undefined, 'the oldest was evicted')
  assert.equal(MAX_TRACKED_ENDPOINTS, 64, 'the shipped cap is a small, fixed number')
})

test('cooldownNote renders the reason only when a failure just parked the endpoint', () => {
  assert.equal(cooldownNote(undefined), '')
  assert.equal(
    cooldownNote({ kind: 'auth', failures: 2, retryAfterMs: 5, message: 'parked' }),
    ' (parked)',
  )
})

// ------------------------------------------------------- the search path ---

const endpoint = (over = {}) => ({
  name: 'GW',
  baseURL: ENDPOINT,
  platform: 'openai',
  apiKeyEnv: 'GW_KEY',
  models: [{ id: 'gpt-search' }],
  ...over,
})

const section = (tools, over = {}) => ({
  baseURL: '',
  providers: { openai: {}, claude: {}, grok: {} },
  endpoints: [endpoint()],
  ...(tools === undefined ? {} : { tools }),
  ...over,
})

const enabled = (over = {}) => ({ enabled: true, provider: 'sub2api-openai-gw', model: 'gpt-search', ...over })

const messageItem = (text) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
})

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

async function withFetch(stub, run) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

function searchFixture(tracker) {
  const config = section({ webSearch: enabled() })
  return new Sub2ApiWebSearchProvider({
    config: () => config,
    resolveApiKey: async () => FAKE_KEY,
    endpointCooldowns: tracker,
  })
}

test('a search against a parked endpoint fails fast instead of calling the gateway again', async () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  const provider = searchFixture(tracker)
  const calls = []

  const failingSearch = async () => withFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ error: { message: 'rate limit reached' } }, 429)
  }, () => assert.rejects(() => provider.search({ query: 'q' }), Sub2ApiWebError))

  await failingSearch()
  await failingSearch()
  assert.equal(calls.length, 2)
  assert.ok(tracker.check(GATEWAY_ROOT) !== undefined, 'two failures parked the endpoint')

  // Parked: the third search must not reach the network at all, and it must say
  // why rather than reporting another generic gateway failure.
  await withFetch(async () => {
    throw new Error('the gateway must not be called while the endpoint is parked')
  }, async () => {
    await assert.rejects(() => provider.search({ query: 'q' }), (error) => {
      assert.ok(error instanceof Sub2ApiWebError)
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /cooling down after 2 consecutive failures \(rate-limited\)/)
      assert.match(error.message, /retry in \d+ms/)
      assert.equal(error.message.includes(FAKE_KEY), false)
      return true
    })
  })
  assert.equal(calls.length, 2, 'no further request was issued')

  // The cooldown expires on its own and the endpoint is used again.
  clock.advance(RATE_LIMITED_COOLDOWN_MS)
  const result = await withFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ output: [messageItem('Recovered')] })
  }, () => provider.search({ query: 'q' }))

  assert.equal(calls.length, 3)
  assert.equal(result.content, 'Recovered')
  assert.equal(tracker.size(), 0, 'one success forgets the endpoint')
})

test('a failure note rides along only once an endpoint is actually parked', async () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  const provider = searchFixture(tracker)

  const messages = []
  await withFetch(async () => jsonResponse({ error: { message: 'rate limit reached' } }, 429), async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(() => provider.search({ query: 'q' }), (error) => {
        messages.push(error.message)
        return true
      })
    }
  })

  assert.equal(messages[0].includes('cooling down'), false, 'the first failure is not a cooldown yet')
  assert.match(messages[1], /cooling down after 2 consecutive failures \(rate-limited\)/)
  assert.match(messages[1], /HTTP 429/, 'the gateway status is still reported')
})

test('a success between two failures keeps the endpoint out of cooldown', async () => {
  const clock = makeClock()
  const tracker = new EndpointCooldownTracker({ now: clock.now })
  const provider = searchFixture(tracker)
  const calls = []

  await withFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ error: { message: 'rate limit reached' } }, 429)
  }, () => assert.rejects(() => provider.search({ query: 'q' }), Sub2ApiWebError))

  await withFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ output: [messageItem('Fine')] })
  }, () => provider.search({ query: 'q' }))

  const outcome = await withFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ output: [messageItem('Still fine')] })
  }, () => provider.search({ query: 'q' }))

  assert.equal(calls.length, 3, 'every search reached the gateway')
  assert.equal(outcome.content, 'Still fine')
  assert.equal(tracker.size(), 0)
})
