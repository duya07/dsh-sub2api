import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import {act, create} from 'react-test-renderer'

const base = '/plugins/dsh-sub2api'
const fixture = () => ({baseURL: 'https://fallback.test', catalogFormat: 'structured-v1', endpoints: [
  {name: 'Team A', baseURL: 'https://a.test', platform: 'openai', apiKeyEnv: 'OWN_A', keyConfigured: true, api: 'openai-responses', route: 'collision', models: [{id: 'model-a', reasoningEfforts: ['high']}]},
  {name: 'Team B', baseURL: 'https://b.test', platform: 'openai', apiKeyEnv: 'OWN_B', keyConfigured: true, api: 'openai-completions', route: 'collision', models: [{id: 'model-b', reasoningEfforts: ['max']}]},
]})

async function page(options = {}) {
  let plugin
  const calls = [], saved = [], timers = new Map()
  let timerId = 0
  const cfg = options.config ?? fixture()
  if (options.persistedOn) cfg.endpoints[0].autoProbeReasoning = true
  vm.runInNewContext(readFileSync(process.env.SUB2API_UI_BUNDLE ?? new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load({factory}) {plugin = factory(createRequire(import.meta.url))}}, setTimeout(callback, delay) {timers.set(++timerId, {callback, delay}); return timerId}, clearTimeout(id) {timers.delete(id)}},
    AbortController,
    fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined
      calls.push({url, body, signal: init?.signal})
      let result
      if (url === 'https://models.dev/api.json') result = options.catalog ?? {}
      else if (url === `${base}/config`) {
        if (init?.method === 'POST') {saved.push(body); result = options.save ? await options.save(body) : {ok: true, routes: ['collision']}}
        else result = cfg
      } else if (url === `${base}/discover`) result = {models: options.discovered ?? [{id: 'model-a'}, {id: 'new-model'}]}
      else if (url === `${base}/usage`) result = {summary: 'fixture usage'}
      else if (url === `${base}/reasoning/start`) result = options.start ? await options.start(body) : {id: `task-${body.model.id}`, phase: 'queued', maxRequests: 4, minGapMs: 5000, requests: 0}
      else if (url === `${base}/reasoning/cancel`) result = options.cancel ? await options.cancel(body) : {id: body.id, phase: 'cancelled', suggestion: ['high']}
      else if (url === `${base}/reasoning/status`) result = options.status ? await options.status(body) : {id: body.id, phase: 'completed', maxRequests: 4, requests: 4, levels: [{level: 'high', state: 'unsupported', reason: 'confirmed-rejection'}], suggestion: options.suggestion ?? ['low']}
      else assert.fail(`unexpected external I/O: ${url}`)
      return {ok: !result?.httpStatus, status: result?.httpStatus ?? 200, json: async () => result}
    }, btoa,
  })
  const entries = []
  plugin.apply({slots: {inject(_name, callback) {callback()}, register(options, component) {entries.push({options, component})}}})
  let view
  await act(async () => {view = create(React.createElement(entries.find(entry => entry.options.name === 'settings.section').component))})
  const rows = () => view.root.findByProps({className: 's2a_rows'}).findAllByType('li')
  const button = (root, text) => root.findAllByType('button').find(node => node.children.includes(text))
  const click = async node => {assert.ok(node, 'expected command control'); await act(async () => {await node.props.onClick()})}
  const field = label => view.root.findByProps({'aria-label': label})
  const change = async (label, value, checkbox = false) => act(async () => field(label).props.onChange({target: checkbox ? {checked: value} : {value}}))
  const expand = async (index = 0) => click(rows()[index].findByProps({className: 's2a_iconBtn s2a_endpointToggle'}))
  const details = async (index = 0) => click(rows()[index].findByProps({className: 's2a_iconBtn s2a_expandBtn'}))
  const fireTimers = async delay => act(async () => {
    const due = [...timers].filter(([, timer]) => timer.delay === delay)
    for (const [id, timer] of due) {timers.delete(id); timer.callback()}
  })
  const beginSave = async () => {
    let pending
    await act(async () => {pending = button(view.root, '保存配置').props.onClick()})
    return {pending}
  }
  return {view, calls, saved, rows, button, click, field, change, expand, details, fireTimers, beginSave, async close() {await act(async () => view.unmount())}}
}

