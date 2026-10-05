import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'

const fixture = (tools) => ({
  baseURL: 'https://gateway.test',
  catalogFormat: 'structured-v1',
  endpoints: [
    {name: 'Team A', platform: 'openai', baseURL: 'https://a.test', apiKeyEnv: 'KEY_A', keyConfigured: true, api: '', route: 'sub2api-openai-team-a', models: [{id: 'model-a'}]},
    {name: 'Team B', platform: 'claude', baseURL: 'https://b.test', apiKeyEnv: 'KEY_B', keyConfigured: true, api: '', route: 'sub2api-claude-team-b', models: [{id: 'model-b'}]},
  ],
  ...(tools === undefined ? {} : {tools}),
})

async function settingsView(config) {
  let plugin
  const saved = []
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load({factory}) {plugin = factory(createRequire(import.meta.url))}}, setTimeout, clearTimeout},
    fetch: async (url, init) => ({ok: true, json: async () => {
      if (url === 'https://models.dev/api.json') return {}
      assert.equal(url, '/plugins/dsh-sub2api/config')
      if (init?.method === 'POST') {
        saved.push(JSON.parse(init.body))
        return {ok: true, routes: []}
      }
      return config
    }}),
    btoa,
  })
  const entries = []
  plugin.apply({slots: {inject(_name, callback) {callback()}, register(options, component) {entries.push({options, component})}}})
  let view
  await act(async () => {view = create(React.createElement(entries.find(entry => entry.options.name === 'settings.section').component))})
  const button = (root, text) => root.findAllByType('button').find(node => node.children.includes(text))
  return {
    view,
    saved,
    toggle: () => view.root.findByProps({'aria-label': '启用联网搜索'}),
    picker: () => view.root.findByProps({'aria-label': '搜索模型'}),
    async change(node, value) { await act(async () => { node.props.onChange({target: {value, checked: value}}) }) },
    async save() { await act(async () => { await button(view.root, '保存配置').props.onClick() }) },
    async close() { await act(async () => view.unmount()) },
  }
}

test('a saved search route renders enabled with its endpoint model selected', async () => {
  const page = await settingsView(fixture({webSearch: {enabled: true, provider: 'sub2api-openai-team-a', model: 'model-a'}}))
  try {
    assert.equal(page.toggle().props.checked, true)
    assert.equal(page.picker().props.value, 'sub2api-openai-team-a:model-a')
    assert.equal(page.picker().props.disabled, false)
  } finally {await page.close()}
})

test('the section ships off and the picker stays disabled until it is switched on', async () => {
  const page = await settingsView(fixture(undefined))
  try {
    assert.equal(page.toggle().props.checked, false)
    assert.equal(page.picker().props.disabled, true)
    assert.equal(page.picker().props.value, '')
  } finally {await page.close()}
})

test('enabling and saving round-trips the search section without inventing an image route', async () => {
  const page = await settingsView(fixture(undefined))
  try {
    await page.change(page.toggle(), true)
    assert.equal(page.picker().props.disabled, false)
    await page.change(page.picker(), 'sub2api-claude-team-b:model-b')
    await page.save()
    assert.deepEqual(page.saved[0].tools, {webSearch: {enabled: true, provider: 'sub2api-claude-team-b', model: 'model-b'}})
    assert.equal('generate' in page.saved[0].tools, false)
  } finally {await page.close()}
})

test('turning the switch back off drops the section from the payload', async () => {
  const page = await settingsView(fixture({webSearch: {enabled: true, provider: 'sub2api-openai-team-a', model: 'model-a'}}))
  try {
    await page.change(page.toggle(), false)
    assert.equal(page.picker().props.disabled, true)
    await page.save()
    assert.equal('webSearch' in page.saved[0].tools, false)
  } finally {await page.close()}
})

test('enabling without a model refuses to save instead of storing a half-filled route', async () => {
  const page = await settingsView(fixture(undefined))
  try {
    await page.change(page.toggle(), true)
    await page.save()
    assert.deepEqual(page.saved, [])
    const status = page.view.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('s2a_statusErr'))
    assert.equal(status.length, 1)
    assert.match(status[0].children.join(''), /联网搜索/)
  } finally {await page.close()}
})

test('a saved route that is no longer in the catalog stays visible and re-saves unchanged', async () => {
  const page = await settingsView(fixture({webSearch: {enabled: true, provider: 'sub2api-openai-gone', model: 'model-x'}}))
  try {
    assert.equal(page.picker().props.value, 'sub2api-openai-gone:model-x')
    await page.save()
    assert.deepEqual(page.saved[0].tools.webSearch, {enabled: true, provider: 'sub2api-openai-gone', model: 'model-x'})
  } finally {await page.close()}
})
