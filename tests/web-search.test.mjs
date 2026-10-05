import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, readVolatile } from '../src/index.ts'
import { registerRoutes } from '../src/routes.ts'
import {
  SUB2API_WEB_SEARCH_PROVIDER_ID,
  Sub2ApiWebError,
  Sub2ApiWebSearchProvider,
  parseResponsesSearch,
  registerWebSearchProvider,
  resolveWebSearchTarget,
} from '../src/web-search.ts'

const FAKE_KEY = 'sk-sub2api-fake-key-never-echo'

const endpoint = (over = {}) => ({
  name: 'GW',
  baseURL: 'https://gw.test',
  platform: 'openai',
  apiKeyEnv: 'GW_KEY',
  models: [{ id: 'gpt-search' }],
  ...over,
})

function section(tools, over = {}) {
  return {
    baseURL: '',
    providers: { openai: {}, claude: {}, grok: {} },
    endpoints: [endpoint()],
    ...(tools === undefined ? {} : { tools }),
    ...over,
  }
}

const enabled = (over = {}) => ({ enabled: true, provider: 'sub2api-openai-gw', model: 'gpt-search', ...over })

const host = (config) => ({ config: () => config, resolveApiKey: async () => FAKE_KEY })

const messageItem = (text, annotations) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations }],
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

test('the provider stays unavailable until the section enables it', () => {
  for (const tools of [
    undefined,
    { webSearch: { enabled: false, provider: 'sub2api-openai-gw', model: 'gpt-search' } },
    { webSearch: { enabled: true, provider: '', model: '' } },
    { webSearch: { enabled: true, provider: 'sub2api-openai-gw', model: '' } },
    { webSearch: { provider: 'sub2api-openai-gw', model: 'gpt-search' } },
  ]) {
    const config = section(tools)
    assert.equal(resolveWebSearchTarget(config), undefined, JSON.stringify(tools))
    assert.equal(new Sub2ApiWebSearchProvider(host(config)).available(), false)
  }
})

test('an enabled openai endpoint resolves to its Responses root and reports available', () => {
  const config = section({ webSearch: enabled() }, { baseURL: 'https://default.test' })
  const target = resolveWebSearchTarget(config)
  assert.equal(target?.baseURL, 'https://gw.test/v1')
  assert.equal(target?.route, 'sub2api-openai-gw')
  assert.equal(target?.model, 'gpt-search')
  assert.equal(target?.profile.apiKeyEnv, 'GW_KEY')
  assert.equal(new Sub2ApiWebSearchProvider(host(config)).available(), true)
})

test('an anthropic endpoint cannot serve a Responses-API search', () => {
  const config = section({ webSearch: enabled({ provider: 'sub2api-claude-gw' }) })
  config.endpoints = [endpoint({ platform: 'claude' })]
  assert.equal(resolveWebSearchTarget(config), undefined)
  assert.equal(new Sub2ApiWebSearchProvider(host(config)).available(), false)
})

test('one search posts a single Responses request with the native web_search tool', async () => {
  const config = section({ webSearch: enabled() }, { baseURL: 'https://default.test' })
  const calls = []
  const result = await withFetch(async (url, init) => {
    calls.push({ url, init })
    return jsonResponse({
      id: 'resp_1',
      model: 'gpt-search',
      output: [
        { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'latest news' } },
        messageItem('Answer text', [
          { type: 'url_citation', url: 'https://a.test/1', title: 'A', start_index: 0, end_index: 4 },
          { type: 'url_citation', url: 'https://a.test/1', title: 'A again' },
          { type: 'url_citation', url: 'https://b.test/2' },
        ]),
      ],
    })
  }, () => new Sub2ApiWebSearchProvider(host(config)).search({ query: 'latest news', maxResults: 8 }))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://gw.test/v1/responses')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${FAKE_KEY}`)
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'gpt-search',
    input: 'latest news',
    tools: [{ type: 'web_search' }],
    stream: false,
  })
  assert.equal(calls[0].init.signal, undefined)
  assert.equal(result.truncated, false)
  assert.equal(result.content, 'Answer text')
  assert.deepEqual(result.sources, [
    { url: 'https://a.test/1', title: 'A' },
    { url: 'https://b.test/2' },
  ])
})