test('opt-in is off by default; hydration and toggling it on never start provider probes', async () => {
  const p = await page({persistedOn: true})
  try {
    assert.equal(p.calls.filter(call => call.url.includes('/reasoning/')).length, 0)
    await p.expand(1)
    assert.equal(p.field('Team B 自动探测档位').props.checked, false)
    await p.change('Team B 自动探测档位', true, true)
    assert.equal(p.calls.filter(call => call.url.includes('/reasoning/')).length, 0)
  } finally {await p.close()}
})

test('explicit single-model probe works with auto off and never starts another model or endpoint', async () => {
  const p = await page()
  try {
    await p.expand(); await p.details()
    await p.click(p.view.root.findByProps({'aria-label': 'Team A model-a 探测档位'}))
    const starts = p.calls.filter(call => call.url.endsWith('/reasoning/start'))
    assert.equal(starts.length, 1)
    assert.equal(starts[0].body.model.id, 'model-a')
    assert.equal(starts[0].body.endpoint.apiKeyEnv, 'OWN_A')
    assert.equal(p.field('Team A 自动探测档位').props.checked, false)
    assert.equal(p.field('Team A model-a 思考强度档位').props.value, 'high')
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 1)
  } finally {await p.close()}
})

test('saved/manual levels stay unchanged until explicit Apply and bind the endpoint own draft, not the route collision', async () => {
  const p = await page()
  try {
    await p.expand()
    await p.details()
    await p.change('Team A 自动探测档位', true, true)
    await p.change('Team A API Key', 'fake-draft-key')
    await p.click(p.button(p.rows()[0], '补全数据'))
    const start = p.calls.find(call => call.url.endsWith('/reasoning/start'))
    assert.equal(start.body.endpoint.baseURL, 'https://a.test')
    assert.equal(start.body.endpoint.apiKey, 'fake-draft-key')
    assert.equal(start.body.endpoint.apiKeyEnv, 'OWN_A')
    assert.equal(start.body.endpoint.api, 'openai-responses')
    assert.equal(start.body.model.id, 'model-a')
    assert.equal(p.field('Team A model-a 思考强度档位').props.value, 'high')
    await p.click(p.view.root.findByProps({'aria-label': 'Team A model-a 应用探测建议'}))
    assert.equal(p.field('Team A model-a 思考强度档位').props.value, 'low')
    await p.click(p.button(p.view.root, '保存配置'))
    assert.deepEqual(p.saved[0].endpoints[0].models[0].reasoningEfforts, ['low'])
  } finally {await p.close()}
})

test('manual changes during a pending start cancel the task on acknowledgement and discard late results', async () => {
  let release
  const started = new Promise(resolve => {release = resolve})
  const p = await page({start: () => started})
  try {
    await p.expand(); await p.details()
    await p.change('Team A 自动探测档位', true, true)
    await p.click(p.button(p.rows()[0], '补全数据'))
    await p.change('Team A model-a 思考强度档位', 'max')
    await act(async () => {release({id: 'late-task', phase: 'queued', maxRequests: 4, minGapMs: 5000, requests: 0})})
    assert.equal(p.field('Team A model-a 思考强度档位').props.value, 'max')
    assert.ok(p.calls.some(call => call.url.endsWith('/reasoning/cancel') && call.body.id === 'late-task'))
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 0)
    assert.equal(p.calls.some(call => call.url.endsWith('/reasoning/status')), false)
  } finally {await p.close()}
})

test('endpoint URL/key/protocol and model snapshot edits abort live status reads and reject late Apply', async () => {
  for (const [label, value] of [['Team A 网关地址', 'https://changed.test'], ['Team A API Key', 'fake-new-key'], ['Team A 网关协议', 'openai-completions'], ['Team A 模型 ID', 'changed-model'], ['Team A 上下文窗口', '64000'], ['Team A 最大输出 token', '8192'], ['Team A model-a 思考强度档位', 'max']]) {
    let release
    const held = new Promise(resolve => {release = resolve})
    const p = await page({status: () => held})
    try {
      await p.expand(); await p.details()
      await p.click(p.view.root.findByProps({'aria-label': 'Team A model-a 探测档位'}))
      const status = p.calls.find(call => call.url.endsWith('/reasoning/status'))
      assert.ok(status)
      await p.change(label, value)
      assert.equal(status.signal.aborted, true)
      assert.ok(p.calls.some(call => call.url.endsWith('/reasoning/cancel')))
      await act(async () => {release({id: 'task-model-a', phase: 'completed', levels: [], suggestion: ['low']})})
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 0)
    } finally {await p.close()}
  }
})

