/**
 * Claude-platform thinking dispatch — regression tests.
 *
 * On the `anthropic-messages` protocol, pi-ai picks the wire shape from
 * `model.compat.forceAdaptiveThinking`:
 *
 *   set   -> `thinking: { type: "adaptive" }`, plus `output_config.effort`
 *            when a thinking level is selected
 *   unset -> `thinking: { type: "enabled", budget_tokens: N }`
 *
 * Current Claude deployments reject the fixed-budget shape with a 400
 * invalid_request_error ("... requires adaptive thinking or
 * thinking.type=between_tools; omit thinking or use one of those modes"), and
 * they reject `thinking: { type: "disabled" }` as well. An anthropic route
 * therefore has to (a) declare the adaptive switch, and (b) leave the `off`
 * level undeclared: the host pins undeclared levels to `null`, and pi-ai reads
 * an `off` of `null` as "send no thinking parameter at all", while an
 * explicitly declared `off` (`"none"`, or a `null` left in the map) makes it
 * send `{ type: "disabled" }`.
 *
 * The wire assertions run pi-ai's real `streamSimple` against a recording
 * fetch, so they pin the actual request body. The openai and openai-completions
 * routes are pinned byte-for-byte against tests/fixtures/translate-baseline.json,
 * which was dumped from the pre-change build.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { translateToPiAi } from '../lib/index.js'

const baseline = JSON.parse(
  readFileSync(new URL('./fixtures/translate-baseline.json', import.meta.url), 'utf8'),
)

/** Same input the baseline was dumped from (see tmp-probe/export-baseline.mjs). */
const config = {
  baseURL: 'https://gateway.test/v1',
  providers: {
    openai: { apiKeyEnv: 'TEST_OPENAI', models: [{ id: 'gpt-x', reasoningEfforts: ['none', 'high', 'max'] }] },
    claude: { apiKeyEnv: 'TEST_CLAUDE', models: [{ id: 'claude-x', reasoningEfforts: ['none', 'low', 'medium', 'high'] }] },
    grok: { apiKeyEnv: 'TEST_GROK', models: [{ id: 'grok-x' }] },
  },
  tools: {},
}

const endpoints = [
  {
    name: 'team-b',
    baseURL: 'https://gateway.test/v1',
    platform: 'claude',
    apiKeyEnv: 'TEST_CLAUDE_B',
    models: [{ id: 'claude-y', reasoningEfforts: ['low', 'high'], contextWindow: 200000, maxTokens: 32000 }],
  },
  {
    platform: 'openai',
    baseURL: 'https://gateway.test',
    apiKeyEnv: 'TEST_OPENAI_B',
    models: [{ id: 'gpt-y' }],
  },
  {
    platform: 'claude',
    apiKeyEnv: 'TEST_CLAUDE_C',
    models: [{ id: 'claude-only-off', reasoningEfforts: ['none'] }],
  },
]

const endpointConfig = { baseURL: 'https://gateway.test/v1', providers: {}, endpoints, tools: {} }

/**
 * Mirror of the host's `resolveModelReasoning` validation
 * (@deepseek-ai/dsh-llm-pi-ai lib/index.js L567-L590): returns the reason a
 * profile would be refused, or null when it is accepted.
 */
function hostReasoningError(efforts) {
  if (efforts === undefined || efforts === false) return null
  const entries = Object.entries(efforts)
  if (entries.length === 0) return 'empty reasoningEfforts'
  for (const [level, wire] of entries) {
    if (wire === null) {
      if (level !== 'off') return `null wire value for "${level}"`
      continue
    }
    if (typeof wire !== 'string' || wire.length === 0) return `empty wire value for "${level}"`
  }
  if (!entries.some(([level, wire]) => level !== 'off' && wire !== null)) {
    return 'offers no level beyond "off"'
  }
  return null
}

const HOST_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Mirror of the host's `resolveModelReasoning` pinning rule (same file,
 * L580-L585) plus the model fields the adapter materializes: undeclared levels
 * become `null`, an explicit `off: null` stays out of the map.
 */
function materialize(profile, model) {
  const efforts = model.reasoningEfforts
  const wire = {
    id: model.id,
    api: profile.api,
    provider: 'test',
    baseUrl: profile.baseURL,
    input: model.input ?? profile.defaultInput,
    contextWindow: model.contextWindow ?? profile.defaultContextWindow,
    maxTokens: model.maxTokens ?? profile.defaultMaxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(model.compat !== undefined ? { compat: model.compat } : {}),
  }
  if (efforts !== undefined && efforts !== false) {
    wire.reasoning = true
    const map = {}
    for (const level of HOST_LEVELS) {
      const value = efforts[level]
      if (value === undefined) map[level] = null
      else if (value !== null) map[level] = value
    }
    wire.thinkingLevelMap = map
  }
  return wire
}

const ANTHROPIC_MODULE = new URL(
  '../node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js',
  import.meta.url,
)
const { streamSimple } = await import(ANTHROPIC_MODULE.href)

