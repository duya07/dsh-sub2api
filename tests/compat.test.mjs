import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { translateToPiAi } from '../lib/index.js'

/**
 * A plain configuration literal. `Config({...})` no longer resolves to plain
 * values on DSH 0.2 — a volatile schema field resolves to a live cell — so the
 * checks below use the shape the bridge consumes. The cell path is covered in
 * `dsh02-contract.test.mjs`.
 */
const config = () => ({
  baseURL: 'https://gateway.test/v1',
  providers: Object.fromEntries(['openai', 'claude', 'grok'].map(key => [key, {
    apiKeyEnv: `TEST_${key.toUpperCase()}`,
    models: [{ id: `${key}-test`, reasoningEfforts: ['none', 'high', 'max'] }],
  }])),
  tools: { generate: { provider: 'sub2api-openai', model: 'openai-test' } },
})

test('all gateway routes satisfy the current pi-ai schema', () => {
  // pi-ai declares `providers` volatile, so on 0.2 the parsed section hands
  // back a live cell rather than the profiles themselves.
  const parsed = PiConfig({ providers: translateToPiAi(config()) }).providers
  const providers = typeof parsed?.get === 'function' ? parsed.get() : parsed
  assert.equal(Object.keys(providers).length, 3)
  assert.equal(providers['sub2api-claude'].baseURL, 'https://gateway.test')
  assert.equal(providers['sub2api-claude'].api, 'anthropic-messages')
  assert.equal(providers['sub2api-openai'].baseURL, 'https://gateway.test/v1')
  assert.equal(providers['sub2api-openai'].api, 'openai-responses')
  assert.equal(providers['sub2api-grok'].api, 'openai-completions')
  assert.deepEqual(providers['sub2api-openai'].models[0].reasoningEfforts, {off: 'none', high: 'high', max: 'max'})
})

test('endpoint lists keep legacy route ids and carry their own host and protocol', () => {
  const endpoint = over => ({platform: 'openai', apiKeyEnv: 'KEY', models: [{id: 'm'}], ...over})
  // An unnamed endpoint that is alone on its platform keeps the historical route
  // id, so existing agent presets and default-model settings keep resolving.
  const single = translateToPiAi({baseURL: 'https://legacy.test/v1', providers: {}, endpoints: [endpoint({})]})
  assert.deepEqual(Object.keys(single), ['sub2api-openai'])
  assert.equal(single['sub2api-openai'].baseURL, 'https://legacy.test/v1')
  assert.equal('sub2api-claude' in single, false)
  // A named endpoint becomes its own route and uses its own host, not the section one.
  const named = translateToPiAi({baseURL: 'https://legacy.test/v1', providers: {}, endpoints: [
    endpoint({name: 'Team A', baseURL: 'https://a.test', apiKeyEnv: 'A', models: [{id: 'only-a'}]}),
    endpoint({name: 'Team B', baseURL: 'https://b.test/v1', platform: 'claude', apiKeyEnv: 'B', models: [{id: 'only-b'}]}),
  ]})
  assert.deepEqual(Object.keys(named).sort(), ['sub2api-claude-team-b', 'sub2api-openai-team-a'])
  assert.equal(named['sub2api-openai-team-a'].baseURL, 'https://a.test/v1')
  assert.equal(named['sub2api-claude-team-b'].baseURL, 'https://b.test')
  assert.equal(named['sub2api-claude-team-b'].api, 'anthropic-messages')
  // Two unnamed entries on one platform are numbered instead of colliding.
  const pair = translateToPiAi({baseURL: 'https://legacy.test', providers: {}, endpoints: [endpoint({apiKeyEnv: '1'}), endpoint({apiKeyEnv: '2'})]})
  assert.deepEqual(Object.keys(pair).sort(), ['sub2api-openai-1', 'sub2api-openai-2'])
  // An entry with no key, or with no model, can never be called, so it is skipped.
  assert.deepEqual(translateToPiAi({baseURL: 'https://legacy.test', providers: {}, endpoints: [endpoint({apiKeyEnv: undefined}), endpoint({models: []})]}), {})
  // An explicit protocol override wins over the platform default.
  const overridden = translateToPiAi({baseURL: 'https://legacy.test', providers: {}, endpoints: [endpoint({api: 'openai-completions'})]})
  assert.equal(overridden['sub2api-openai'].api, 'openai-completions')
})