test('explicit cancel during status polling keeps existing fields and blocks a late success', async () => {
  let release
  const held = new Promise(resolve => {release = resolve})
  const p = await page({status: () => held})
  try {
    await p.expand(); await p.details()
    await p.click(p.view.root.findByProps({'aria-label': 'Team A model-a 探测档位'}))
    await p.click(p.view.root.findByProps({'aria-label': 'Team A model-a 取消探测'}))
    await act(async () => {release({id: 'task-model-a', phase: 'completed', levels: [], suggestion: ['low']})})
    assert.equal(p.field('Team A model-a 思考强度档位').props.value, 'high')
    assert.equal(p.calls.find(call => call.url.endsWith('/reasoning/status')).signal.aborted, true)
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 0)
  } finally {await p.close()}
})

test('dispose cancels a pending acknowledgement without polling or applying it', async () => {
  let release
  const started = new Promise(resolve => {release = resolve})
  const p = await page({start: () => started})
  await p.expand(); await p.change('Team A 自动探测档位', true, true)
  await p.click(p.button(p.rows()[0], '补全数据'))
  await p.close()
  await act(async () => {release({id: 'disposed-task', phase: 'queued'})})
  assert.ok(p.calls.some(call => call.url.endsWith('/reasoning/cancel') && call.body.id === 'disposed-task'))
  assert.equal(p.calls.some(call => call.url.endsWith('/reasoning/status')), false)
})

test('discovery keeps same-id saved/manual capabilities and only auto-applies nonempty suggestions to new rows', async () => {
  const p = await page({suggestion: ['low', 'medium']})
  try {
    await p.expand(); await p.change('Team A 自动探测档位', true, true)
    await p.click(p.button(p.rows()[0], '获取模型'))
    await p.click(p.button(p.view.root, '保存配置'))
    const models = p.saved[0].endpoints[0].models
    assert.deepEqual(models.find(model => model.id === 'model-a').reasoningEfforts, ['high'])
    assert.deepEqual(models.find(model => model.id === 'new-model').reasoningEfforts, ['low', 'medium'])
    assert.equal(p.calls.filter(call => call.url.endsWith('/reasoning/start')).length, 2)
  } finally {await p.close()}
})

test('an empty suggestion never switches any model to non-reasoning', async () => {
  const p = await page({suggestion: []})
  try {
    await p.expand(); await p.change('Team A 自动探测档位', true, true)
    await p.click(p.button(p.rows()[0], '获取模型'))
    await p.click(p.button(p.view.root, '保存配置'))
    const models = p.saved[0].endpoints[0].models
    assert.deepEqual(models.find(model => model.id === 'model-a').reasoningEfforts, ['high'])
    assert.notDeepEqual(models.find(model => model.id === 'new-model').reasoningEfforts, [])
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 0)
  } finally {await p.close()}
})

test('off-only and none-only suggestions do not replace saved/manual or generated thinking capabilities', async () => {
  for (const suggestion of [['none'], ['off'], ['off', 'none']]) {
    const p = await page({suggestion})
    try {
      await p.expand(); await p.change('Team A 自动探测档位', true, true)
      await p.click(p.button(p.rows()[0], '获取模型'))
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 0)
      await p.click(p.button(p.view.root, '保存配置'))
      assert.equal(p.saved.length, 1)
      const models = p.saved[0].endpoints[0].models
      assert.deepEqual(models.find(model => model.id === 'model-a').reasoningEfforts, ['high'])
      assert.equal(models.find(model => model.id === 'new-model').reasoningEfforts, undefined)
    } finally {await p.close()}
  }
})

