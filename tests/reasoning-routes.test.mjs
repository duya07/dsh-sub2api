import assert from 'node:assert/strict'
import test from 'node:test'
import { registerRoutes } from '../src/routes.ts'

function harness(resolveKey = async () => 'fake-stored-key') {
  const handlers = []
  let writes = 0
  const refs = []
  const disposers = []
  registerRoutes({
    inject(_deps, callback) { callback({webServer: {register(entry) {handlers.push(entry)}}, effect(callback) {disposers.push(callback())}}) },
    get() { return {set() {writes++}} },
  }, {
    config: () => ({baseURL: 'https://wrong.test', providers: {openai: {apiKeyEnv: 'WRONG'}}}),
    setConfig() {writes++},
    listRegisteredRoutes: () => [],
    async resolveApiKey(ref) {refs.push(ref); return resolveKey(ref)},
  })
  return {
    handlers, refs, disposers,
    get writes() {return writes},
    async call(path, body, options = {}) {
      const entry = handlers.find(item => item.path === `/plugins/dsh-sub2api/${path}`)
      if (!entry) return {status: 404, body: {error: 'not found'}}
      let status = 0, text = ''
      const req = {method: 'POST', socket: {remoteAddress: '127.0.0.1'}, headers: {host: 'localhost:43120'}, ...options,
        async *[Symbol.asyncIterator]() {yield Buffer.from(JSON.stringify(body))}}
      await entry.handler(req, {writeHead(code) {status = code}, end(value) {text = value ?? ''}})
      return {status, body: JSON.parse(text || '{}')}
    },
  }
}

const draft = () => ({endpoint: {baseURL: 'https://draft.test', platform: 'openai', api: 'openai-responses', apiKey: 'fake-draft-key', apiKeyEnv: 'OWN_REF'}, model: {id: 'model-a', contextWindow: 128000, maxTokens: 32768}, candidates: ['low', 'high']})

test('probe starts with an explicit draft snapshot and returns only a safe bounded task receipt', async () => {
  const app = harness()
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {requests++; return new Response(JSON.stringify({error: {message: 'fake-secret https://sensitive.test'}}), {status: 401})}
  try {
    const started = await app.call('reasoning/start', draft())
    assert.equal(started.status, 202)
    assert.equal(typeof started.body.id, 'string')
    assert.equal(started.body.maxRequests, 7)
    assert.equal(started.body.minGapMs, 5000)
    assert.equal(JSON.stringify(started.body).includes('fake-draft-key'), false)
    const cancelled = await app.call('reasoning/cancel', {id: started.body.id})
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.phase, 'cancelled')
    const status = await app.call('reasoning/status', {id: started.body.id})
    assert.equal(status.status, 200)
    assert.equal(status.body.phase, 'cancelled')
    assert.deepEqual(status.body.suggestion, ['low', 'high'])
    assert.equal(app.writes, 0)
    assert.deepEqual(app.refs, [])
    assert.equal(requests <= 1, true)
  } finally {for (const dispose of app.disposers) dispose(); globalThis.fetch = originalFetch}
})

test('probe rejects ambiguous endpoint identity, untrusted callers and invalid drafts without resolving another key', async () => {
  const app = harness()
  for (const changes of [{endpoint: {...draft().endpoint, baseURL: ''}}, {endpoint: {...draft().endpoint, apiKey: '', apiKeyEnv: ''}}, {candidates: ['invalid']}, {candidates: []}, {model: {id: ''}}]) {
    assert.equal((await app.call('reasoning/start', {...draft(), ...changes})).status, 400)
  }
  assert.equal((await app.call('reasoning/start', draft(), {headers: {host: 'localhost:43120', 'sec-fetch-site': 'cross-site'}})).status, 403)
  assert.equal((await app.call('reasoning/start', draft(), {socket: {remoteAddress: '8.8.8.8'}})).status, 403)
  assert.equal(app.writes, 0)
  assert.deepEqual(app.refs, [])
  for (const dispose of app.disposers) dispose()
})

test('probe resolves only the explicit stored endpoint reference and sanitizes resolver failures', async () => {
  const app = harness()
  try {
    const value = draft(); value.endpoint.apiKey = ''
    const start = await app.call('reasoning/start', value)
    assert.equal(start.status, 202)
    assert.deepEqual(app.refs, ['OWN_REF'])
    await app.call('reasoning/cancel', {id: start.body.id})
    assert.equal(app.writes, 0)
  } finally {for (const dispose of app.disposers) dispose()}
  const failing = harness(async () => {throw new Error('fake-secret https://sensitive.test')})
  try {
    const value = draft(); value.endpoint.apiKey = ''
    const result = await failing.call('reasoning/start', value)
    assert.equal(result.status, 400)
    assert.equal(JSON.stringify(result).includes('sensitive'), false)
    assert.equal(JSON.stringify(result).includes('fake-secret'), false)
    assert.deepEqual(failing.refs, ['OWN_REF'])
    assert.equal(failing.writes, 0)
  } finally {for (const dispose of failing.disposers) dispose()}
})
