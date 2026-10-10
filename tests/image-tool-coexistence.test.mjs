// Coexistence regression suite for the Sub2API image tool.
//
// These tests mount the HOST's real registration seams (ToolRuntime from
// @deepseek-ai/dsh-tools, SlotCore from @deepseek-ai/dsh-client-ui-slots) plus
// the plugin's real registerImageTools and browser bundle, so a regression
// shows up as a behavioural failure (a wrong tool name, a thrown
// duplicate-registration error, a prompt that names an unregistered tool) and
// not as a missing-export error. Nothing here reaches the generation path: only
// registration, prompt rendering, the API/settings round-trip and the client
// bundle are exercised, and no image request is ever sent.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { act, create } from 'react-test-renderer'

/** Namespaced tool name this plugin owns by default. */
const STABLE = 'sub2api_generate_image'
/** Upstream dsh-image-gen name; opt-in compatibility alias only. */
const LEGACY = 'generate_image'
/** aria-label of the compatibility checkbox in the settings section. */
const COMPAT_LABEL = '启用兼容工具名 generate_image'

const load = (path) => import(new URL(`../node_modules/${path}`, import.meta.url).href)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const { Context, Service } = await load('@deepseek-ai/cordis/lib/index.js')
const toolsModule = await load('@deepseek-ai/dsh-tools/lib/index.js')
const ToolRuntime = toolsModule.default ?? toolsModule.ToolRuntime
const { defineTool } = toolsModule
const { registerImageTools } = await import('../src/image-tools.ts')

class RecordingSystemPrompt extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
    this.sections = []
  }

  // cordis declares a service's API surface through this table; without it the
  // service never becomes visible to `ctx.get`, and ToolRuntime (which injects
  // systemPrompt) would stay unloaded.
  tools() {
    return () => {}
  }

  section(section) {
    this.sections.push(section)
    return () => {}
  }
}

/** Mount the host's real ToolRuntime behind a recording systemPrompt stub. */
async function mountHost() {
  const ctx = new Context()
  ctx.plugin(RecordingSystemPrompt)
  ctx.plugin(ToolRuntime)
  await sleep(50)
  assert.ok(ctx.get('systemPrompt') !== undefined, 'systemPrompt stub did not mount')
  const tools = ctx.get('tools')
  assert.ok(tools !== undefined, 'host ToolRuntime did not mount')
  return { ctx, tools, prompt: ctx.get('systemPrompt') }
}

/** A registration shaped like a foreign plugin's tool (e.g. dsh-image-gen). */
const mkTool = (name, marker) => defineTool({
  name,
  description: `${marker} (${name})`,
  parameters: { prompt: { type: 'string', required: true } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
    render: () => [{ type: 'text', text: 'ok' }],
  },
  async execute() {
    return { path: '/dev/null' }
  },
})

const visibleNames = (tools) => [...tools.view(void 0).visible.keys()].sort()

function hostConfig(compatToolName) {
  const config = {
    baseURL: 'https://gateway.test/v1',
    providers: { openai: {}, claude: {}, grok: {} },
    tools: {
      generate: {
        provider: 'sub2api-openai-team-a',
        model: 'gpt-image-test',
        ...(compatToolName === undefined ? {} : { compatToolName }),
      },
    },
  }
  return { config: () => config, resolveApiKey: async () => 'test-key', configRef: config }
}

const renderPrompt = (section) => (typeof section.text === 'function' ? section.text({}) : section.text)

const TOOL_NAME_RE = /\b(?:generate_image|generate_images|edit_image|image_generate|video_generate|sub2api_generate_image)\b/g
const unregisteredMentions = (text, registered) => [...new Set(text.match(TOOL_NAME_RE) ?? [])].filter((name) => !registered.includes(name))

/** A mock context whose tools service only offers register/get, like the old test mocks. */
function mockContext(register) {
  const sections = []
  return {
    sections,
    ctx: {
      inject(_deps, callback) {
        callback({
          tools: { register, get: () => undefined },
          systemPrompt: { section(section) { sections.push(section); return () => {} } },
        })
      },
    },
  }
}