const bulkFixture = () => {
  const config = fixture()
  config.endpoints[0].models = Array.from({length: 9}, (_, index) => ({id: `bulk-${index + 1}`, reasoningEfforts: ['high']}))
  return config
}
const starts = p => p.calls.filter(call => call.url.endsWith('/reasoning/start'))
const receipt = id => ({id: `task-${id}`, phase: 'queued', requests: 0, maxRequests: 4, minGapMs: 5000})
const complete = id => ({id, phase: 'completed', requests: 4, maxRequests: 4, levels: [{level: 'high', state: 'accepted', reason: 'accepted-parameter'}], suggestion: ['high']})

for (const action of ['获取模型', '补全数据']) {
  test(`nine-model ${action} covers the ninth row with a cancellable pending state and starts it after a slot is released`, async () => {
    const config = bulkFixture(), acknowledgements = new Map()
    const p = await page({config, discovered: config.endpoints[0].models.map(({id}) => ({id})), start: body => new Promise(resolve => acknowledgements.set(body.model.id, resolve))})
    try {
      await p.expand(); await p.change('Team A 自动探测档位', true, true)
      await p.click(p.button(p.rows()[0], action))
      assert.equal(starts(p).length, 8, 'only eight start acknowledgements may be outstanding')
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 取消探测'}).length, 1, 'ninth row is visible and cancellable while waiting')
      assert.equal(starts(p).some(call => call.body.model.id === 'bulk-9'), false)
      await act(async () => acknowledgements.get('bulk-1')(receipt('bulk-1')))
      assert.equal(starts(p).length, 9)
      assert.equal(starts(p)[8].body.model.id, 'bulk-9')
      assert.equal(starts(p)[8].body.endpoint.apiKeyEnv, 'OWN_A')
      await act(async () => {for (const [id, release] of acknowledgements) release(receipt(id))})
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 应用探测建议'}).length, 1)
      assert.equal(new Set(starts(p).map(call => call.body.model.id)).size, 9)
    } finally {await p.close()}
  })
}

test('cancelling a locally queued ninth model never submits it after earlier tasks finish', async () => {
  const config = bulkFixture(), pending = new Map()
  const p = await page({config, status: body => new Promise(resolve => pending.set(body.id, resolve))})
  try {
    await p.expand(); await p.change('Team A 自动探测档位', true, true)
    await p.click(p.button(p.rows()[0], '补全数据'))
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 取消探测'}).length, 1)
    await p.click(p.field('Team A bulk-9 取消探测'))
    await act(async () => {for (const [id, release] of pending) release(complete(id))})
    assert.equal(starts(p).length, 8)
    assert.equal(starts(p).some(call => call.body.model.id === 'bulk-9'), false)
    assert.equal(p.calls.some(call => call.url.endsWith('/reasoning/cancel') && call.body.id === 'task-bulk-9'), false)
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 应用探测建议'}).length, 0)
  } finally {await p.close()}
})

test('endpoint edits and disposal clear queued models and cannot revive them from late acknowledgements', async () => {
  for (const dispose of [false, true]) {
    const config = bulkFixture(), acknowledgements = new Map()
    const p = await page({config, start: body => new Promise(resolve => acknowledgements.set(body.model.id, resolve))})
    let closed = false
    try {
      await p.expand(); await p.change('Team A 自动探测档位', true, true)
      await p.click(p.button(p.rows()[0], '补全数据'))
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 取消探测'}).length, 1)
      if (dispose) {await p.close(); closed = true}
      else await p.change('Team A 网关地址', 'https://edited.test')
      await act(async () => {for (const [id, release] of acknowledgements) release(receipt(id))})
      assert.equal(starts(p).length, 8)
      assert.equal(p.calls.filter(call => call.url.endsWith('/reasoning/cancel')).length, 8)
      assert.equal(p.calls.some(call => call.url.endsWith('/reasoning/status')), false)
    } finally {if (!closed) await p.close()}
  }
})