// The 0.1.x settings test that lived here drove `SettingsProvider` through
// `register`, `installSection` and `get`, none of which exist on 0.2.0-rc.2.
// Its three concerns — the section installs, a volatile-only change re-bridges
// without a remount, and routes this plugin does not own survive — are covered
// against the 0.2 contract in `dsh02-contract.test.mjs`.

test('browser bundle registers settings and renders running/settled image tools', () => {
  const require = createRequire(import.meta.url)
  let plugin
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load({factory}) { plugin = factory(require) }}},
    btoa,
  })
  const entries = []
  plugin.apply({slots: {inject(_name, callback) { callback() }, register(options, component) { entries.push({options, component}) }}})
  assert.equal(entries[0].options.name, 'settings.section')
  const view = entries.find(entry => entry.options.key === 'sub2api_generate_image').component
  // The legacy native name stays free for whichever plugin owns it.
  assert.equal(entries.some(entry => entry.options.key === 'generate_image'), false)
  assert.match(JSON.stringify(view({block: {name: 'sub2api_generate_image'}})), /生成图片/)
  const result = view({block: {kind: 'tool-result', content: [{type: 'text', text: 'saved'}, {type: 'image', attachment: {attachmentId: 'test', mediaType: 'image/png'}}]}})
  assert.match(JSON.stringify(result), /plugins\/dsh-sub2api\/attachment/)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-renderer'))
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
})

test('legacy Gemini and auto-vision settings do not create routes', () => {
  const legacy = {...config(), autoVision: true, providers: {...config().providers, gemini: {apiKeyEnv: 'OLD', models: [{id: 'old'}]}}}
  assert.deepEqual(Object.keys(translateToPiAi(legacy)), ['sub2api-openai', 'sub2api-claude', 'sub2api-grok'])
})