test('the default registration owns only the namespaced name', async () => {
  const { ctx, tools, prompt } = await mountHost()
  assert.doesNotThrow(() => registerImageTools(ctx, hostConfig()))
  await sleep(50)
  const names = visibleNames(tools)
  assert.ok(names.includes(STABLE), `expected ${STABLE} in ${JSON.stringify(names)}`)
  assert.equal(names.includes(LEGACY), false, 'the legacy name must stay untouched by default')
  assert.deepEqual(prompt.sections.map((section) => section.name), [`tool:${STABLE}`])
})

test('both registration orders coexist and the native tool is never displaced', async () => {
  // Order A: dsh-image-gen registers first (the production order).
  const first = await mountHost()
  first.tools.register(mkTool(LEGACY, 'dsh-image-gen native'))
  assert.doesNotThrow(() => registerImageTools(first.ctx, hostConfig()))
  await sleep(50)
  const firstNames = visibleNames(first.tools)
  assert.ok(firstNames.includes(STABLE), `expected ${STABLE} in ${JSON.stringify(firstNames)}`)
  assert.match(first.tools.get(LEGACY).description, /native/, 'the native owner must keep the legacy name')

  // Order B: this plugin registers first; the native registrant still wins its own name.
  const second = await mountHost()
  assert.doesNotThrow(() => registerImageTools(second.ctx, hostConfig()))
  await sleep(50)
  assert.doesNotThrow(() => second.tools.register(mkTool(LEGACY, 'dsh-image-gen native')))
  const secondNames = visibleNames(second.tools)
  assert.ok(secondNames.includes(LEGACY) && secondNames.includes(STABLE), JSON.stringify(secondNames))
  assert.match(second.tools.get(LEGACY).description, /native/)
})

test('an occupied namespaced name is yielded conservatively', async () => {
  const { ctx, tools } = await mountHost()
  tools.register(mkTool(STABLE, 'other-plugin'))
  const foreign = tools.get(STABLE)
  assert.doesNotThrow(() => registerImageTools(ctx, hostConfig()))
  await sleep(50)
  assert.equal(tools.get(STABLE), foreign, 'a foreign owner must keep the name')
  assert.deepEqual(visibleNames(tools), [STABLE])
})

test('the compatibility name is opt-in and free-name only', async () => {
  // Absent flag -> off.
  const off = await mountHost()
  assert.doesNotThrow(() => registerImageTools(off.ctx, hostConfig(undefined)))
  await sleep(50)
  assert.equal(visibleNames(off.tools).includes(LEGACY), false)

  // Explicit false -> off.
  const disabled = await mountHost()
  assert.doesNotThrow(() => registerImageTools(disabled.ctx, hostConfig(false)))
  await sleep(50)
  assert.equal(visibleNames(disabled.tools).includes(LEGACY), false)

  // Enabled and free -> both names, namespaced one included.
  const on = await mountHost()
  assert.doesNotThrow(() => registerImageTools(on.ctx, hostConfig(true)))
  await sleep(50)
  assert.deepEqual(visibleNames(on.tools), [LEGACY, STABLE].sort())

  // Enabled but taken -> yield, the native owner keeps the name.
  const taken = await mountHost()
  taken.tools.register(mkTool(LEGACY, 'dsh-image-gen native'))
  const native = taken.tools.get(LEGACY)
  assert.doesNotThrow(() => registerImageTools(taken.ctx, hostConfig(true)))
  await sleep(50)
  assert.equal(taken.tools.get(LEGACY), native)
  assert.ok(visibleNames(taken.tools).includes(STABLE))
})

test('flipping compatToolName in place does not re-register (a reload is required)', async () => {
  const { ctx, tools } = await mountHost()
  const host = hostConfig(false)
  assert.doesNotThrow(() => registerImageTools(ctx, host))
  await sleep(50)
  assert.equal(visibleNames(tools).includes(LEGACY), false)
  host.configRef.tools.generate.compatToolName = true
  await sleep(30)
  assert.equal(visibleNames(tools).includes(LEGACY), false, 'the registration set must not change without a reload')
})