test('gateway failures surface one coded error that never echoes the key', async () => {
  const config = section({ webSearch: enabled() })
  const calls = []
  await withFetch(async (url) => {
    calls.push(url)
    return jsonResponse({ error: { message: 'rate limit reached' } }, 429)
  }, async () => {
    const provider = new Sub2ApiWebSearchProvider(host(config))
    await assert.rejects(() => provider.search({ query: 'q' }), (error) => {
      assert.ok(error instanceof Sub2ApiWebError)
      assert.ok(error instanceof Error)
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /429/)
      assert.match(error.message, /rate limit reached/)
      assert.equal(error.message.includes(FAKE_KEY), false)
      return true
    })
  })
  assert.equal(calls.length, 1)
})

test('an already-aborted signal never dispatches a request', async () => {
  const config = section({ webSearch: enabled() })
  let calls = 0
  await withFetch(async () => {
    calls++
    return jsonResponse({})
  }, async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new Sub2ApiWebSearchProvider(host(config))
    await assert.rejects(() => provider.search({ query: 'q' }, controller.signal), (error) => {
      assert.equal(error.code, 'WEB_ABORTED')
      return true
    })
  })
  assert.equal(calls, 0)
})

test('an oversized gateway body is rejected instead of parsed', async () => {
  const config = section({ webSearch: enabled() })
  const big = JSON.stringify({ output: [messageItem('x'.repeat(2 * 1024 * 1024 + 64), [])] })
  await withFetch(async () => new Response(big, { status: 200 }), async () => {
    const provider = new Sub2ApiWebSearchProvider(host(config))
    await assert.rejects(() => provider.search({ query: 'q' }), (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /byte cap/)
      return true
    })
  })
})

test('parseResponsesSearch keeps a plain answer and rejects an unusable body', () => {
  const plain = parseResponsesSearch(JSON.stringify({ output: [messageItem('no citations here', [])] }))
  assert.deepEqual(plain, { sources: [], truncated: false, content: 'no citations here' })
  assert.throws(() => parseResponsesSearch(JSON.stringify({ output: [] })), (error) => error.code === 'WEB_PROVIDER_ERROR')
  assert.throws(() => parseResponsesSearch('not json'), (error) => error.code === 'WEB_PROVIDER_ERROR')
})

test('registration hands the provider id sub2api to the host web seam', () => {
  const registered = []
  const disposers = []
  const ctx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ['web'])
      assert.equal(typeof callback, 'function')
      callback({
        web: { registerSearchProvider(provider) { registered.push(provider); return () => {} } },
        effect(callback2) { disposers.push(callback2()) },
      })
    },
  }
  registerWebSearchProvider(ctx, host(section(undefined)))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, SUB2API_WEB_SEARCH_PROVIDER_ID)
  assert.equal(SUB2API_WEB_SEARCH_PROVIDER_ID, 'sub2api')
  assert.equal(registered[0].available(), false)
  assert.equal(disposers.length, 1)
})

test('the config schema round-trips the webSearch section verbatim', () => {
  const parsed = Config(section({ webSearch: enabled() }))
  assert.deepEqual(readVolatile(parsed.tools)?.webSearch, {
    enabled: true,
    provider: 'sub2api-openai-gw',
    model: 'gpt-search',
  })
  const cleared = Config(section({}))
  // Schemastery materializes the missing section as `{}`; what matters is that a
  // cleared save cannot write `enabled: true` and arm the provider by accident.
  assert.deepEqual(readVolatile(cleared.tools)?.webSearch, {})
})