test('settings save manual capabilities, preserve edits during metadata fill, and dismiss errors', async () => {
  const { create, act } = await import('react-test-renderer')
  const React = await import('react')
  const require = createRequire(import.meta.url)
  let plugin, saved
  const footerStyles = {}
  const scroller = {overflowY: 'auto', paddingBottom: '24px'}
  let observerDisconnected = false
  const timers = new Map()
  let timerId = 0
  const fixture = {baseURL: 'https://gateway.test', catalogFormat: 'structured-v1', endpoints: [
    {name: 'OpenAI', baseURL: 'https://gateway.test', platform: 'openai', apiKeyEnv: 'SUB2API_OPENAI_API_KEY', keyConfigured: true, api: '', route: 'sub2api-openai', models: [{id: 'test-model', input: ['text'], reasoningEfforts: ['low']}]},
  ]}
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load({factory}) { plugin = factory(require) }}, setTimeout(callback) { timers.set(++timerId, callback); return timerId }, clearTimeout(id) {timers.delete(id)}},
    getComputedStyle: element => element,
    ResizeObserver: class { observe() {} disconnect() {observerDisconnected = true} },
    fetch: async (url, init) => ({ok: true, json: async () => {
      if (url.includes('models.dev')) return {openai: {models: {'test-model': {attachment: true, reasoning: true}}}}
      if (init?.method === 'POST') {saved = JSON.parse(init.body); return {ok: true, routes: ['sub2api-openai']}}
      return fixture
    }}), btoa,
  })
  const entries = []
  plugin.apply({slots: {inject(_name, callback) {callback()}, register(options, component) {entries.push({options, component})}}})
  let view
  await act(async () => { view = create(React.createElement(entries[0].component), {createNodeMock: () => ({parentElement: scroller, style: {setProperty(key, value) {footerStyles[key] = value}}})}) })
  try {
    assert.equal(footerStyles['--s2a-footer-inset'], '24px')
    assert.equal(view.root.findAllByProps({className: 's2a_rowTag'}).some(n => n.children.includes('sub2api-gemini')), false)
     assert.ok(view.root.findAllByProps({className: 's2a_rowTag'}).some(n => n.children.includes('sub2api-openai')))
     await act(async () => {view.root.findByProps({className: 's2a_iconBtn s2a_endpointToggle'}).props.onClick()})
     await act(async () => {view.root.findAllByProps({className: 's2a_iconBtn s2a_expandBtn'})[0].props.onClick()})
    const field = label => view.root.findByProps({'aria-label': `OpenAI test-model ${label}`})
    await act(async () => {field('图片输入').props.onChange({target: {value: 'text-image'}}); field('思考强度档位').props.onChange({target: {value: 'none, high, max'}})})
    const button = text => view.root.findAllByType('button').find(n => n.children.includes(text))
    await act(async () => {await button('补全数据').props.onClick()})
    await act(async () => {await button('保存配置').props.onClick()})
    assert.deepEqual(saved.endpoints[0].models[0].input, ['text', 'image'])
    assert.deepEqual(saved.endpoints[0].models[0].reasoningEfforts, ['none', 'high', 'max'])
    assert.equal(saved.providers, undefined)
    assert.equal(saved.endpoints[0].apiKeyEnv, 'SUB2API_OPENAI_API_KEY')
    assert.equal(saved.endpoints.length, 1)
    assert.equal('analyze' in saved.tools, false)
    assert.equal(view.root.findAllByProps({'aria-label': '识图模型'}).length, 0)
    await act(async () => {field('思考强度档位').props.onChange({target: {value: 'invalid'}})})
    await act(async () => {await button('保存配置').props.onClick()})
    assert.ok(view.root.findByProps({role: 'status'}))
    assert.match(view.root.findByProps({className: 's2a_status s2a_statusErr'}).children.join(''), /思考强度支持/)
    await act(async () => {view.root.findByProps({'aria-label': '关闭提示'}).props.onClick()})
    assert.equal(view.root.findAllByProps({role: 'status'}).length, 0)
    await act(async () => {field('思考模式').props.onChange({target: {value: 'off'}})})
    await act(async () => {await button('保存配置').props.onClick()})
    assert.deepEqual(saved.endpoints[0].models[0].reasoningEfforts, [])
    await act(async () => {for (const callback of timers.values()) callback()})
    assert.equal(view.root.findAllByProps({role: 'status'}).length, 0)
  } finally {await act(async () => view.unmount())}
  assert.equal(observerDisconnected, true)
})

test('the first endpoint on a platform keeps the historical credential reference', async () => {
  const { endpointCredentialRef } = await import('../src/routes.ts')
  // A key stored before endpoint lists existed must keep working as the sole
  // openai endpoint, or upgrading would silently lose every configured key.
  assert.equal(endpointCredentialRef('openai', '', []), 'SUB2API_OPENAI_API_KEY')
  assert.equal(endpointCredentialRef('claude', 'Anything', []), 'SUB2API_CLAUDE_API_KEY')
  // Later endpoints get their own reference so each key is stored separately.
  const first = {platform: 'openai', apiKeyEnv: 'SUB2API_OPENAI_API_KEY'}
  assert.equal(endpointCredentialRef('openai', 'Team A', [first]), 'SUB2API_OPENAI_TEAM_A_API_KEY')
  assert.equal(endpointCredentialRef('openai', '', [first]), 'SUB2API_OPENAI_API_KEY_2')
  // A colliding name must not overwrite the key another entry already owns.
  const taken = {platform: 'openai', apiKeyEnv: 'SUB2API_OPENAI_TEAM_A_API_KEY'}
  assert.equal(endpointCredentialRef('openai', 'Team A', [taken]), 'SUB2API_OPENAI_TEAM_A_API_KEY_2')
})