test('a duplicate-name error for our own name is skipped; every other failure surfaces', async () => {
  // Duplicate for our own name -> skipped, the prompt section still registers.
  const duplicate = mockContext(() => {
    throw new Error(`tool "${STABLE}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)`)
  })
  assert.doesNotThrow(() => registerImageTools(duplicate.ctx, hostConfig()))
  assert.deepEqual(duplicate.sections.map((section) => section.name), [`tool:${STABLE}`])
  assert.equal(renderPrompt(duplicate.sections[0]), '', 'an unregistered name must not appear in the prompt')

  // A duplicate for a DIFFERENT name is not ours to absorb.
  const foreign = mockContext(() => {
    throw new Error('tool "other_tool" is already registered (for a per-agent variant, register through that agent\'s `agent.ctx` instead)')
  })
  assert.throws(() => registerImageTools(foreign.ctx, hostConfig()), /other_tool/)

  // Any other host rejection is rethrown untouched.
  const reserved = mockContext(() => {
    throw new Error('tool name "sub2api_generate_image" is reserved for the PTC mode presentation transport and cannot be registered or shadowed')
  })
  assert.throws(() => registerImageTools(reserved.ctx, hostConfig()), /reserved/)
})

test('a duplicate-name error for the compatibility alias is skipped too', () => {
  // The alias is a SECOND registration attempt, so it needs its own coverage:
  // the duplicate check must test the name it is registering right now, not the
  // primary one. Here the registry reports the legacy name as free and the host
  // still rejects it — exactly what another plugin claiming `generate_image`
  // between the lookup and the register would produce. A check hardwired to the
  // namespaced name would let this rejection escape as a mount failure.
  const calls = []
  const sections = []
  const ctx = {
    inject(_deps, callback) {
      callback({
        tools: {
          register: (definition) => {
            calls.push(definition.name)
            if (definition.name === LEGACY) {
              throw new Error(`tool "${LEGACY}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)`)
            }
          },
          get: () => undefined,
        },
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => {}
          },
        },
      })
    },
  }
  assert.doesNotThrow(() => registerImageTools(ctx, hostConfig(true)))
  assert.deepEqual(calls, [STABLE, LEGACY], 'both names are attempted while they look free')
  assert.deepEqual(sections.map((section) => section.name), [`tool:${STABLE}`])
  const text = renderPrompt(sections[0])
  assert.equal(text.includes(STABLE), true)
  // `sub2api_generate_image` contains `generate_image` as a substring, so the
  // assertion has to look for the alias CLAUSE, not the bare word.
  assert.equal(text.includes(`(or ${LEGACY} `), false, 'the rejected alias must not appear in the prompt')
})

test('a registry whose lookup throws surfaces the failure instead of registering', () => {
  // The host real lookup only returns undefined for an unknown name, so a
  // throwing `get` is a genuine registry failure and must not read as "free".
  const sentinel = new Error('registry lookup failed: sentinel')
  const calls = []
  const sections = []
  const ctx = {
    inject(_deps, callback) {
      callback({
        tools: {
          register: (definition) => {
            calls.push(definition.name)
          },
          get: () => {
            throw sentinel
          },
        },
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => {}
          },
        },
      })
    },
  }
  assert.throws(() => registerImageTools(ctx, hostConfig(true)), (error) => error === sentinel)
  assert.deepEqual(calls, [], 'no tool may be registered when the registry lookup throws')
  assert.deepEqual(sections, [], 'no prompt section may be added when the registry lookup throws')

  // A registry with no lookup at all (older hosts, minimal test doubles) is
  // still assumed free, so registration is attempted as before.
  const blindCalls = []
  const blindCtx = {
    inject(_deps, callback) {
      callback({
        tools: {
          register: (definition) => {
            blindCalls.push(definition.name)
          },
        },
        systemPrompt: { section: () => () => {} },
      })
    },
  }
  assert.doesNotThrow(() => registerImageTools(blindCtx, hostConfig()))
  assert.deepEqual(blindCalls, [STABLE], 'a lookup-less registry still gets the namespaced tool')
})

