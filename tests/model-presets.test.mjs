import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILTIN_MODEL_PRESETS,
  endpointKey,
  fillMissingModelFields,
  lookupModelPreset,
  modelIdCandidates,
  normalizeModelId,
} from '../src/model-presets.ts'

/** The field names the built-in table is allowed to use. */
const ALLOWED_FIELDS = ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'defaultReasoningEffort', 'compat']
const ALLOWED_INPUT = ['text', 'image']
const ALLOWED_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

const GATEWAY = 'https://gateway.test/v1'

const preset = id => BUILTIN_MODEL_PRESETS.find(entry => entry.id === id)

test('the built-in table carries every unique id of our pool', () => {
  assert.equal(BUILTIN_MODEL_PRESETS.length, 44)
  const ids = BUILTIN_MODEL_PRESETS.map(entry => entry.id)
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique')
  // The 44 ids are the dedup of 70 endpoint-model rows across five endpoints.
  assert.deepEqual(ids.slice(0, 3), ['codex-auto-review', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview'])
  assert.equal(ids.at(-1), 'qwen3.8-max')
})

test('every entry uses only the schema fields, with valid values', () => {
  for (const entry of BUILTIN_MODEL_PRESETS) {
    for (const key of Object.keys(entry)) {
      assert.ok(ALLOWED_FIELDS.includes(key), `${entry.id}: unexpected field ${key}`)
    }
    assert.ok(entry.input.length > 0, `${entry.id}: input must not be empty`)
    for (const modality of entry.input) {
      assert.ok(ALLOWED_INPUT.includes(modality), `${entry.id}: bad modality ${modality}`)
    }
    if (entry.contextWindow !== undefined) {
      assert.ok(Number.isInteger(entry.contextWindow) && entry.contextWindow > 0, `${entry.id}: bad contextWindow`)
    }
    if (entry.maxTokens !== undefined) {
      assert.ok(Number.isInteger(entry.maxTokens) && entry.maxTokens > 0, `${entry.id}: bad maxTokens`)
    }
    if (entry.reasoningEfforts !== undefined) {
      assert.ok(Array.isArray(entry.reasoningEfforts), `${entry.id}: reasoningEfforts must be an array`)
      for (const effort of entry.reasoningEfforts) {
        assert.ok(ALLOWED_EFFORTS.includes(effort), `${entry.id}: unknown effort ${effort}`)
      }
    }
    if (entry.defaultReasoningEffort !== undefined) {
      assert.ok(typeof entry.defaultReasoningEffort === 'string', `${entry.id}: defaultReasoningEffort must be a string`)
      // A suggestion the model itself does not offer would show the picker a
      // level it cannot select.
      assert.ok(
        (entry.reasoningEfforts ?? []).includes(entry.defaultReasoningEffort),
        `${entry.id}: default ${entry.defaultReasoningEffort} is not one of its own levels`,
      )
    }
  }
})

test('windows stay our runtime values, never cc-switch catalog values', () => {
  // 08-our-presets.md §3.A rule 1: cc-switch records the vendor catalog window
  // (gpt-5.4 = 272000, kimi-k3 = 1048576); ours is what the endpoint declared.
  assert.equal(preset('gpt-5.4').contextWindow, 1050000)
  assert.equal(preset('gpt-5.4').maxTokens, 128000)
  assert.equal(preset('kimi-k3').contextWindow, 256000)
  assert.equal(preset('kimi-k2.6').contextWindow, 262144)
  assert.equal(preset('claude-haiku-4-5').contextWindow, 200000)
  assert.equal(preset('claude-fable-5').contextWindow, 1000000)
  // No entry may carry a fabricated window for a model we have no window for.
  assert.equal(preset('codex-auto-review').contextWindow, undefined)
  assert.equal(preset('gpt-6').contextWindow, undefined)
})

test('image models declare an explicit empty level list, not a missing field', () => {
  // `[]` means "reasoning is off", which is a statement — so the field is
  // present, and no default level may be suggested alongside it.
  for (const id of ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
    assert.deepEqual(preset(id).reasoningEfforts, [], `${id} must declare an empty list`)
    assert.equal(Object.hasOwn(preset(id), 'defaultReasoningEffort'), false, `${id} cannot suggest a level`)
  }
})

test('an unknown window stays absent instead of being borrowed from a sibling', () => {
  // `gpt-6` is a gateway alias with no declared window; the field stays absent
  // rather than being copied from its likely sibling `gpt-6-astra`.
  assert.equal(Object.hasOwn(preset('gpt-6'), 'contextWindow'), false)
  assert.equal(Object.hasOwn(preset('codex-auto-review'), 'contextWindow'), false)
  assert.equal(Object.hasOwn(preset('gpt-5.5-codex-auto-review'), 'contextWindow'), false)
  assert.equal(Object.hasOwn(preset('gpt-6'), 'defaultReasoningEffort'), false)
})

test('every entry states its level list, so an empty one can only mean off', () => {
  // There is deliberately no "levels unknown" state: a missing list and `[]`
  // would be indistinguishable to the picker, so every entry declares one and
  // `[]` is reserved for "reasoning is off" (the image models). This is what
  // stops a hand-edited entry from silently dropping its levels.
  for (const entry of BUILTIN_MODEL_PRESETS) {
    assert.ok(
      Object.hasOwn(entry, 'reasoningEfforts'),
      `${entry.id}: reasoningEfforts must be declared (use [] for "off")`,
    )
  }
  assert.equal(Object.hasOwn(preset('gpt-6'), 'reasoningEfforts'), true)
  assert.equal(Object.hasOwn(preset('gpt-5.5-codex-auto-review'), 'reasoningEfforts'), true)
  assert.equal(Object.hasOwn(preset('gpt-image-2'), 'reasoningEfforts'), true)
  // A suggested default without a list is the one combination that must never
  // appear, so it is checked separately from the "every entry declares one" rule.
  for (const entry of BUILTIN_MODEL_PRESETS) {
    if (!Object.hasOwn(entry, 'reasoningEfforts')) {
      assert.equal(Object.hasOwn(entry, 'defaultReasoningEffort'), false, `${entry.id}: default without levels`)
    }
  }
})

test('only the two evidenced models may carry a default level', () => {
  // The field whitelist makes the key legal on every entry, so this is what
  // keeps it from becoming a free-for-all: adding it anywhere else fails here.
  const withDefault = BUILTIN_MODEL_PRESETS
    .filter(entry => Object.hasOwn(entry, 'defaultReasoningEffort'))
    .map(entry => entry.id)
  assert.deepEqual(withDefault.sort(), ['glm-5.3', 'qwen3.8-max'])
  assert.equal(preset('glm-5.3').defaultReasoningEffort, 'high')
  assert.equal(preset('qwen3.8-max').defaultReasoningEffort, 'xhigh')
  // Deliberately without one: the gateway does not send `max` for kimi-k3.
  assert.equal(Object.hasOwn(preset('kimi-k3'), 'defaultReasoningEffort'), false)
})

test('normalizeModelId follows the cc-switch canonicalization order', () => {
  assert.equal(normalizeModelId('openai/gpt-5.5'), 'gpt-5.5')
  assert.equal(normalizeModelId('moonshotai/kimi-k3:free'), 'kimi-k3')
  assert.equal(normalizeModelId('accounts/fireworks/models/llama-v3@fp8'), 'llama-v3-fp8')
  assert.equal(normalizeModelId('claude-opus-5[1m]'), 'claude-opus-5')
  assert.equal(normalizeModelId('  GPT-5.4  '), 'gpt-5.4')
  assert.equal(normalizeModelId('anthropic/claude-fable-5.1'), 'claude-fable-5.1')
  assert.equal(normalizeModelId(''), '')
  assert.equal(normalizeModelId('   '), '')
})

test('normalizeModelId does not swap - and . (that is the candidates job)', () => {
  assert.equal(normalizeModelId('claude-fable-5-1'), 'claude-fable-5-1')
  assert.notEqual(normalizeModelId('claude-fable-5-1'), 'claude-fable-5.1')
})

test('modelIdCandidates produces both the hyphen and the dot spelling', () => {
  const candidates = modelIdCandidates('claude-fable-5-1')
  assert.ok(candidates.includes('claude-fable-5-1'), 'keeps the input spelling')
  assert.ok(candidates.includes('claude-fable-5.1'), 'adds the cc-switch spelling')
  assert.equal(candidates[0], 'claude-fable-5-1', 'input spelling comes first')

  const dotted = modelIdCandidates('claude-opus-4.8')
  assert.ok(dotted.includes('claude-opus-4-8'), 'dot input yields the hyphen spelling')

  const reverse = modelIdCandidates('claude-opus-5.5')
  assert.ok(reverse.includes('claude-opus-5-5'))
})

test('modelIdCandidates swaps one separator at a time, not all of them', () => {
  const candidates = modelIdCandidates('claude-fable-5-1')
  // A blanket replace would yield `claude.fable.5.1` and still miss the target.
  assert.ok(!candidates.includes('claude.fable.5.1'))
  assert.deepEqual(candidates, [
    'claude-fable-5-1',
    'claude.fable-5-1',
    'claude-fable.5-1',
    'claude-fable-5.1',
  ])
})

test('modelIdCandidates deduplicates and handles blank input', () => {
  const candidates = modelIdCandidates('GPT-5.4')
  assert.equal(new Set(candidates).size, candidates.length, 'no duplicates')
  assert.deepEqual(modelIdCandidates(''), [])
  assert.deepEqual(modelIdCandidates('   '), [])
})

test('modelIdCandidates expands vendor prefixes and suffixes', () => {
  const candidates = modelIdCandidates('openai/gpt-5.5')
  assert.ok(candidates.includes('openai/gpt-5.5'))
  assert.ok(candidates.includes('gpt-5.5'), 'normalized id is a candidate')
})

test('endpointKey strips the scheme, the port stays, and version/verb tails go', () => {
  assert.equal(endpointKey('https://gateway.test/v1'), 'gateway.test')
  assert.equal(endpointKey('https://gateway.test'), 'gateway.test')
  assert.equal(endpointKey('https://gateway.test/'), 'gateway.test')
  assert.equal(endpointKey('https://gateway.test/v1/chat/completions'), 'gateway.test')
  assert.equal(endpointKey('https://gateway.test/v1/responses'), 'gateway.test')
  assert.equal(endpointKey('https://gateway.test/v1/messages'), 'gateway.test')
  assert.equal(endpointKey('https://gateway.test/anthropic/v1/messages'), 'gateway.test/anthropic')
  assert.equal(endpointKey('https://gateway.test/anthropic'), 'gateway.test/anthropic')
})

test('endpointKey keeps the port so two gateways on one host stay distinct', () => {
  assert.equal(endpointKey('http://gw.test:6443/v1'), 'gw.test:6443')
  assert.notEqual(endpointKey('http://gw.test:6443/v1'), endpointKey('http://gw.test/v1'))
})

test('endpointKey drops userinfo, query and hash', () => {
  assert.equal(endpointKey('https://user:secret@gw.test/v1'), 'gw.test')
  assert.equal(endpointKey('https://gw.test/v1?api-version=2#frag'), 'gw.test')
})

test('endpointKey only peels version segments at the tail', () => {
  // `v1beta` is a version segment, but it is not trailing here, so it is part
  // of the business path and survives.
  assert.equal(endpointKey('https://gw.test/v1beta/models'), 'gw.test/v1beta/models')
  assert.equal(endpointKey('https://gw.test/v1beta'), 'gw.test')
})

test('endpointKey returns undefined for input it cannot parse', () => {
  assert.equal(endpointKey(''), undefined)
  assert.equal(endpointKey('   '), undefined)
  assert.equal(endpointKey('///'), undefined)
  // A single label is far more likely a typo or a relative path than a gateway;
  // without this check `a/b` would silently become the key `a/b`.
  assert.equal(endpointKey('garbage'), undefined)
  assert.equal(endpointKey('not a url'), undefined)
  assert.equal(endpointKey('a/b'), undefined)
  // A real bare-host form (no scheme) still works — that is what our own
  // endpoint baseURLs look like.
  assert.equal(endpointKey('gateway.test'), 'gateway.test')
  assert.equal(endpointKey('gateway.test/v1'), 'gateway.test')
  // `localhost` is the explicit escape hatch for a single label.
  assert.equal(endpointKey('http://localhost:8080/v1'), 'localhost:8080')
})

/**
 * Every declared level list, pinned by id. Levels are a decision rather than a
 * measurement — a silent edit changes which levels the picker offers — so the
 * whole set is snapshotted instead of spot-checked.
 */
const EFFORT_SNAPSHOT = {
  'codex-auto-review': ['low', 'medium', 'high'],
  'gpt-4o-audio-preview': ['low', 'medium', 'high'],
  'gpt-4o-realtime-preview': ['low', 'medium', 'high'],
  'gpt-5.4': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.4-2026-03-05': ['low', 'medium', 'high'],
  'gpt-5.4-mini': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.5': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.5-codex-auto-review': ['low', 'medium', 'high'],
  'gpt-5.6': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-5.6-terra': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6': ['low', 'medium', 'high'],
  'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-image-1': [],
  'gpt-image-1.5': [],
  'gpt-image-2': [],
  'gpt-image-2.5-flare': [],
  'gpt-image-2.5-sunburst': [],
  'claude-fable-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-fable-5-1': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-haiku-4-5': ['low', 'medium', 'high'],
  'claude-haiku-4-5-20251001': ['low', 'medium', 'high'],
  'claude-opus-4-1-20250805': ['low', 'medium', 'high'],
  'claude-opus-4-20250514': ['low', 'medium', 'high'],
  'claude-opus-4-5-20251101': ['low', 'medium', 'high'],
  'claude-opus-4-8': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-5-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-sonnet-4-6': ['low', 'medium', 'high', 'max'],
  'claude-sonnet-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-sonnet-5-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'deepseek-v4-flash-0731': ['low', 'high', 'max'],
  'deepseek-v4-pro-0813': ['none', 'high'],
  'deepseek-v4-pro-max': ['low', 'medium', 'high', 'xhigh', 'max'],
  'glm-5.2': ['high', 'max'],
  'glm-5.3': ['low', 'high', 'max'],
  'kimi-k2.6': ['low', 'medium', 'high'],
  'kimi-k3': ['low', 'high', 'max'],
  'qwen3.7-max': ['low', 'medium', 'high'],
  'qwen3.8-max': ['low', 'medium', 'xhigh'],
}

test('every entry keeps its declared level list', () => {
  assert.equal(Object.keys(EFFORT_SNAPSHOT).length, 44)
  assert.equal(Object.keys(EFFORT_SNAPSHOT).length, BUILTIN_MODEL_PRESETS.length)
  for (const entry of BUILTIN_MODEL_PRESETS) {
    assert.ok(Object.hasOwn(EFFORT_SNAPSHOT, entry.id), `${entry.id} is missing from the snapshot`)
    assert.deepEqual(entry.reasoningEfforts, EFFORT_SNAPSHOT[entry.id], `${entry.id}: level list changed`)
  }
})

test('the composite-group endpoint keeps the level lists we pinned for it', () => {
  // endpoint-5 is a gateway composite group: these nine names do not identify a
  // real backend, so their levels are what we decided, not a vendor fact.
  const composite = {
    'deepseek-v4-flash-0731': ['low', 'high', 'max'],
    'deepseek-v4-pro-0813': ['none', 'high'],
    'deepseek-v4-pro-max': ['low', 'medium', 'high', 'xhigh', 'max'],
    'glm-5.2': ['high', 'max'],
    'glm-5.3': ['low', 'high', 'max'],
    'kimi-k2.6': ['low', 'medium', 'high'],
    'kimi-k3': ['low', 'high', 'max'],
    'qwen3.7-max': ['low', 'medium', 'high'],
    'qwen3.8-max': ['low', 'medium', 'xhigh'],
  }
  assert.equal(Object.keys(composite).length, 9)
  for (const [id, levels] of Object.entries(composite)) {
    assert.deepEqual(preset(id).reasoningEfforts, levels, `${id}: level list changed`)
  }
})

test('lookupModelPreset matches exactly, case-insensitively and normalized', () => {
  assert.equal(lookupModelPreset(GATEWAY, 'gpt-5.6-sol').id, 'gpt-5.6-sol')
  assert.equal(lookupModelPreset(GATEWAY, 'GPT-5.6-SOL').id, 'gpt-5.6-sol')
  assert.equal(lookupModelPreset(GATEWAY, 'openai/gpt-5.5').id, 'gpt-5.5')
  assert.equal(lookupModelPreset(GATEWAY, '  kimi-k3  ').id, 'kimi-k3')
  assert.equal(lookupModelPreset(GATEWAY, 'gpt-5.6-sol').contextWindow, 1050000)
})

test('lookupModelPreset closes the -/. gap from 08-our-presets.md §5.1', () => {
  // cc-switch spells these with a dot; our table uses a hyphen.
  assert.equal(lookupModelPreset(GATEWAY, 'claude-fable-5.1').id, 'claude-fable-5-1')
  assert.equal(lookupModelPreset(GATEWAY, 'anthropic/claude-fable-5.1').id, 'claude-fable-5-1')
  assert.equal(lookupModelPreset(GATEWAY, 'claude-opus-4.8').id, 'claude-opus-4-8')
  assert.equal(lookupModelPreset(GATEWAY, 'claude-opus-5.5').id, 'claude-opus-5-5')
  // ...and the reverse direction keeps working.
  assert.equal(lookupModelPreset(GATEWAY, 'claude-fable-5-1').id, 'claude-fable-5-1')
})

test('lookupModelPreset returns undefined instead of guessing', () => {
  assert.equal(lookupModelPreset(GATEWAY, 'gpt-9-nonexistent'), undefined)
  // A prefix of a known family must NOT resolve.
  assert.equal(lookupModelPreset(GATEWAY, 'gpt-5'), undefined)
  assert.equal(lookupModelPreset(GATEWAY, 'gpt-5.4-mini-unknown'), undefined)
  assert.equal(lookupModelPreset(GATEWAY, 'claude-opus-6'), undefined)
  assert.equal(lookupModelPreset(GATEWAY, ''), undefined)
  assert.equal(lookupModelPreset('', 'gpt-5.5'), undefined)
  assert.equal(lookupModelPreset('///', 'gpt-5.5'), undefined)
})

test('fillMissingModelFields fills blanks and never overwrites', () => {
  const target = { id: 'gpt-5.6-sol' }
  const filled = fillMissingModelFields(target, preset('gpt-5.6-sol'))
  assert.deepEqual(filled, {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    contextWindow: 1050000,
    maxTokens: 128000,
    input: ['text', 'image'],
    reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  })
  // The input object is untouched.
  assert.deepEqual(target, { id: 'gpt-5.6-sol' })

  const userValues = {
    id: 'gpt-5.6-sol',
    name: 'My Sol',
    contextWindow: 64000,
    maxTokens: 4096,
    input: ['text'],
    reasoningEfforts: ['high'],
  }
  const kept = fillMissingModelFields(userValues, preset('gpt-5.6-sol'))
  assert.equal(kept, userValues, 'nothing to fill returns the same object')
  assert.equal(kept.contextWindow, 64000)
  assert.equal(kept.maxTokens, 4096)
  assert.deepEqual(kept.input, ['text'])
  assert.deepEqual(kept.reasoningEfforts, ['high'])
  assert.equal(kept.name, 'My Sol')
})

test('fillMissingModelFields treats an empty input array as blank', () => {
  const filled = fillMissingModelFields({ id: 'kimi-k3', input: [] }, preset('kimi-k3'))
  assert.deepEqual(filled.input, ['text', 'image'])
})

test('fillMissingModelFields treats an explicit empty reasoning list as a decision', () => {
  // `[]` means "reasoning is off", not "unknown", so it must survive.
  const filled = fillMissingModelFields({ id: 'gpt-5.6-sol', reasoningEfforts: [] }, preset('gpt-5.6-sol'))
  assert.deepEqual(filled.reasoningEfforts, [])
  // Whereas an image model's `[]` does fill a genuinely absent field.
  const image = fillMissingModelFields({ id: 'gpt-image-2' }, preset('gpt-image-2'))
  assert.deepEqual(image.reasoningEfforts, [])
})

test('fillMissingModelFields copies arrays so callers cannot alias the table', () => {
  const filled = fillMissingModelFields({ id: 'gpt-5.6-sol' }, preset('gpt-5.6-sol'))
  assert.notEqual(filled.input, preset('gpt-5.6-sol').input)
  filled.input.push('image')
  assert.deepEqual(preset('gpt-5.6-sol').input, ['text', 'image'])
})

test('a discovered model can be filled end to end without touching the table', () => {
  const discovered = { id: 'claude-fable-5.1' }
  const found = lookupModelPreset(GATEWAY, discovered.id)
  assert.notEqual(found, undefined)
  const merged = fillMissingModelFields({ id: discovered.id }, found)
  assert.equal(merged.contextWindow, 1000000)
  assert.equal(merged.maxTokens, 128000)
  assert.deepEqual(merged.input, ['text', 'image'])
  assert.equal(merged.name, 'claude-fable-5-1', 'the table name wins for a display default')
})
