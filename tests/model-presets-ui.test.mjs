/**
 * The settings-UI wiring for the bundled capability table (P0-3).
 *
 * Two behaviours are covered:
 *   - discovery fills a fresh row's empty capacity fields from
 *     `src/model-presets.ts`, labels the fields it wrote, and never touches a
 *     value the row already carries;
 *   - the per-model default reasoning level is editable, offers exactly the
 *     levels that row declares, and is refused on save when it is not one.
 *
 * The client bundle is exercised through the real registration path (the
 * `settings.section` slot), so a component that stopped rendering would fail
 * here as well.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { lookupModelPreset, presetFieldsToFill } from '../src/model-presets.ts'

const base = '/plugins/dsh-sub2api'

const fixture = (models = [], autoProbeReasoning = false) => ({
  baseURL: 'https://fallback.test',
  catalogFormat: 'structured-v1',
  endpoints: [
    {
      name: 'Team A',
      baseURL: 'https://a.test',
      platform: 'openai',
      apiKeyEnv: 'OWN_A',
      keyConfigured: true,
      api: '',
      route: 'sub2api-openai-team-a',
      autoProbeReasoning,
      models,
    },
  ],
})

async function page(options = {}) {
  let plugin
  const saved = []
  const cfg = options.config ?? fixture()
  vm.runInNewContext(readFileSync(process.env.SUB2API_UI_BUNDLE ?? new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { plugin = factory(createRequire(import.meta.url)) } }, setTimeout, clearTimeout },
    AbortController,
    fetch: async (url, init) => {
      let result
      if (url === 'https://models.dev/api.json') result = options.catalog ?? {}
      else if (url === `${base}/config`) {
        if (init?.method === 'POST') {
          saved.push(JSON.parse(init.body))
          result = { ok: true, routes: ['sub2api-openai-team-a'] }
        } else result = cfg
      } else if (url === `${base}/discover`) result = { models: options.discovered ?? [] }
      else if (url === `${base}/usage`) result = { summary: 'fixture usage' }
      else if (url === `${base}/reasoning/start`) result = { id: 'task', phase: 'queued', maxRequests: 4, minGapMs: 5000, requests: 0 }
      else if (url === `${base}/reasoning/status`) result = { id: 'task', phase: 'running', maxRequests: 4, requests: 0, levels: [], suggestion: [] }
      else if (url === `${base}/reasoning/cancel`) result = { id: 'task', phase: 'cancelled', suggestion: [] }
      else assert.fail(`unexpected external I/O: ${url}`)
      return { ok: true, status: 200, json: async () => result }
    },
    btoa,
  })
  const entries = []
  plugin.apply({ slots: { inject(_name, callback) { callback() }, register(options, component) { entries.push({ options, component }) } } })
  let view
  await act(async () => { view = create(React.createElement(entries.find(entry => entry.options.name === 'settings.section').component)) })
  const button = (root, text) => root.findAllByType('button').find(node => node.children.includes(text))
  const click = async (node) => { assert.ok(node, 'expected a control'); await act(async () => { await node.props.onClick() }) }
  const field = (label) => view.root.findByProps({ 'aria-label': label })
  const change = async (node, value) => act(async () => { node.props.onChange({ target: { value, checked: value } }) })
  const modelRows = () => view.root.findAllByProps({ className: 's2a_modelItem' })
  const modelRow = (index) => modelRows()[index]
  const expandModel = (index) => click(modelRow(index).findByProps({ className: 's2a_iconBtn s2a_expandBtn' }))
  const presetTags = (node) => node.findAll(entry => typeof entry.props.className === 'string'
    && entry.props.className.includes('s2a_modelSource')
    && entry.children.join('').includes('内置表'))
  const textOf = (node) => {
    if (typeof node === 'string') return node
    if (node.children === undefined || node.children === null) return ''
    return node.children.map(textOf).join('')
  }
  const footerText = () => view.root
    .findAll(node => typeof node.props.className === 'string' && node.props.className.includes('s2a_modelFooter'))
    .map(textOf)
    .join('')
  const status = () => view.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('s2a_statusErr'))
  return {
    view, saved, button, field, change, click, modelRows, modelRow, expandModel, presetTags, status, footerText,
    async expandEndpoint() { await click(field('展开 Team A 端点')) },
    async discover() { await click(button(view.root, '获取模型')) },
    async fill() { await click(button(view.root, '补全数据')) },
    async save() { await click(button(view.root, '保存配置')) },
    async close() { await act(async () => view.unmount()) },
  }
}

test('discovery fills a fresh row from the built-in table and leaves unknown ids alone', async () => {
  const p = await page({ config: fixture(), discovered: [{ id: 'gpt-5.6-sol' }, { id: 'unknown-model-xyz' }] })
  try {
    await p.expandEndpoint()
    await p.discover()
    assert.equal(p.modelRows().length, 2)
    await p.expandModel(0)
    const known = p.modelRow(0)
    assert.equal(known.findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '1050000')
    assert.equal(known.findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.value, '128000')
    assert.equal(known.findByProps({ 'aria-label': 'Team A gpt-5.6-sol 思考模式' }).props.value, 'on')
    assert.equal(known.findByProps({ 'aria-label': 'Team A gpt-5.6-sol 思考强度档位' }).props.value, 'none, low, medium, high, xhigh, max')
    // Every filled field is labelled, so the value is visibly automatic.
    assert.equal(p.presetTags(known).length, 3)
    await p.expandModel(1)
    const unknown = p.modelRow(1)
    assert.equal(unknown.findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '')
    assert.equal(unknown.findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.value, '')
    assert.equal(unknown.findByProps({ 'aria-label': 'Team A unknown-model-xyz 思考模式' }).props.value, '')
    assert.equal(p.presetTags(unknown).length, 0)
  } finally { await p.close() }
})

test('a row that already carries values keeps them and shows no automatic label', async () => {
  const p = await page({
    config: fixture([{ id: 'gpt-5.6-sol', contextWindow: 777, maxTokens: 888, reasoningEfforts: ['low'] }]),
    discovered: [{ id: 'gpt-5.6-sol' }],
  })
  try {
    await p.expandEndpoint()
    // autoProbeReasoning is UI-local state that the config payload never
    // restores, so the keep-old-rows path is switched on through the checkbox.
    await p.change(p.field('Team A 自动探测档位'), true)
    await p.discover()
    assert.equal(p.modelRows().length, 1)
    await p.expandModel(0)
    const row = p.modelRow(0)
    assert.equal(row.findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '777')
    assert.equal(row.findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.value, '888')
    assert.equal(row.findByProps({ 'aria-label': 'Team A gpt-5.6-sol 思考强度档位' }).props.value, 'low')
    assert.equal(p.presetTags(row).length, 0)
  } finally { await p.close() }
})

test('editing a filled field clears only that field automatic label', async () => {
  const p = await page({ config: fixture(), discovered: [{ id: 'gpt-5.6-sol' }] })
  try {
    await p.expandEndpoint()
    await p.discover()
    await p.expandModel(0)
    assert.equal(p.presetTags(p.modelRow(0)).length, 3)
    await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }), '999')
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '999')
    assert.equal(p.presetTags(p.modelRow(0)).length, 2)
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.value, '128000')
  } finally { await p.close() }
})

test('the fill button consults the built-in table as well', async () => {
  const p = await page({ config: fixture([{ id: 'gpt-5.6-sol' }]) })
  try {
    await p.expandEndpoint()
    await p.fill()
    await p.expandModel(0)
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '1050000')
    assert.equal(p.presetTags(p.modelRow(0)).length, 3)
  } finally { await p.close() }
})

test('the default level offers exactly the levels of that row and saves with the model', async () => {
  const p = await page({ config: fixture([{ id: 'model-a', reasoningEfforts: ['low', 'high'] }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    const select = () => p.modelRow(0).findByProps({ 'aria-label': 'Team A model-a 默认思考档' })
    assert.equal(select().props.disabled, false)
    assert.deepEqual(select().findAllByType('option').map(option => option.props.value), ['', 'low', 'high'])
    await p.change(select(), 'high')
    await p.save()
    assert.equal(p.saved.length, 1)
    assert.deepEqual(p.saved[0].endpoints[0].models, [{ id: 'model-a', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' }])
  } finally { await p.close() }
})

test('a row without levels cannot pick a default level', async () => {
  const p = await page({ config: fixture([{ id: 'model-a' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    const select = p.modelRow(0).findByProps({ 'aria-label': 'Team A model-a 默认思考档' })
    assert.equal(select.props.disabled, true)
    assert.deepEqual(select.findAllByType('option').map(option => option.props.value), [''])
    await p.save()
    assert.equal(p.saved.length, 1)
    assert.deepEqual(p.saved[0].endpoints[0].models, [{ id: 'model-a' }])
  } finally { await p.close() }
})

test('a stored default the row cannot run is refused instead of silently dropped', async () => {
  const p = await page({ config: fixture([{ id: 'model-a', reasoningEfforts: ['low'], defaultReasoningEffort: 'high' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    const select = () => p.modelRow(0).findByProps({ 'aria-label': 'Team A model-a 默认思考档' })
    // The stale value stays visible (as an extra option) so the user can see
    // what the row actually carries, but saving it is refused.
    assert.deepEqual(select().findAllByType('option').map(option => option.props.value), ['', 'high', 'low'])
    assert.equal(select().props.value, 'high')
    await p.save()
    assert.equal(p.saved.length, 0)
    assert.equal(p.status().length, 1)
    assert.match(p.status()[0].children.join(''), /默认思考档必须是该模型的档位之一/)
  } finally { await p.close() }
})

test('discovery without auto-probe rebuilds the list instead of keeping old rows', async () => {
  const p = await page({ config: fixture([{ id: 'old-model', contextWindow: 123 }]), discovered: [{ id: 'new-model' }] })
  try {
    await p.expandEndpoint()
    await p.discover()
    assert.deepEqual(p.modelRows().map(row => row.findByProps({ 'aria-label': 'Team A 模型 ID' }).props.value), ['new-model'])
  } finally { await p.close() }
})

test('the page fills exactly the fields the shared table rule reports', async () => {
  // The rule itself lives in `src/model-presets.ts` (`presetFieldsToFill`), which
  // the host and this page both call; a private copy here would drift from it.
  const ids = ['glm-5.3', 'qwen3.8-max']
  const p = await page({ config: fixture(ids.map((id) => ({ id }))) })
  try {
    await p.expandEndpoint()
    await p.fill()
    for (const [index, id] of ids.entries()) {
      if (p.modelRow(index).findAllByProps({ 'aria-label': 'Team A 上下文窗口' }).length === 0) await p.expandModel(index)
      const preset = lookupModelPreset('https://a.test', id)
      assert.ok(preset, `${id} is in the table`)
      const expected = presetFieldsToFill({}, preset, ['contextWindow', 'maxTokens', 'reasoningEfforts'])
      assert.equal(
        p.presetTags(p.modelRow(index)).length,
        expected.length,
        `${id}: the page marks exactly the fields the shared rule reports`,
      )
    }
  } finally { await p.close() }
})

test('a whitespace-only capacity counts as empty for the table', async () => {
  // The discriminating case for the shared rule: it trims before deciding, so a
  // field the user blanked out is filled, while a hand-rolled `length === 0`
  // check would treat it as a value and leave it alone.
  const p = await page({ config: fixture([{ id: 'glm-5.3' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }), '   ')
    await p.fill()
    if (p.modelRow(0).findAllByProps({ 'aria-label': 'Team A 上下文窗口' }).length === 0) await p.expandModel(0)
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '256000')
  } finally { await p.close() }
})

test('an empty capacity field shows the table suggestion as its placeholder', async () => {
  // The suggestion is the only place a user can see what the table would fill
  // before committing to it; the field itself stays empty so "only empty fields
  // are filled" keeps working.
  const p = await page({ config: fixture([{ id: 'glm-5.3' }]) })
  try {
    const preset = lookupModelPreset('https://a.test', 'glm-5.3')
    assert.ok(preset, 'glm-5.3 is in the table')
    assert.ok(preset.contextWindow !== undefined && preset.maxTokens !== undefined, 'the table carries both capacities')
    await p.expandEndpoint()
    await p.expandModel(0)
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '')
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.placeholder, String(preset.contextWindow))
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.value, '')
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.placeholder, String(preset.maxTokens))
  } finally { await p.close() }
})

test('a model the table does not know gets no capacity placeholder', async () => {
  // A placeholder reading "自动填充" would promise a fill that never comes for an
  // id the table has never heard of.
  const p = await page({ config: fixture([{ id: 'unknown-model-xyz' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.placeholder, undefined)
    assert.equal(p.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.placeholder, undefined)
  } finally { await p.close() }
})

test('a hand-typed capacity is kept, and clearing it hands the field back to the table', async () => {
  const p = await page({ config: fixture([{ id: 'glm-5.3' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    const capacity = () => p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' })
    await p.fill()
    if (p.modelRow(0).findAllByProps({ 'aria-label': 'Team A 上下文窗口' }).length === 0) await p.expandModel(0)
    assert.equal(capacity().props.value, '256000')
    const filled = p.presetTags(p.modelRow(0)).length
    assert.ok(filled > 0, 'the table-filled field is labelled')
    await p.change(capacity(), '999')
    assert.equal(capacity().props.value, '999')
    assert.equal(p.presetTags(p.modelRow(0)).length, filled - 1, 'editing the field drops its automatic label')
    await p.fill()
    assert.equal(capacity().props.value, '999', 'the fill button leaves a hand-typed value alone')
    await p.change(capacity(), '')
    assert.equal(capacity().props.value, '')
    await p.fill()
    assert.equal(capacity().props.value, '256000', 'a cleared field is the table\'s to fill again')
    // `presetFields` records the fields *this* fill wrote, so the refilled field
    // is the only one labelled again.
    assert.equal(p.presetTags(p.modelRow(0)).length, 1, 'and the refilled field is labelled again')
  } finally { await p.close() }
})

test('a hand-typed capacity survives a save and comes back on the next load', async () => {
  const p = await page({ config: fixture([{ id: 'glm-5.3' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }), '999')
    await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }), '111')
    await p.save()
    assert.equal(p.saved.length, 1)
    assert.deepEqual(p.saved[0].endpoints[0].models, [{ id: 'glm-5.3', contextWindow: 999, maxTokens: 111 }])
  } finally { await p.close() }
  const reloaded = await page({ config: fixture([{ id: 'glm-5.3', contextWindow: 999, maxTokens: 111 }]) })
  try {
    await reloaded.expandEndpoint()
    await reloaded.expandModel(0)
    assert.equal(reloaded.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }).props.value, '999')
    assert.equal(reloaded.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }).props.value, '111')
  } finally { await reloaded.close() }
})

test('clearing a capacity drops it from the payload instead of storing a blank', async () => {
  const p = await page({ config: fixture([{ id: 'glm-5.3', contextWindow: 999, maxTokens: 111 }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }), '')
    await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 最大输出 token' }), '')
    await p.save()
    assert.equal(p.saved.length, 1)
    assert.deepEqual(p.saved[0].endpoints[0].models, [{ id: 'glm-5.3' }])
  } finally { await p.close() }
})

test('an invalid capacity is refused with a visible message instead of being saved', async () => {
  const p = await page({ config: fixture([{ id: 'glm-5.3' }]) })
  try {
    await p.expandEndpoint()
    await p.expandModel(0)
    for (const bad of ['0', '-5', '1.5', 'abc']) {
      await p.change(p.modelRow(0).findByProps({ 'aria-label': 'Team A 上下文窗口' }), bad)
      await p.save()
      assert.equal(p.saved.length, 0, `${bad} must not reach the server`)
      assert.equal(p.status().length, 1, `${bad} must be reported`)
      assert.match(p.status()[0].children.join(''), /Context Window 必须是正整数/)
    }
  } finally { await p.close() }
})

test('the footer describes what the page does, and when the host rewrites a hand-typed list', async () => {
  // t26 N1: the footer used to promise an immediate label for a rewrite the page
  // never performs. It must describe the page's own behaviour and name the
  // moment the host one happens instead.
  const p = await page({ config: fixture([{ id: 'glm-5.3' }]) })
  try {
    await p.expandEndpoint()
    const footer = p.footerText()
    assert.match(footer, /点「补全数据」不会改动它/, 'the page states that a hand-typed list is left alone')
    assert.match(footer, /保存后/, 'the host rewrite is described as happening on save')
    assert.doesNotMatch(footer, /改后会在该行标出/, 'the footer no longer promises a label for the host rewrite')
    assert.match(footer, /显式的空数组/, 'the third fill path is disclosed (t26 N3)')
  } finally { await p.close() }
})