test('the prompt only names tools this plugin actually registered', async () => {
  // (a) normal: the namespaced name registered.
  const normal = await mountHost()
  assert.doesNotThrow(() => registerImageTools(normal.ctx, hostConfig()))
  await sleep(50)
  const normalSection = normal.prompt.sections[0]
  assert.equal(typeof normalSection.text, 'function', 'the prompt must render lazily from the registration result')
  const normalText = renderPrompt(normalSection)
  assert.match(normalText, new RegExp(`\\b${STABLE}\\b`))
  assert.deepEqual(unregisteredMentions(normalText, [STABLE]), [])

  // (b) namespaced name taken, compatibility alias registered -> only the alias is named.
  const aliased = await mountHost()
  aliased.tools.register(mkTool(STABLE, 'other-plugin'))
  assert.doesNotThrow(() => registerImageTools(aliased.ctx, hostConfig(true)))
  await sleep(50)
  const aliasText = renderPrompt(aliased.prompt.sections[0])
  assert.match(aliasText, new RegExp(`\\b${LEGACY}\\b`))
  assert.deepEqual(unregisteredMentions(aliasText, [LEGACY]), [])

  // (c) nothing registered -> empty prompt (the host drops empty sections).
  const none = await mountHost()
  none.tools.register(mkTool(STABLE, 'other-plugin'))
  none.tools.register(mkTool(LEGACY, 'other-plugin'))
  assert.doesNotThrow(() => registerImageTools(none.ctx, hostConfig(true)))
  await sleep(50)
  assert.equal(renderPrompt(none.prompt.sections[0]), '')
})

function loadClientBundle() {
  let plugin
  const required = []
  const require = createRequire(import.meta.url)
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { plugin = factory((name) => { required.push(name); return require(name) }) } } },
    setTimeout,
    clearTimeout,
    btoa,
  })
  const entries = []
  plugin.apply({
    slots: {
      inject(_name, callback) { callback() },
      register(options, component) { entries.push({ options, component }) },
    },
  })
  return { entries, required }
}

test('the browser bundle registers a toolview for the namespaced name only', () => {
  const { entries, required } = loadClientBundle()
  const toolviews = entries.filter((entry) => entry.options.name === 'tool.call.toolview')
  assert.deepEqual(toolviews.map((entry) => entry.options.key), [STABLE])
  const rendered = JSON.stringify(toolviews[0].component({
    block: {
      name: STABLE,
      content: [
        { type: 'text', text: 'saved' },
        { type: 'image', attachment: { attachmentId: 'test', mediaType: 'image/png', bytes: 12, width: 4, height: 3, name: 'x.png' } },
      ],
    },
  }))
  assert.match(rendered, /plugins\/dsh-sub2api\/attachment/)
  // The browser bundle must not pull in Node built-ins or server modules.
  assert.deepEqual(required.filter((name) => name.startsWith('node:')), [])
  assert.deepEqual(required.filter((name) => /(?:image-tools|routes\.ts|\/index\.ts)/.test(name)), [])
})

test('tool names live in a dependency-free shared module', async () => {
  const file = new URL('../src/shared/image-tool-names.ts', import.meta.url)
  const source = readFileSync(file, 'utf8')
  assert.equal(/^\s*import\s/m.test(source), false, 'the shared module must not import anything')
  const names = await import(file.href)
  assert.equal(names.STABLE_IMAGE_TOOL_NAME, STABLE)
  assert.equal(names.LEGACY_IMAGE_TOOL_NAME, LEGACY)

  const client = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(client, /shared\/image-tool-names/)
  assert.equal(/from\s+'(\.\.\/(?:index|routes|image-tools)[^']*)'/.test(client), false)
})