/** Run pi-ai's real dispatch against a recording fetch and return the body. */
async function captureRequest(model, options) {
  const captured = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    let body = null
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null
    } catch {
      body = null
    }
    captured.push({ url: String(input?.url ?? input), body })
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'test-stop' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const stream = streamSimple(
      model,
      { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] },
      { apiKey: 'test-key', maxRetries: 0, ...options },
    )
    for await (const _chunk of stream) {
      // drain; the synthetic 400 ends the stream
    }
  } catch {
    // expected: the recording fetch answers 400
  } finally {
    globalThis.fetch = original
  }
  assert.equal(captured.length, 1, 'exactly one upstream request must be issued')
  return captured[0]
}

test('openai and openai-completions routes stay byte-for-byte identical', () => {
  const legacy = translateToPiAi(config)
  assert.deepEqual(legacy['sub2api-openai'], baseline.legacy['sub2api-openai'])
  assert.deepEqual(legacy['sub2api-grok'], baseline.legacy['sub2api-grok'])

  const viaEndpoints = translateToPiAi(endpointConfig)
  assert.deepEqual(viaEndpoints['sub2api-openai'], baseline.endpoints['sub2api-openai'])
})

test('claude routes declare adaptive thinking and never a disabled/off level', () => {
  const legacy = translateToPiAi(config)
  const claude = legacy['sub2api-claude']
  assert.equal(claude.api, 'anthropic-messages')

  // Adaptive-aware dispatch, same base model as before the fix.
  const expected = { ...baseline.legacy['sub2api-claude'].models[0] }
  expected.reasoningEfforts = { low: 'low', medium: 'medium', high: 'high' }
  expected.compat = { forceAdaptiveThinking: true }
  assert.deepEqual(claude.models[0], expected)

  const viaEndpoints = translateToPiAi(endpointConfig)
  const team = viaEndpoints['sub2api-claude-team-b'].models[0]
  assert.deepEqual(team.reasoningEfforts, { low: 'low', high: 'high' })
  assert.deepEqual(team.compat, { forceAdaptiveThinking: true })

  // A model whose only level is "off" is refused by the host when it is
  // emitted as `{ off: "none" }` ("offers no level beyond off"), so an
  // anthropic route declares it as a non-reasoning model instead.
  const offOnly = viaEndpoints['sub2api-claude-2'].models[0]
  assert.equal(offOnly.reasoningEfforts, false)
})

test('every emitted anthropic model passes the host reasoning validation', () => {
  const profiles = { ...translateToPiAi(config), ...translateToPiAi(endpointConfig) }
  const anthropic = Object.entries(profiles).filter(([, profile]) => profile.api === 'anthropic-messages')
  assert.ok(anthropic.length >= 3, 'expected the claude routes to be covered')
  for (const [name, profile] of anthropic) {
    for (const model of profile.models) {
      assert.equal(
        hostReasoningError(model.reasoningEfforts),
        null,
        `${name}/${model.id} would be refused: ${hostReasoningError(model.reasoningEfforts)}`,
      )
    }
  }
})

test('thinkingMode "budget" keeps the legacy fixed-budget dispatch available', () => {
  const profiles = translateToPiAi({
    ...config,
    providers: {
      ...config.providers,
      claude: {
        apiKeyEnv: 'TEST_CLAUDE',
        models: [{ id: 'claude-legacy', reasoningEfforts: ['none', 'high'], thinkingMode: 'budget' }],
      },
    },
  })
  const model = profiles['sub2api-claude'].models[0]
  assert.equal(model.compat, undefined)
  assert.deepEqual(model.reasoningEfforts, { off: 'none', high: 'high' })
})

/** Normalize profiles exactly the way the settings layer does. */
function schemaRoundTrip(profiles) {
  const parsed = PiConfig({ providers: profiles })
  return typeof parsed.providers?.get === 'function' ? parsed.providers.get() : parsed.providers
}

test('the emitted profiles pass the host config schema with the switch preserved', () => {
  const resolved = schemaRoundTrip(translateToPiAi(config))
  assert.equal(resolved['sub2api-claude'].models[0].compat?.forceAdaptiveThinking, true)
  assert.equal(resolved['sub2api-openai'].models[0].compat?.forceAdaptiveThinking, undefined)
})

test('a schema round trip stays idempotent, so the settings write does not loop', () => {
  const once = schemaRoundTrip(translateToPiAi(config))
  const twice = schemaRoundTrip(JSON.parse(JSON.stringify(once)))
  assert.deepEqual(twice, once)
})

test('the wire request carries adaptive thinking with the selected effort', async () => {
  const profile = translateToPiAi(config)['sub2api-claude']
  const model = materialize(profile, profile.models[0])
  const request = await captureRequest(model, { reasoning: 'medium' })
  assert.equal(request.body.thinking?.type, 'adaptive')
  assert.equal(request.body.output_config?.effort, 'medium')
  assert.equal(request.body.thinking?.budget_tokens, undefined)
})

test('turning thinking off sends no thinking parameter at all', async () => {
  const profile = translateToPiAi(config)['sub2api-claude']
  const model = materialize(profile, profile.models[0])
  const request = await captureRequest(model, {})
  assert.ok(
    !('thinking' in request.body),
    `thinking must be omitted when the level is off, got ${JSON.stringify(request.body.thinking)}`,
  )
})