test('the eight submitted slots include held acknowledgements and are shared across endpoints', async () => {
  const config = bulkFixture(), acknowledgements = new Map()
  const p = await page({config, start: body => new Promise(resolve => acknowledgements.set(body.model.id, resolve))})
  try {
    await p.expand(); await p.change('Team A 自动探测档位', true, true)
    await p.click(p.button(p.rows()[0], '补全数据'))
    await p.expand(1)
    await p.click(p.field('Team B model-b 探测档位'))
    assert.equal(starts(p).length, 8, 'another endpoint cannot exceed the pending-ACK slot limit')
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team B model-b 取消探测'}).length, 1)
    await act(async () => acknowledgements.get('bulk-1')(receipt('bulk-1')))
    assert.equal(starts(p).length, 9)
    assert.equal(starts(p)[8].body.model.id, 'bulk-9')
    await act(async () => acknowledgements.get('bulk-2')(receipt('bulk-2')))
    assert.equal(starts(p).length, 10)
    const other = starts(p)[9].body
    assert.equal(other.model.id, 'model-b')
    assert.equal(other.endpoint.baseURL, 'https://b.test')
    assert.equal(other.endpoint.apiKeyEnv, 'OWN_B')
    assert.equal(other.endpoint.api, 'openai-completions')
  } finally {await p.close()}
})

for (const phase of ['start', 'status']) {
  test(`a cancelled ${phase} slot is held until the late start and server cancellation are acknowledged`, async () => {
    const config = bulkFixture(), acknowledgements = new Map(), cancellations = new Map(), statuses = new Map()
    const p = await page({config,
      start: phase === 'start' ? body => new Promise(resolve => acknowledgements.set(body.model.id, resolve)) : undefined,
      status: body => new Promise(resolve => statuses.set(body.id, resolve)),
      cancel: body => new Promise(resolve => cancellations.set(body.id, resolve)),
    })
    try {
      await p.expand(); await p.change('Team A 自动探测档位', true, true)
      await p.click(p.button(p.rows()[0], '补全数据'))
      await p.click(p.field('Team A bulk-1 取消探测'))
      assert.equal(starts(p).length, 8, 'cancellation intent alone cannot release a submitted slot')
      if (phase === 'start') await act(async () => acknowledgements.get('bulk-1')(receipt('bulk-1')))
      assert.ok(cancellations.has('task-bulk-1'))
      assert.equal(starts(p).length, 8, 'a start ACK without a cancel ACK still occupies its slot')
      await act(async () => cancellations.get('task-bulk-1')({id: 'task-bulk-1', phase: 'cancelled'}))
      assert.equal(starts(p).length, 9)
      assert.equal(starts(p)[8].body.model.id, 'bulk-9')
      if (statuses.has('task-bulk-1')) await act(async () => statuses.get('task-bulk-1')(complete('task-bulk-1')))
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-1 应用探测建议'}).length, 0)
    } finally {
      await p.close()
      await act(async () => {for (const [id, release] of acknowledgements) release(receipt(id)); for (const [id, release] of statuses) release(complete(id))})
      await act(async () => {for (const [id, release] of cancellations) release({id, phase: 'cancelled'})})
    }
  })
}

test('locally queued rows expire within the existing ten-minute task bound and never start late', async () => {
  const config = bulkFixture(), acknowledgements = new Map()
  const p = await page({config, start: body => new Promise(resolve => acknowledgements.set(body.model.id, resolve))})
  try {
    await p.expand(); await p.change('Team A 自动探测档位', true, true)
    await p.click(p.button(p.rows()[0], '补全数据'))
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 取消探测'}).length, 1)
    await p.fireTimers(600000)
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A bulk-9 取消探测'}).length, 0)
    await act(async () => {for (const [id, release] of acknowledgements) release(receipt(id))})
    assert.equal(starts(p).length, 8)
    assert.equal(p.calls.some(call => call.url.endsWith('/reasoning/status')), false)
  } finally {await p.close()}
})

test('server capacity refusals keep a cancellable queue and retry admission only after a bounded wait', async () => {
  let attempts = 0
  const p = await page({start: body => ++attempts === 1 ? {httpStatus: 429, error: 'probe task limit'} : receipt(body.model.id)})
  try {
    await p.expand()
    await p.click(p.field('Team A model-a 探测档位'))
    assert.equal(attempts, 1, 'capacity refusal must not cause an immediate retry')
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 取消探测'}).length, 1)
    await p.fireTimers(1000)
    assert.equal(attempts, 2)
    assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 应用探测建议'}).length, 1)
  } finally {await p.close()}
})