const settingsFixture = (tools) => ({
  baseURL: 'https://gateway.test',
  catalogFormat: 'structured-v1',
  endpoints: [
    { name: 'Team A', platform: 'openai', baseURL: 'https://a.test', apiKeyEnv: 'KEY_A', keyConfigured: true, api: '', route: 'sub2api-openai-team-a', models: [{ id: 'gpt-image-test' }] },
  ],
  ...(tools === undefined ? {} : { tools }),
})

async function settingsPage(config) {
  let plugin
  const saved = []
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { plugin = factory(createRequire(import.meta.url)) } }, setTimeout, clearTimeout },
    fetch: async (url, init) => ({
      ok: true,
      json: async () => {
        if (url === 'https://models.dev/api.json') return {}
        assert.equal(url, '/plugins/dsh-sub2api/config')
        if (init?.method === 'POST') {
          saved.push(JSON.parse(init.body))
          return { ok: true, routes: [] }
        }
        return config
      },
    }),
    btoa,
  })
  const entries = []
  plugin.apply({ slots: { inject(_name, callback) { callback() }, register(options, component) { entries.push({ options, component }) } } })
  let view
  await act(async () => {
    view = create(React.createElement(entries.find((entry) => entry.options.name === 'settings.section').component))
  })
  const button = (root, text) => root.findAllByType('button').find((node) => node.children.includes(text))
  return {
    view,
    saved,
    compat: () => view.root.findByProps({ 'aria-label': COMPAT_LABEL }),
    async change(node, value) { await act(async () => { node.props.onChange({ target: { value, checked: value } }) }) },
    async save() { await act(async () => { await button(view.root, '保存配置').props.onClick() }) },
    async close() { await act(async () => view.unmount()) },
  }
}

test('the settings page round-trips compatToolName without dropping the model ref', async () => {
  const on = await settingsPage(settingsFixture({ generate: { provider: 'sub2api-openai-team-a', model: 'gpt-image-test', compatToolName: true } }))
  try {
    assert.equal(on.compat().props.checked, true)
    await on.save()
    assert.deepEqual(on.saved[0].tools.generate, { provider: 'sub2api-openai-team-a', model: 'gpt-image-test', compatToolName: true })
  } finally {
    await on.close()
  }

  const off = await settingsPage(settingsFixture({ generate: { provider: 'sub2api-openai-team-a', model: 'gpt-image-test' } }))
  try {
    assert.equal(off.compat().props.checked, false)
    await off.change(off.compat(), true)
    await off.save()
    assert.equal(off.saved[0].tools.generate.compatToolName, true)
  } finally {
    await off.close()
  }
})

async function routesHarness() {
  const { registerRoutes } = await import('../src/routes.ts')
  const handlers = []
  const stored = new Map()
  let config = { baseURL: '', providers: { openai: {}, claude: {}, grok: {} } }
  const credentials = {
    async resolve(ref) { return stored.has(ref) ? { value: stored.get(ref), source: 'file' } : undefined },
    async describe(ref) { return { configured: stored.has(ref), writable: true } },
    async set(ref, value) { stored.set(String(ref), value) },
    async unset(ref) { stored.delete(ref) },
  }
  registerRoutes({
    inject(_deps, callback) { callback({ webServer: { register(entry) { handlers.push(entry) } }, effect(callback) { callback() } }) },
    get(name) { return name === 'credentials' ? credentials : undefined },
  }, {
    config: () => config,
    setConfig: (next) => { config = next },
    listRegisteredRoutes: () => [],
    resolveApiKey: async () => 'stored-key',
  })
  const entry = handlers.find((handler) => handler.path === '/plugins/dsh-sub2api/config')
  const call = async (method, body) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const req = {
      method,
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:43120' },
      async *[Symbol.asyncIterator]() { if (payload.length > 0) yield Buffer.from(payload) },
    }
    let status = 0
    let text = ''
    await entry.handler(req, { writeHead(code) { status = code }, end(chunk) { text = chunk ?? '' } })
    return { status, body: text.length > 0 ? JSON.parse(text) : undefined }
  }
  return { call, current: () => config }
}

