/**
 * Route-level stream idle timeout (`streamIdleTimeoutMs`).
 *
 * The host keeps this bound on the *provider profile*, never on a model:
 * `@deepseek-ai/dsh-llm-pi-ai` declares `streamIdleTimeoutMs?: number` inside
 * `PiAiProviderProfile` (node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/types/
 * config.d.ts L128) and resolves it to a required number (same file L155),
 * defaults it to `DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5` (lib/index.js L911,
 * schema at L1041 inside the profile schema, read back at L1095), while
 * `PiAiModelProfile` (lib/types/catalog.d.ts L265-L301) has no such field.
 *
 * One endpoint therefore carries exactly one value, and an absent one has to
 * stay absent so the host default keeps applying to every configuration that
 * was stored before this field existed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { Config, readVolatile } from '../src/index.ts'
import { registerRoutes } from '../src/routes.ts'
import { translateToPiAi } from '../lib/index.js'

const MAX_STREAM_IDLE_TIMEOUT_MS = 2_147_483_647
const HOST_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
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

test('a route-level streamIdleTimeoutMs reaches the provider profile only', () => {
  const profiles = translateToPiAi(gatewayConfig({ endpoints: [endpoint({ streamIdleTimeoutMs: 900000 })] }))
  const profile = profiles['sub2api-openai-gw']
  assert.equal(profile.streamIdleTimeoutMs, 900000)
  // It is a profile field: the host ignores it on a model, so it must not be
  // duplicated there.
  assert.equal('streamIdleTimeoutMs' in profile.models[0], false)
})

test('an unset value stays absent so the host default keeps applying', () => {
  const profile = translateToPiAi(gatewayConfig())['sub2api-openai-gw']
  assert.equal('streamIdleTimeoutMs' in profile, false)
})

test('legacy provider groups never carry the field, even if one is stored', () => {
  const profiles = translateToPiAi({
    baseURL: 'https://gw.test',
    providers: {
      openai: { apiKeyEnv: 'GW_KEY', models: [{ id: 'gpt-x' }], streamIdleTimeoutMs: 600000 },
      claude: { apiKeyEnv: 'GW_KEY', models: [{ id: 'claude-x' }], streamIdleTimeoutMs: 600000 },
      grok: { apiKeyEnv: 'GW_KEY', models: [{ id: 'grok-x' }], streamIdleTimeoutMs: 600000 },
    },
    tools: {},
  })
  for (const [route, profile] of Object.entries(profiles)) {
    assert.equal('streamIdleTimeoutMs' in profile, false, `${route} must keep the host default`)
  }
})

test('the config schema round-trips an endpoint-level value and materializes none', () => {
  const stored = Config(gatewayConfig({ endpoints: [endpoint({ streamIdleTimeoutMs: 900000 })] }))
  assert.equal(readVolatile(stored.endpoints)[0].streamIdleTimeoutMs, 900000)

  const cleared = Config(gatewayConfig())
  assert.equal('streamIdleTimeoutMs' in readVolatile(cleared.endpoints)[0], false)
})

test('the config schema refuses out-of-range endpoint values', () => {
  for (const bad of [0, -1, 1.5, MAX_STREAM_IDLE_TIMEOUT_MS + 1]) {
    assert.throws(
      () => Config(gatewayConfig({ endpoints: [endpoint({ streamIdleTimeoutMs: bad })] })),
      `expected ${String(bad)} to be refused`,
    )
  }
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

test('the settings POST stores the endpoint value and the GET echoes it back', async () => {
  const current = gatewayConfig({ endpoints: [endpoint({ streamIdleTimeoutMs: 900000 })] })
  const fixture = routesFixture(current)
  const posted = await fixture.call({
    baseURL: 'https://gw.test',
    endpoints: [endpoint({ streamIdleTimeoutMs: 900000 })],
    tools: {},
  })
  assert.equal(posted.status, 200)
  assert.equal(fixture.commits.length, 1)
  assert.equal(fixture.commits[0].endpoints[0].streamIdleTimeoutMs, 900000)

  const read = await fixture.call(undefined, 'GET')
  assert.equal(read.body.endpoints[0].streamIdleTimeoutMs, 900000)
})

test('an invalid endpoint value is dropped instead of stored', async () => {
  const fixture = routesFixture(gatewayConfig())
  for (const bad of [0, 1.5, MAX_STREAM_IDLE_TIMEOUT_MS + 1, '900000', null, true]) {
    const posted = await fixture.call({
      baseURL: 'https://gw.test',
      endpoints: [endpoint({ streamIdleTimeoutMs: bad })],
      tools: {},
    })
    assert.equal(posted.status, 200, `payload with ${String(bad)} must still be accepted`)
    assert.equal(fixture.commits.length >= 1, true)
  }
  for (const commit of fixture.commits) {
    assert.equal(
      'streamIdleTimeoutMs' in commit.endpoints[0],
      false,
      `dropped value must not be persisted: ${JSON.stringify(commit.endpoints[0])}`,
    )
  }
})

test('the host schema accepts the translated profile and applies its own default', () => {
  const withValue = readVolatile(PiConfig({
    providers: translateToPiAi(gatewayConfig({ endpoints: [endpoint({ streamIdleTimeoutMs: 900000 })] })),
  }).providers)
  assert.equal(withValue['sub2api-openai-gw'].streamIdleTimeoutMs, 900000)

  const hostDefault = readVolatile(PiConfig({
    providers: translateToPiAi(gatewayConfig()),
  }).providers)
  assert.equal(hostDefault['sub2api-openai-gw'].streamIdleTimeoutMs, HOST_DEFAULT_STREAM_IDLE_TIMEOUT_MS)
})