test('saving an endpoint list stores each key and reports the resolved routes', async () => {
  const { registerRoutes } = await import('../src/routes.ts')
  const handlers = []
  const stored = new Map()
  let config = {baseURL: '', providers: {openai: {}, claude: {}, grok: {}}}
  const credentials = {
    async resolve(ref) {return stored.has(ref) ? {value: stored.get(ref), source: 'file'} : undefined},
    async describe(ref) {return {configured: stored.has(ref), writable: true, ...(stored.has(ref) ? {source: 'file'} : {})}},
    async set(ref, value) {stored.set(String(ref), value)},
    async unset(ref) {stored.delete(ref)},
  }
  registerRoutes({
    inject(_deps, callback) {callback({webServer: {register(entry) {handlers.push(entry)}}, effect(callback) {callback()}})},
    get(name) {return name === 'credentials' ? credentials : undefined},
  }, {
    config: () => config,
    setConfig: next => {config = next},
    listRegisteredRoutes: () => ['sub2api-openai'],
    resolveApiKey: async () => 'stored-key',
  })
  const entry = handlers.find(handler => handler.path === '/plugins/dsh-sub2api/config')
  const call = async (method, body) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const req = {
      method,
      socket: {remoteAddress: '127.0.0.1'},
      headers: {host: '127.0.0.1:43120'},
      async *[Symbol.asyncIterator]() {if (payload.length > 0) yield Buffer.from(payload)},
    }
    let status = 0, text = ''
    await entry.handler(req, {writeHead(code) {status = code}, end(chunk) {text = chunk ?? ''}})
    return {status, body: text.length > 0 ? JSON.parse(text) : undefined}
  }
  // Entries carry their own host, so the request needs no section-level URL.
  const saved = await call('POST', {baseURL: '', endpoints: [
    {name: '', baseURL: 'https://a.test', platform: 'openai', apiKey: 'sk-a', api: '', models: [{id: 'only-a'}]},
    {name: 'Team B', baseURL: 'https://b.test', platform: 'claude', apiKey: 'sk-b', api: '', models: [{id: 'only-b'}]},
  ]})
  assert.equal(saved.status, 200)
  assert.equal(config.endpoints.length, 2)
  // The first entry on a platform keeps the pre-existing reference, so a key
  // configured before this feature keeps working after the upgrade.
  assert.equal(config.endpoints[0].apiKeyEnv, 'SUB2API_OPENAI_API_KEY')
  assert.equal(config.endpoints[1].apiKeyEnv, 'SUB2API_CLAUDE_TEAM_B_API_KEY')
  assert.deepEqual([...stored.values()].sort(), ['sk-a', 'sk-b'])
  const view = await call('GET')
  assert.equal(view.status, 200)
  assert.deepEqual(view.body.endpoints.map(endpoint => endpoint.route), ['sub2api-openai', 'sub2api-claude-team-b'])
  assert.deepEqual(view.body.endpoints.map(endpoint => endpoint.keyConfigured), [true, true])
  assert.equal(JSON.stringify(view.body).includes('sk-a'), false)
  // A request that carries no endpoints key (an older page) must not drop them.
  const legacy = await call('POST', {baseURL: 'https://legacy.test', providers: {}})
  assert.equal(legacy.status, 200)
  assert.equal(config.endpoints.length, 2)
})

test('only the image-generation tool and prompt are registered', async () => {
  const { registerImageTools } = await import('../src/image-tools.ts')
  const tools = [], prompts = []
  registerImageTools({inject(_deps, callback) {callback({tools: {register(tool) {tools.push(tool)}}, systemPrompt: {section(prompt) {prompts.push(prompt)}}})}}, {})
  assert.deepEqual(tools.map(tool => tool.name), ['sub2api_generate_image'])
  assert.deepEqual(prompts.map(prompt => prompt.name), ['tool:sub2api_generate_image'])
})