test('the api round-trips tools.generate.compatToolName through GET and POST', async () => {
  const page = await routesHarness()
  const saved = await page.call('POST', {
    baseURL: 'https://gateway.test',
    providers: {},
    tools: { generate: { provider: 'sub2api-openai-team-a', model: 'gpt-image-test', compatToolName: true } },
  })
  assert.equal(saved.status, 200)
  assert.equal(page.current().tools.generate.compatToolName, true)

  const view = await page.call('GET')
  assert.equal(view.status, 200)
  assert.deepEqual(view.body.tools.generate, { provider: 'sub2api-openai-team-a', model: 'gpt-image-test', compatToolName: true })

  // Turning it back off must not resurrect it, and must not drop the model ref.
  const cleared = await page.call('POST', {
    baseURL: 'https://gateway.test',
    providers: {},
    tools: { generate: { provider: 'sub2api-openai-team-a', model: 'gpt-image-test' } },
  })
  assert.equal(cleared.status, 200)
  assert.equal('compatToolName' in page.current().tools.generate, false)
  const clearedView = await page.call('GET')
  assert.deepEqual(clearedView.body.tools.generate, { provider: 'sub2api-openai-team-a', model: 'gpt-image-test' })
})

/** Load the product registration through the host's own plugin-fork path. */
async function loadFork(ctx, host) {
  const fork = ctx.plugin({
    name: 'sub2api-image-tools-load',
    apply(scope) {
      registerImageTools(scope, host)
    },
  })
  await sleep(50)
  return fork
}

test('unloading and reloading the real registerImageTools leaves nothing behind', async () => {
  const { ctx, tools, prompt } = await mountHost()
  const first = await loadFork(ctx, hostConfig())
  assert.deepEqual(visibleNames(tools), [STABLE])
  assert.deepEqual(prompt.sections.map((section) => section.name), [`tool:${STABLE}`])

  await first.dispose()
  await sleep(50)
  assert.deepEqual(visibleNames(tools), [], 'unloading must release the tool registration')
  assert.equal(tools.get(STABLE), undefined, 'the name must be free again after unload')

  // A reload must not hit "is already registered" for our own name, and the
  // prompt section must be usable again on the fresh load.
  const second = await loadFork(ctx, hostConfig())
  assert.deepEqual(visibleNames(tools), [STABLE], 'a reload must register exactly once')
  const reloadedText = renderPrompt(prompt.sections.at(-1))
  assert.match(reloadedText, new RegExp(`\\b${STABLE}\\b`))
  assert.deepEqual(unregisteredMentions(reloadedText, [STABLE]), [])
  await second.dispose()
})

test('switching the compatibility alias off leaves no alias or prompt residue after reload', async () => {
  const { ctx, tools, prompt } = await mountHost()

  const on = await loadFork(ctx, hostConfig(true))
  assert.deepEqual(visibleNames(tools), [LEGACY, STABLE].sort())
  const onText = renderPrompt(prompt.sections.at(-1))
  assert.match(onText, new RegExp(`\\b${LEGACY}\\b`), 'the alias is named while it is registered')

  await on.dispose()
  await sleep(50)
  assert.deepEqual(visibleNames(tools), [], 'unloading must release both names')
  assert.equal(tools.get(LEGACY), undefined)
  assert.equal(tools.get(STABLE), undefined)

  const off = await loadFork(ctx, hostConfig(false))
  assert.deepEqual(visibleNames(tools), [STABLE], 'the alias must not survive a reload with the switch off')
  const offText = renderPrompt(prompt.sections.at(-1))
  assert.equal(new RegExp(`\\b${LEGACY}\\b`).test(offText), false, 'the prompt must not name the removed alias')
  assert.deepEqual(unregisteredMentions(offText, [STABLE]), [])
  await off.dispose()
})
