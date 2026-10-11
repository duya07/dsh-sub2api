/**
 * Per-model default reasoning level (`defaultReasoningEffort`).
 *
 * The field answers one question: when the user opens a model in the picker and
 * never touches the level selector, which level should it start on? It is a
 * *preference*, not a fact, so it lives in two places only:
 *
 *   - the stored catalog entry (`CatalogModel.defaultReasoningEffort`), which is
 *     the user's decision and therefore wins;
 *   - the built-in preset table (`src/model-presets.ts`), whose value is only a
 *     suggestion, and only where a source actually states a default.
 *
 * `resolveDefaultReasoningEffort` (`src/index.ts`) reads them in exactly that
 * order and never the other way round.
 *
 * Two boundaries this file pins down:
 *
 *   1. **The settings schema does not police membership.** It stores any string,
 *      because the schema is also the loader's normalization path and a value it
 *      rejected would be silently dropped on read. Membership is enforced once,
 *      on the submission route, where a level outside the model's offered set is
 *      *dropped* rather than rewritten (rewriting would overrule the user, and
 *      keeping it would persist a level the picker cannot show).
 *   2. **The field never reaches a pi-ai profile.** `PiAiModelProfile`
 *      (dsh-llm-pi-ai `lib/types/catalog.d.ts`) has no per-model default, and the
 *      only default pi-ai has is route-level (`PiAiProviderProfile.reasoning`) —
 *      promoting one model's preference there would change every other model on
 *      the same route. `CATALOG_ONLY_FIELDS` (`src/pi-ai.ts`) names it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, readVolatile, resolveDefaultReasoningEffort } from '../src/index.ts'
import { registerRoutes } from '../src/routes.ts'
import { CATALOG_ONLY_FIELDS } from '../src/pi-ai.ts'
import { BUILTIN_MODEL_PRESETS } from '../src/model-presets.ts'
import { translateToPiAi } from '../lib/index.js'

const FAKE_KEY = 'sk-fake-gateway-key'

function endpoint(extra = {}) {
  return {
    name: 'gw',
    platform: 'openai',
    baseURL: 'https://gw.test',
    apiKeyEnv: 'GW_KEY',
    api: 'openai-responses',
    models: [{ id: 'gpt-x' }],
    ...extra,
  }
}

function gatewayConfig(extra = {}) {
  return {
    baseURL: 'https://gw.test',
    providers: {
      openai: { apiKeyEnv: 'GW_KEY', models: [{ id: 'gpt-x' }] },
      claude: { apiKeyEnv: 'GW_KEY', models: [{ id: 'claude-x' }] },
      grok: { apiKeyEnv: 'GW_KEY', models: [{ id: 'grok-x' }] },
    },
    endpoints: [endpoint()],
    tools: {},
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// The settings schema: stores the field, invents nothing.
// ---------------------------------------------------------------------------

test('the catalog schema round-trips a per-model default level', () => {
  const stored = Config(gatewayConfig({
    endpoints: [endpoint({ models: [{ id: 'glm-5.3', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' }] })],
  }))
  const model = readVolatile(stored.endpoints)[0].models[0]
  assert.equal(model.defaultReasoningEffort, 'high')
  assert.deepEqual(model.reasoningEfforts, ['low', 'high', 'max'])
})

test('an unset default level stays absent so no level is invented for legacy entries', () => {
  const stored = Config(gatewayConfig({
    endpoints: [endpoint({ models: [{ id: 'glm-5.3' }] })],
  }))
  const model = readVolatile(stored.endpoints)[0].models[0]
  assert.equal('defaultReasoningEffort' in model, false)
  // The neighbouring defaulted field still materializes, which is what makes
  // "absent" meaningful rather than "the schema defaulted it to ''".
  assert.deepEqual(model.reasoningEfforts, ['low', 'medium', 'high'])
})

test('the schema refuses a non-string default level', () => {
  // `null` is "absent" as far as schemastery is concerned, so it is not in this
  // list; the submission route drops it like any other non-string.
  for (const bad of [123, true, ['high'], { level: 'high' }]) {
    assert.throws(
      () => Config(gatewayConfig({
        endpoints: [endpoint({ models: [{ id: 'glm-5.3', defaultReasoningEffort: bad }] })],
      })),
      `expected ${JSON.stringify(bad)} to be refused by the schema`,
    )
  }
})

test('the schema itself does not police membership — the submission route does', () => {
  // A value the model does not offer is not a schema error: rejecting it here
  // would make the loader drop it on read with no way for the user to see why.
  const stored = Config(gatewayConfig({
    endpoints: [endpoint({ models: [{ id: 'glm-5.3', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'ultra' }] })],
  }))
  assert.equal(readVolatile(stored.endpoints)[0].models[0].defaultReasoningEffort, 'ultra')
})

// ---------------------------------------------------------------------------
// The submission route: accepts an offered level, drops anything else.
// ---------------------------------------------------------------------------

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

function postModel(fixture, model) {
  return fixture.call({
    baseURL: 'https://gw.test',
    endpoints: [endpoint({ models: [model] })],
    tools: {},
  })
}

test('the settings POST stores a level the model offers and the GET echoes it', async () => {
  const model = { id: 'glm-5.3', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' }
  const fixture = routesFixture(gatewayConfig({ endpoints: [endpoint({ models: [model] })] }))
  const posted = await postModel(fixture, { ...model, defaultReasoningEffort: ' high ' })
  assert.equal(posted.status, 200)
  assert.equal(fixture.commits.length, 1)
  // Stored trimmed, which is also what makes the membership check meaningful.
  assert.equal(fixture.commits[0].endpoints[0].models[0].defaultReasoningEffort, 'high')

  const read = await fixture.call(undefined, 'GET')
  assert.equal(read.body.endpoints[0].models[0].defaultReasoningEffort, 'high')
})

test('a level outside the declared list is dropped instead of stored', async () => {
  const fixture = routesFixture(gatewayConfig())
  for (const bad of ['ultra', 'xhigh', 'HIGH', 'High', '', '   ']) {
    const posted = await postModel(fixture, { id: 'glm-5.3', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: bad })
    assert.equal(posted.status, 200, `payload with ${JSON.stringify(bad)} must still be accepted`)
  }
  assert.equal(fixture.commits.length, 6)
  for (const commit of fixture.commits) {
    assert.equal(
      'defaultReasoningEffort' in commit.endpoints[0].models[0],
      false,
      `dropped value must not be persisted: ${JSON.stringify(commit.endpoints[0].models[0])}`,
    )
  }
})

test('without a declared list the schema default vocabulary decides membership', async () => {
  const fixture = routesFixture(gatewayConfig())
  const accepted = await postModel(fixture, { id: 'gpt-x', defaultReasoningEffort: 'medium' })
  assert.equal(accepted.status, 200)
  assert.equal(fixture.commits[0].endpoints[0].models[0].defaultReasoningEffort, 'medium')

  // low/medium/high is the vocabulary an absent `reasoningEfforts` resolves to,
  // so a level outside it cannot be stored even though the model is unconfigured.
  const rejected = await postModel(fixture, { id: 'gpt-x', defaultReasoningEffort: 'xhigh' })
  assert.equal(rejected.status, 200)
  assert.equal('defaultReasoningEffort' in fixture.commits[1].endpoints[0].models[0], false)
})

test('an explicit empty level list offers nothing, so no default can be stored', async () => {
  const fixture = routesFixture(gatewayConfig())
  const posted = await postModel(fixture, { id: 'gpt-image-2', reasoningEfforts: [], defaultReasoningEffort: 'low' })
  assert.equal(posted.status, 200)
  const model = fixture.commits[0].endpoints[0].models[0]
  assert.deepEqual(model.reasoningEfforts, [])
  assert.equal('defaultReasoningEffort' in model, false)
})

test('a non-string default level is dropped by the route as well', async () => {
  const fixture = routesFixture(gatewayConfig())
  for (const bad of [123, true, null, ['high'], { level: 'high' }]) {
    const posted = await postModel(fixture, { id: 'glm-5.3', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: bad })
    assert.equal(posted.status, 200, `payload with ${JSON.stringify(bad)} must still be accepted`)
  }
  for (const commit of fixture.commits) {
    assert.equal('defaultReasoningEffort' in commit.endpoints[0].models[0], false)
  }
})

// ---------------------------------------------------------------------------
// Resolution order: the stored level wins, the preset only suggests.
// ---------------------------------------------------------------------------

test('the stored level wins over the preset suggestion', () => {
  assert.equal(
    resolveDefaultReasoningEffort({ defaultReasoningEffort: 'low' }, { defaultReasoningEffort: 'high' }),
    'low',
  )
})

test('the preset suggestion is used when the entry stores none', () => {
  assert.equal(resolveDefaultReasoningEffort({}, { defaultReasoningEffort: 'high' }), 'high')
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: undefined }, { defaultReasoningEffort: 'xhigh' }), 'xhigh')
})

test('neither source set resolves to undefined rather than to a guess', () => {
  assert.equal(resolveDefaultReasoningEffort({}), undefined)
  assert.equal(resolveDefaultReasoningEffort({}, {}), undefined)
  assert.equal(resolveDefaultReasoningEffort({}, undefined), undefined)
})

test('a blank stored level falls back to the preset instead of suppressing it', () => {
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: '' }, { defaultReasoningEffort: 'high' }), 'high')
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: '   ' }, { defaultReasoningEffort: 'high' }), 'high')
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: '' }, { defaultReasoningEffort: '  ' }), undefined)
})

test('a stored level is returned verbatim, never rewritten to fit the offered set', () => {
  // Rewriting here would silently decide for the user. Membership is the
  // submission route's job, and it drops rather than rewrites.
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: 'ultra' }, { defaultReasoningEffort: 'high' }), 'ultra')
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: ' High ' }, {}), 'High')
})

// ---------------------------------------------------------------------------
// The pi-ai boundary: the field stops here.
// ---------------------------------------------------------------------------

test('the translated profile carries no per-model default', () => {
  const profiles = translateToPiAi(gatewayConfig({
    endpoints: [endpoint({
      models: [{ id: 'glm-5.3', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' }],
    })],
  }))
  const profile = profiles['sub2api-openai-gw']
  assert.equal('defaultReasoningEffort' in profile.models[0], false)
  // It must not be promoted to the route-level default either: that would move
  // every other model on this route.
  assert.equal('reasoning' in profile, false)
  // The levels themselves still translate, so nothing else regressed.
  assert.deepEqual(profile.models[0].reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
})

test('CATALOG_ONLY_FIELDS names every catalog field the profile must not carry', () => {
  assert.equal(CATALOG_ONLY_FIELDS.includes('defaultReasoningEffort'), true)
  const profile = translateToPiAi(gatewayConfig({
    endpoints: [endpoint({
      models: [{ id: 'glm-5.3', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high', thinkingMode: 'budget' }],
    })],
  }))['sub2api-openai-gw']
  for (const field of CATALOG_ONLY_FIELDS) {
    assert.equal(field in profile.models[0], false, `${field} must stay out of a pi-ai profile`)
  }
})

// ---------------------------------------------------------------------------
// The built-in table: a suggestion only where a source states one.
// ---------------------------------------------------------------------------

test('every built-in default names a level its own entry offers', () => {
  for (const preset of BUILTIN_MODEL_PRESETS) {
    if (preset.defaultReasoningEffort === undefined) continue
    assert.equal(
      (preset.reasoningEfforts ?? []).includes(preset.defaultReasoningEffort),
      true,
      `${preset.id} suggests ${preset.defaultReasoningEffort}, which it does not offer`,
    )
  }
})

test('only the evidenced models carry a default, and they carry the documented one', () => {
  const withDefault = BUILTIN_MODEL_PRESETS
    .filter((preset) => preset.defaultReasoningEffort !== undefined)
    .map((preset) => preset.id)
  assert.deepEqual(withDefault.sort(), ['glm-5.3', 'qwen3.8-max'])

  const byId = new Map(BUILTIN_MODEL_PRESETS.map((preset) => [preset.id, preset]))
  // Zhipu ships `max` while OpenCode Go / Tencent ship `high` — the conservative
  // source wins (`08-our-presets.md` §6).
  assert.equal(byId.get('glm-5.3').defaultReasoningEffort, 'high')
  assert.equal(byId.get('qwen3.8-max').defaultReasoningEffort, 'xhigh')
  // Deliberately without a default: declaring `max` would show a level the
  // gateway does not actually send.
  assert.equal('defaultReasoningEffort' in byId.get('kimi-k3'), false)
})

test('a built-in suggestion reaches resolution through the table', () => {
  const preset = BUILTIN_MODEL_PRESETS.find((entry) => entry.id === 'glm-5.3')
  assert.equal(resolveDefaultReasoningEffort({}, preset), 'high')
  // …and the stored entry still overrides it.
  assert.equal(resolveDefaultReasoningEffort({ defaultReasoningEffort: 'low' }, preset), 'low')
})