test('capacity waiting is cancellable and has a finite admission request budget', async () => {
  for (const cancel of [false, true]) {
    let attempts = 0
    const p = await page({start: () => {attempts++; return {httpStatus: 429, error: 'probe task limit'}}})
    try {
      await p.expand(); await p.click(p.field('Team A model-a 探测档位'))
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 取消探测'}).length, 1)
      if (cancel) await p.click(p.field('Team A model-a 取消探测'))
      for (let wave = 0; wave < 15; wave++) for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) await p.fireTimers(delay)
      assert.equal(attempts, cancel ? 1 : 12)
      assert.equal(p.view.root.findAllByProps({'aria-label': 'Team A model-a 取消探测'}).length, 0)
      assert.equal(p.calls.some(call => call.url.endsWith('/reasoning/status')), false)
    } finally {await p.close()}
  }
})

const saveAck = body => ({ok: true, routes: ['sub2api-ack'], endpoints: body.endpoints.map((endpoint, index) => ({...endpoint, apiKeyEnv: `ACK_${index}`, route: `sub2api-ack-${index}`, keyConfigured: true}))})

test('save ACK adopts each submitted row credential reference and route, clears only the saved key and preserves models', async () => {
  const config = fixture()
  Object.assign(config.endpoints[0], {apiKeyEnv: '', route: '', keyConfigured: false})
  const p = await page({config, save: body => ({...saveAck(body), endpoints: saveAck(body).endpoints.map(endpoint => ({...endpoint, models: [{id: 'server-overwrite'}]}))})})
  try {
    await p.expand(); await p.details()
    await p.change('Team A API Key', 'fake-first-key')
    await p.click(p.button(p.view.root, '保存配置'))
    assert.equal(p.field('Team A API Key').props.value, '')
    assert.match(p.field('Team A API Key').props.placeholder, /已配置/)
    assert.deepEqual(p.rows().map(row => row.findByProps({className: 's2a_rowTag'}).children[0]), ['sub2api-ack-0', 'sub2api-ack-1'])
    assert.ok(p.field('生图模型').findAllByType('option').some(node => node.props.value === 'sub2api-ack-0:model-a'))
    assert.equal(p.field('Team A 模型 ID').props.value, 'model-a')
    assert.equal(p.field('Team A model-a 思考强度档位').props.value, 'high')
    await p.click(p.button(p.rows()[0], '查看用量'))
    await p.click(p.field('Team A model-a 探测档位'))
    const ownRequests = p.calls.filter(call => call.url.endsWith('/usage') || call.url.endsWith('/reasoning/start'))
    for (const call of ownRequests) {const endpoint = call.body.endpoint ?? call.body; assert.equal(endpoint.apiKeyEnv, 'ACK_0'); assert.equal(endpoint.apiKey, '')}
    await p.click(p.button(p.view.root, '保存配置'))
    assert.equal(p.saved[1].endpoints[0].apiKeyEnv, 'ACK_0')
    assert.equal(p.saved[1].endpoints[0].apiKey, '')
  } finally {await p.close()}
})

test('pending save ACK preserves newer key and endpoint/model edits while retaining submitted credential ownership', async () => {
  let release
  const held = new Promise(resolve => {release = resolve})
  const p = await page({save: body => p.saved.length === 1 ? held : {ok: true}})
  try {
    await p.expand(); await p.details(); await p.change('Team A API Key', 'fake-submitted-key')
    const {pending} = await p.beginSave()
    assert.equal(p.saved[0].endpoints[0].apiKey, 'fake-submitted-key')
    await p.change('Team A API Key', 'fake-newer-key')
    await p.change('Team A 网关地址', 'https://edited.test')
    await p.change('Team A 网关协议', 'openai-completions')
    await p.change('Team A 上下文窗口', '64000')
    await p.change('Team A model-a 思考强度档位', 'max')
    await p.change('Team A 名称', 'Renamed')
    await act(async () => {release(saveAck(p.saved[0])); await pending})
    assert.equal(p.field('Renamed API Key').props.value, 'fake-newer-key')
    assert.equal(p.field('Renamed 网关地址').props.value, 'https://edited.test')
    assert.equal(p.field('Renamed 网关协议').props.value, 'openai-completions')
    assert.equal(p.field('Renamed 上下文窗口').props.value, '64000')
    assert.equal(p.field('Renamed model-a 思考强度档位').props.value, 'max')
    await p.click(p.button(p.view.root, '保存配置'))
    assert.equal(p.saved[1].endpoints[0].apiKeyEnv, 'ACK_0')
    assert.equal(p.saved[1].endpoints[0].apiKey, 'fake-newer-key')
    assert.equal(p.saved[1].endpoints[0].name, 'Renamed')
    assert.deepEqual(p.saved[1].endpoints[0].models[0].reasoningEfforts, ['max'])
  } finally {await p.close()}
})

