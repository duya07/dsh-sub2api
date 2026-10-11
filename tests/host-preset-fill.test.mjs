/**
 * The host-side wiring of the bundled capability table (P0-F8).
 *
 * `llm-sub2api.endpoints[].models[]` is the authoritative catalog, and
 * `fillMissingModelFields` / `resolveDefaultReasoningEffort` used to be dead
 * code: nothing under `src/` called them, so a model the user never sized
 * reached pi-ai with no window, no output cap, and no default level, and the
 * host fell back to its own 262,144 / 32,768 defaults.
 *
 * These tests pin the wiring itself — what the host fills, what it refuses to
 * overwrite, and that the filled values reach both the settings echo and the
 * bridged pi-ai profile the host actually requests with.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, apply, offeredReasoningLevels, readVolatile, withPresetDefaults } from '../src/index.ts'

/** One endpoint carrying `models`, with an optional own host. */
function endpoint(models, baseURL) {
  return {
    name: 'Team A',
    platform: 'openai',
    apiKeyEnv: 'OWN_A',
    models,
    ...(baseURL !== undefined ? { baseURL } : {}),
  }
}

/**
 * A context that provides only what `apply` touches, plus the web handlers it
 * registers so the settings echo can be read back.
 */
function fixture() {
  const sections = new Map([['llm-pi-ai', { providers: {} }]])
  const handlers = []
  const settings = {
    configure() {
      return () => {}
    },
    describe() {
      return [...sections].map(([ns, value]) => ({ ns, value }))
    },
    async replace(ns, next) {
      sections.set(ns, next)
    },
  }
  const ctx = {
    settings,
    get(name) {
      return name === 'settings' ? settings : undefined
    },
    on() {
      return () => {}
    },
    effect(body) {
      body()
      return () => {}
    },
    inject(deps, callback) {
      const cb = typeof callback === 'function' ? callback : typeof deps === 'function' ? deps : undefined
      if (cb === undefined) return
      cb({
        webServer: { register(entry) { handlers.push(entry) } },
        tools: { get() { return undefined }, register() {} },
        systemPrompt: { section() {} },
        effect() {},
      })
    },
    llm: { listProviders: () => [] },
    logger: { error() {}, warn() {}, info() {} },
  }
  return { ctx, sections, handlers }
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

test('an unsized model takes the table window, output cap, modalities and levels', () => {
  // Through `Config({...})`, like the live path: the settings schema
  // materializes `reasoningEfforts` to its default vocabulary, so a model that
  // never declared levels arrives carrying `low, medium, high`. The fill has to
  // read that list as unset, otherwise the table's own list can never apply (F1).
  const stored = Config({ baseURL: 'https://fallback.test', endpoints: [endpoint([{ id: 'glm-5.3' }])] })
  const [first] = readVolatile(stored.endpoints)
  assert.deepEqual(first.models[0].reasoningEfforts, ['low', 'medium', 'high'], 'the schema materializes its default vocabulary')

  const filled = withPresetDefaults(first, readVolatile(stored.baseURL)).models[0]
  assert.equal(filled.name, 'glm-5.3')
  assert.equal(filled.contextWindow, 256000)
  assert.equal(filled.maxTokens, 65536)
  assert.deepEqual(filled.input, ['text'])
  assert.deepEqual(filled.reasoningEfforts, ['low', 'high', 'max'])
})

test('a value the user typed is never overwritten', () => {
  const typed = {
    id: 'glm-5.3',
    name: 'My GLM',
    contextWindow: 1000,
    maxTokens: 2000,
    input: ['text', 'image'],
    reasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'low',
  }
  const filled = withPresetDefaults(endpoint([typed]), 'https://fallback.test').models[0]
  assert.equal(filled.name, 'My GLM')
  assert.equal(filled.contextWindow, 1000)
  assert.equal(filled.maxTokens, 2000)
  assert.deepEqual(filled.input, ['text', 'image'])
  assert.deepEqual(filled.reasoningEfforts, ['low', 'high'])
  assert.equal(filled.defaultReasoningEffort, 'low')
})

test('a model with no default of its own takes the table suggestion', () => {
  assert.equal(withPresetDefaults(endpoint([{ id: 'glm-5.3' }]), 'https://fallback.test').models[0].defaultReasoningEffort, 'high')
  assert.equal(withPresetDefaults(endpoint([{ id: 'qwen3.8-max' }]), 'https://fallback.test').models[0].defaultReasoningEffort, 'xhigh')
})

test('a table suggestion survives the schema-materialized level list', () => {
  // The membership check has to run against the *table's* list, not the
  // schema's: `qwen3.8-max` suggests `xhigh`, which the default vocabulary
  // does not contain, so a fill that kept the materialized list would drop the
  // suggestion (F2).
  const stored = Config({ baseURL: 'https://fallback.test', endpoints: [endpoint([{ id: 'qwen3.8-max' }])] })
  const [first] = readVolatile(stored.endpoints)
  const filled = withPresetDefaults(first, readVolatile(stored.baseURL)).models[0]
  assert.deepEqual(filled.reasoningEfforts, ['low', 'medium', 'xhigh'])
  assert.equal(filled.defaultReasoningEffort, 'xhigh')
})

test('a suggestion the model cannot run is dropped, not stored', () => {
  const filled = withPresetDefaults(endpoint([{ id: 'glm-5.3', reasoningEfforts: ['low'] }]), 'https://fallback.test').models[0]
  assert.deepEqual(filled.reasoningEfforts, ['low'])
  assert.equal(filled.defaultReasoningEffort, undefined)
})

test('a model that does not think at all gets no default level', () => {
  const filled = withPresetDefaults(endpoint([{ id: 'glm-5.3', reasoningEfforts: [] }]), 'https://fallback.test').models[0]
  assert.deepEqual(filled.reasoningEfforts, [])
  assert.equal(filled.defaultReasoningEffort, undefined)
})

test('an id outside the table is left alone', () => {
  const unknown = endpoint([{ id: 'nobody-knows-this-model' }])
  assert.equal(withPresetDefaults(unknown, 'https://fallback.test'), unknown)
})

test('an endpoint nothing was filled into keeps its identity', () => {
  const sized = endpoint([{
    id: 'glm-5.3',
    name: 'glm-5.3',
    contextWindow: 256000,
    maxTokens: 65536,
    input: ['text'],
    reasoningEfforts: ['low', 'high', 'max'],
    defaultReasoningEffort: 'high',
  }])
  assert.equal(withPresetDefaults(sized, 'https://fallback.test'), sized)
})

test('an endpoint with no models of its own is passed through untouched', () => {
  const bare = { name: 'Team A', platform: 'openai' }
  assert.equal(withPresetDefaults(bare, 'https://fallback.test'), bare)
})

test('the bridged pi-ai profile carries the values the user never typed', async () => {
  const { ctx, sections } = fixture()
  apply(ctx, Config({
    baseURL: 'https://a.test',
    endpoints: [endpoint([{ id: 'glm-5.3' }], 'https://a.test')],
  }))
  await settle()

  const providers = sections.get('llm-pi-ai').providers
  const route = Object.keys(providers).find((key) => key.startsWith('sub2api-openai'))
  assert.ok(route, 'the endpoint produced an openai route')
  const model = providers[route].models[0]
  // The window and the output cap reach pi-ai — that is what the wiring is for.
  assert.equal(model.contextWindow, 256000)
  assert.equal(model.maxTokens, 65536)
  // The level list is the table's, not the schema's: a materialized default
  // vocabulary reads as unset, so `glm-5.3` reaches pi-ai as `low, high, max`
  // (F1).
  assert.deepEqual(model.reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
  assert.equal('defaultReasoningEffort' in model, false, 'the level stays a llm-sub2api concern')
})

test('the settings echo carries what the table filled', async () => {
  const { ctx, handlers } = fixture()
  apply(ctx, Config({
    baseURL: 'https://a.test',
    endpoints: [endpoint([{ id: 'glm-5.3' }], 'https://a.test')],
  }))
  await settle()

  const handler = handlers.find((entry) => entry.path === '/plugins/dsh-sub2api/config').handler
  const req = {
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:43120' },
    async *[Symbol.asyncIterator]() {},
  }
  let text
  await handler(req, { writeHead() {}, end(value) { text = value } })
  const echoed = JSON.parse(text).endpoints[0].models[0]
  assert.equal(echoed.contextWindow, 256000)
  assert.equal(echoed.maxTokens, 65536)
  assert.equal(echoed.defaultReasoningEffort, 'high')
})

test('the offered levels are one list, shared with the submission route', () => {
  assert.deepEqual(offeredReasoningLevels(undefined), ['low', 'medium', 'high'])
  assert.deepEqual(offeredReasoningLevels([]), [])
  assert.deepEqual(offeredReasoningLevels(['high']), ['high'])
})