function routesFixture(config) {
  const commits = []
  const handlers = []
  registerRoutes({
    inject(_deps, callback) {
      callback({ webServer: { register(entry) { handlers.push(entry) } }, effect() {} })
    },
    get() { return undefined },
  }, {
    config: () => config,
    setConfig: async (next) => { commits.push(structuredClone(next)) },
    listRegisteredRoutes: () => [],
    resolveApiKey: async () => FAKE_KEY,
  })
  const handler = handlers.find((entry) => entry.path === '/plugins/dsh-sub2api/config').handler
  const call = async (body, method = 'POST') => {
    const req = {
      method,
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:43120' },
      async *[Symbol.asyncIterator]() { if (method === 'POST') yield Buffer.from(JSON.stringify(body)) },
    }
    let status, text
    await handler(req, { writeHead(code) { status = code }, end(value) { text = value } })
    return { status, body: JSON.parse(text) }
  }
  return { commits, call }
}

test('the settings POST persists webSearch and the GET echoes it back', async () => {
  const current = section({ webSearch: enabled() })
  const fixture = routesFixture(current)
  const payload = {
    baseURL: 'https://gw.test',
    endpoints: [{ name: 'GW', platform: 'openai', baseURL: 'https://gw.test', apiKeyEnv: 'GW_KEY', api: '', models: [{ id: 'gpt-search' }] }],
    tools: {
      // Both tool slots accept a bare platform key or an endpoint route id: a
      // route id is what the settings UI emits when the endpoint list is used,
      // and `resolveToolModel` / `resolveWebSearchTarget` map it back.
      generate: { provider: 'openai', model: 'gpt-search' },
      webSearch: { enabled: true, provider: 'sub2api-openai-gw', model: 'gpt-search' },
    },
  }
  const posted = await fixture.call(payload)
  assert.equal(posted.status, 200)
  assert.deepEqual(fixture.commits[0].tools, {
    generate: { provider: 'openai', model: 'gpt-search' },
    webSearch: { enabled: true, provider: 'sub2api-openai-gw', model: 'gpt-search' },
  })
  const read = await fixture.call(undefined, 'GET')
  assert.deepEqual(read.body.tools.webSearch, { enabled: true, provider: 'sub2api-openai-gw', model: 'gpt-search' })

  const disabled = routesFixture(current)
  const cleared = await disabled.call({ ...payload, tools: { ...payload.tools, webSearch: { enabled: false, provider: 'sub2api-openai-gw', model: 'gpt-search' } } })
  assert.equal(cleared.status, 200)
  assert.deepEqual(disabled.commits[0].tools, { generate: { provider: 'openai', model: 'gpt-search' } })
  assert.equal('webSearch' in disabled.commits[0].tools, false)
})

test('an endpoint route in the image slot round-trips instead of being dropped', async () => {
  const stored = {
    generate: { provider: 'sub2api-openai-gw', model: 'gpt-search' },
    webSearch: { enabled: true, provider: 'sub2api-openai-gw', model: 'gpt-search' },
  }
  const fixture = routesFixture(section(stored))
  const posted = await fixture.call({
    baseURL: 'https://gw.test',
    endpoints: [{ name: 'GW', platform: 'openai', baseURL: 'https://gw.test', apiKeyEnv: 'GW_KEY', api: '', models: [{ id: 'gpt-search' }] }],
    tools: stored,
  })
  assert.equal(posted.status, 200)
  // `readToolModelRef` accepts an endpoint route id as well as a bare platform
  // key, matching what the settings UI offers (`toolOptions` emits
  // `<endpoint.route>:<modelId>`); `resolveToolModel` resolves that route to its
  // endpoint. Both tool sections keep the same value.
  assert.deepEqual(fixture.commits[0].tools, stored)
  const read = await fixture.call(undefined, 'GET')
  assert.deepEqual(read.body.tools.generate, { provider: 'sub2api-openai-gw', model: 'gpt-search' })
})