test('pending save ACK follows submitted row ids after removal and insertion, never the current index or duplicate name', async () => {
  let release
  const held = new Promise(resolve => {release = resolve})
  const p = await page({save: () => held})
  try {
    await p.expand(); await p.expand(1)
    const remove = p.button(p.rows()[0], '删除端点'), add = p.button(p.view.root, '添加端点')
    const {pending} = await p.beginSave()
    // Retained live callbacks cover row replacement while the POST is outstanding.
    await p.click(remove); await p.click(add)
    await p.change('OpenAI 名称', 'Team A')
    await p.change('Team A API Key', 'fake-replacement-key')
    await act(async () => {release(saveAck(p.saved[0])); await pending})
    assert.equal(p.rows().length, 2)
    assert.deepEqual(p.rows().map(row => row.findByProps({className: 's2a_rowTag'}).children[0]), ['sub2api-ack-1', '未保存'])
    assert.equal(p.field('Team A API Key').props.value, 'fake-replacement-key')
    await p.click(p.button(p.rows()[0], '查看用量'))
    const usage = p.calls.find(call => call.url.endsWith('/usage'))
    assert.equal(usage.body.apiKeyEnv, 'ACK_1')
    await p.click(p.button(p.view.root, '保存配置'))
    assert.equal(p.saved[1].endpoints[0].apiKeyEnv, 'ACK_1')
    assert.equal(p.saved[1].endpoints[1].apiKeyEnv, undefined)
    assert.equal(p.saved[1].endpoints[1].apiKey, 'fake-replacement-key')
  } finally {await p.close()}
})

test('save ACK requires an object with same-order same-length valid endpoint metadata; omitted legacy endpoints remain compatible', async () => {
  const invalid = [
    () => null, () => 'invalid', () => [],
    body => ({...saveAck(body), endpoints: null}),
    body => ({...saveAck(body), endpoints: {0: saveAck(body).endpoints[0]}}),
    body => ({...saveAck(body), endpoints: saveAck(body).endpoints.slice(1)}),
    body => ({...saveAck(body), endpoints: saveAck(body).endpoints.reverse()}),
    body => ({...saveAck(body), endpoints: [saveAck(body).endpoints[0], null]}),
    ...['apiKeyEnv', 'route', 'keyConfigured'].map(field => body => {
      const ack = saveAck(body); ack.endpoints[1][field] = field === 'keyConfigured' ? 'true' : 123; return ack
    }),
    () => ({ok: true, routes: ['legacy-route']}),
  ]
  for (const response of invalid) {
    const p = await page({save: response})
    try {
      await p.expand(); await p.change('Team A API Key', 'fake-unconfirmed-key')
      await p.click(p.button(p.view.root, '保存配置'))
      assert.equal(p.field('Team A API Key').props.value, 'fake-unconfirmed-key')
      assert.deepEqual(p.rows().map(row => row.findByProps({className: 's2a_rowTag'}).children[0]), ['collision', 'collision'])
      await p.click(p.button(p.rows()[0], '查看用量'))
      assert.equal(p.calls.find(call => call.url.endsWith('/usage')).body.apiKeyEnv, 'OWN_A')
      if (response === invalid.at(-1)) assert.ok(p.view.root.findAllByProps({className: 's2a_status s2a_statusOk'}).length === 1)
    } finally {await p.close()}
  }
  const config = fixture()
  config.endpoints[0].baseURL = ' https://a.test/v1/// '
  const p = await page({config, save: body => ({...saveAck(body), endpoints: saveAck(body).endpoints.map(endpoint => ({...endpoint, baseURL: endpoint.baseURL.replace(/\/+$/, ''), apiKeyEnv: '', route: '', keyConfigured: false}))})})
  try {
    await p.expand(); await p.click(p.button(p.view.root, '保存配置'))
    assert.equal(p.rows()[0].findByProps({className: 's2a_rowTag'}).children[0], '未保存')
    assert.doesNotMatch(p.field('Team A API Key').props.placeholder, /已配置/)
    assert.equal(p.field('Team A 网关地址').props.value, ' https://a.test/v1/// ')
  } finally {await p.close()}
})

