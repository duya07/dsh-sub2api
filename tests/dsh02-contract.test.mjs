/**
 * DSH 0.2 contract checks.
 *
 * The 0.1.x line installed this plugin's settings section by calling
 * `installSection`, and read the bridged `llm-pi-ai` section back with
 * `Settings.get()`. 0.2.0-rc.2 removed both. The section is now declared by
 * marking its fields `volatile()`, which makes the loader hand `apply` live
 * cells instead of plain values and notify this plugin when they change; the
 * bridged section is read through `describe()`.
 *
 * These tests exercise exactly those two seams against a hand-built context,
 * because the real harness is the only other thing that provides them.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, apply, readVolatile, syncPiAiProfiles, translateToPiAi } from '../lib/index.js'

const WRITE = Symbol.for('cosmokit.volatile.write')

const PROVIDERS = Object.fromEntries(['openai', 'claude', 'grok'].map((key) => [key, {
  apiKeyEnv: `TEST_${key.toUpperCase()}`,
  models: [{ id: `${key}-test`, reasoningEfforts: ['none', 'high', 'max'] }],
}]))

const section = () => ({
  baseURL: 'https://gateway.test/v1',
  providers: PROVIDERS,
  tools: { generate: { provider: 'sub2api-openai', model: 'openai-test' } },
})

/** A context that provides only what `apply` touches. */
function fixture(initialProviders = {}) {
  const sections = new Map([['llm-pi-ai', { providers: initialProviders }]])
  const handlers = new Map()
  const calls = { configure: 0, replace: [] }
  const settings = {
    configure() {
      calls.configure += 1
      return () => {}
    },
    describe() {
      return [...sections].map(([ns, value]) => ({ ns, value }))
    },
    async replace(ns, next) {
      calls.replace.push(ns)
      sections.set(ns, next)
    },
  }
  const ctx = {
    settings,
    get(name) {
      return name === 'settings' ? settings : undefined
    },
    on(event, handler) {
      handlers.set(event, handler)
      return () => {}
    },
    effect(body) {
      body()
      return () => {}
    },
    inject() {},
    llm: { listProviders: () => [] },
    logger: { error() {}, warn() {}, info() {} },
  }
  return { ctx, calls, sections, handlers }
}

/**
 * The bridge writes through a promise chain and the boot sync runs from a
 * timer, so give both the timer phase and the microtask queue a few turns.
 */
async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('every declared section field resolves to a live cell', () => {
  const parsed = Config(section())
  for (const field of ['baseURL', 'providers', 'tools']) {
    assert.equal(typeof parsed[field]?.get, 'function', `${field} resolves to a cell`)
    assert.equal(WRITE in parsed[field], true, `${field} carries the volatile brand`)
  }
  assert.equal(parsed.baseURL.get(), 'https://gateway.test/v1')
  assert.deepEqual(Object.keys(parsed.providers.get()), ['openai', 'claude', 'grok'])
})

test('readVolatile unwraps a cell and passes a plain literal through', () => {
  const parsed = Config(section())
  assert.equal(readVolatile(parsed.baseURL), 'https://gateway.test/v1')
  assert.equal(readVolatile(parsed.providers).openai.apiKeyEnv, 'TEST_OPENAI')
  assert.deepEqual(readVolatile(PROVIDERS), PROVIDERS)
  assert.equal(readVolatile(undefined), undefined)
})

test('apply configures the section and bridges profiles without installSection', async () => {
  const { ctx, calls, sections } = fixture()
  apply(ctx, Config(section()))
  await settle()

  assert.equal(calls.configure, 1, 'the section is declared exactly once')
  assert.deepEqual(calls.replace, ['llm-pi-ai'], 'boot sync writes the bridged section')

  const bridged = sections.get('llm-pi-ai').providers
  assert.deepEqual(Object.keys(bridged), ['sub2api-openai', 'sub2api-claude', 'sub2api-grok'])
  assert.equal(bridged['sub2api-claude'].baseURL, 'https://gateway.test', 'anthropic drops /v1')
  assert.equal(bridged['sub2api-openai'].baseURL, 'https://gateway.test/v1')
})

test('a volatile-only update re-bridges without a remount', async () => {
  const { ctx, sections, handlers } = fixture()
  const parsed = Config(section())
  apply(ctx, parsed)
  await settle()

  const listener = handlers.get('loader/volatile-update')
  assert.equal(typeof listener, 'function', 'apply subscribes to the loader event')

  // Exactly what the loader does on a volatile-only config change: re-point the
  // cell in place, then dispatch on the owning context.
  parsed.baseURL[WRITE]('https://new.test')
  listener([[ 'baseURL' ]])
  await settle()

  assert.equal(sections.get('llm-pi-ai').providers['sub2api-openai'].baseURL, 'https://new.test/v1')
})

test('the bridge keeps routes it does not own', async () => {
  const external = { api: 'openai-completions', baseURL: 'https://other.test/v1', models: [{ id: 'other' }] }
  const { ctx, sections } = fixture({ external, 'sub2api-gemini': external })
  apply(ctx, Config(section()))
  await settle()

  const providers = sections.get('llm-pi-ai').providers
  assert.equal('external' in providers, true, 'a hand-written route survives')
  assert.equal('sub2api-gemini' in providers, false, 'the legacy gemini route is dropped')
  assert.equal(Object.keys(providers).filter((route) => route.startsWith('sub2api-')).length, 3)
})

test('the boot sync is deferred out of the mounting turn', async () => {
  const { ctx, calls } = fixture()
  apply(ctx, Config(section()))

  assert.equal(calls.replace.length, 0, 'apply itself writes nothing while mounting')

  await settle()
  assert.deepEqual(calls.replace, ['llm-pi-ai'], 'the deferred sync writes once')
})

test('an unchanged section is not rewritten', async () => {
  const { ctx, calls } = fixture()
  apply(ctx, Config(section()))
  await settle()
  assert.equal(calls.replace.length, 1, 'the first boot writes')

  // A restart: the same configured groups are bridged again, and the section
  // that was just stored already describes them. Storing runs the value through
  // pi-ai's schema, which fills defaults the bridge's own literal does not
  // carry, so a raw comparison would miss and write again — forever.
  await syncPiAiProfiles(ctx, section())
  assert.equal(calls.replace.length, 1, 'an unchanged section is left alone')
})

test('a section with no stored value still resolves', async () => {
  const { ctx, calls, sections } = fixture()
  apply(ctx, Config({}))
  await settle()

  assert.equal(calls.configure, 1)
  assert.deepEqual(sections.get('llm-pi-ai').providers, {}, 'nothing is bridged without configured groups')
})

test('translated profiles keep the shapes pi-ai expects', () => {
  const providers = translateToPiAi(section())
  assert.deepEqual(Object.keys(providers), ['sub2api-openai', 'sub2api-claude', 'sub2api-grok'])
  assert.equal(providers['sub2api-claude'].api, 'anthropic-messages')
  assert.equal(providers['sub2api-openai'].api, 'openai-responses')
  assert.equal(providers['sub2api-grok'].api, 'openai-completions')
  assert.deepEqual(providers['sub2api-openai'].models[0].reasoningEfforts, { off: 'none', high: 'high', max: 'max' })
})