test('save failure and disposed save ACK leave credential ownership untouched; a mounted successful retry applies it', async () => {
  for (const failure of [body => ({...saveAck(body), httpStatus: 500, error: 'fixture save failed'}), body => ({...saveAck(body), ok: false, error: 'fixture rejected save'})]) {
    let retry = false
    const p = await page({save: body => retry ? saveAck(body) : failure(body)})
    try {
      await p.expand(); await p.change('Team A API Key', 'fake-retry-key')
      await p.click(p.button(p.view.root, '保存配置'))
      assert.equal(p.field('Team A API Key').props.value, 'fake-retry-key')
      assert.equal(p.rows()[0].findByProps({className: 's2a_rowTag'}).children[0], 'collision')
      assert.equal(p.view.root.findAllByProps({className: 's2a_status s2a_statusErr'}).length, 1)
      retry = true
      await p.click(p.button(p.view.root, '保存配置'))
      assert.equal(p.field('Team A API Key').props.value, '')
      assert.equal(p.rows()[0].findByProps({className: 's2a_rowTag'}).children[0], 'sub2api-ack-0')
    } finally {await p.close()}
  }
  let release
  const held = new Promise(resolve => {release = resolve})
  const p = await page({save: () => held})
  await p.expand(); await p.change('Team A API Key', 'fake-disposed-key')
  const discover = p.button(p.rows()[0], '获取模型').props.onClick
  const {pending} = await p.beginSave()
  await p.close()
  await act(async () => {release(saveAck(p.saved[0])); await pending})
  // The detached command closure witnesses endpoint refs without mocking hooks.
  await act(async () => {await discover()})
  const request = p.calls.find(call => call.url.endsWith('/discover'))
  assert.equal(request.body.apiKeyEnv, 'OWN_A')
  assert.equal(request.body.apiKey, 'fake-disposed-key')
})

for (const state of ['unknown', 'accepted']) {
  test(`fresh official reasoning false stays off for ${state} manual results and requires explicit Apply`, async () => {
    for (const apply of [false, true]) {
      const model = 'catalog-off-model', levels = ['low', 'medium', 'high']
      const p = await page({discovered: [{id: model}], catalog: {openai: {models: {[model]: {id: model, reasoning: false, limit: {context: 64000, output: 4096}}}}}, status: body => ({id: body.id, phase: 'completed', requests: 4, maxRequests: 10, levels: levels.map(level => ({level, state, reason: state === 'unknown' ? 'no-control' : 'accepted-parameter'})), suggestion: levels})})
      try {
        await p.expand(); await p.click(p.button(p.rows()[0], '获取模型')); await p.details()
        assert.equal(p.field(`Team A ${model} 思考模式`).props.value, 'off')
        assert.equal(starts(p).length, 0)
        await p.click(p.field(`Team A ${model} 探测档位`))
        assert.equal(p.field(`Team A ${model} 思考模式`).props.value, 'off', 'manual results do not implicitly enable an official non-reasoning model')
        assert.equal(p.view.root.findAllByProps({'aria-label': `Team A ${model} 应用探测建议`}).length, 1)
        assert.deepEqual(starts(p)[0].body.candidates, ['low', 'medium', 'high'])
        if (apply) await p.click(p.field(`Team A ${model} 应用探测建议`))
        await p.click(p.button(p.view.root, '保存配置'))
        assert.deepEqual(p.saved[0].endpoints[0].models[0].reasoningEfforts, apply ? ['low', 'medium', 'high'] : [])
      } finally {await p.close()}
    }
  })
}
