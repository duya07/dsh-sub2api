import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'

const fixture = {
  baseURL: 'https://gateway.test',
  catalogFormat: 'structured-v1',
  endpoints: [
    {name: 'Team A', platform: 'openai', baseURL: 'https://a.test', apiKeyEnv: 'KEY_A', keyConfigured: true, api: '', route: 'sub2api-openai-team-a', models: [{id: 'model-a', input: ['text'], reasoningEfforts: ['high']}]},
    {name: 'Team B', platform: 'claude', baseURL: 'https://b.test', apiKeyEnv: 'KEY_B', keyConfigured: true, api: '', route: 'sub2api-claude-team-b', models: [{id: 'model-b'}]},
  ],
}

async function settingsView() {
  let plugin
  const saved = []
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load({factory}) {plugin = factory(createRequire(import.meta.url))}}, setTimeout, clearTimeout},
    fetch: async (url, init) => ({ok: true, json: async () => {
      if (url === 'https://models.dev/api.json') return {}
      assert.equal(url, '/plugins/dsh-sub2api/config')
      if (init?.method === 'POST') {
        saved.push(JSON.parse(init.body))
        return {ok: true, routes: fixture.endpoints.map(endpoint => endpoint.route)}
      }
      return fixture
    }}),
    btoa,
  })
  const entries = []
  plugin.apply({slots: {inject(_name, callback) {callback()}, register(options, component) {entries.push({options, component})}}})
  let view
  await act(async () => {view = create(React.createElement(entries.find(entry => entry.options.name === 'settings.section').component))})
  const rows = () => view.root.findByProps({className: 's2a_rows'}).findAllByType('li')
  const toggle = row => row.findByProps({className: 's2a_iconBtn s2a_endpointToggle'})
  const button = (root, text) => root.findAllByType('button').find(node => node.children.includes(text))
  const click = async node => act(async () => {await node.props.onClick()})
  return {view, saved, rows, toggle, button, click, async close() {await act(async () => view.unmount())}}
}

test('saved endpoints start compact and expand independently', async () => {
  const page = await settingsView()
  try {
    assert.equal(page.view.root.findAllByProps({className: 's2a_iconBtn s2a_endpointToggle'}).length, 2)
    assert.equal(page.rows().flatMap(row => row.findAllByType('input')).length, 0)
    for (const row of page.rows()) {
      assert.equal(page.toggle(row).props['aria-expanded'], false)
      assert.equal(row.findAllByProps({className: 's2a_rowTag'}).length, 1)
      for (const label of ['获取模型', '查看用量', '删除端点']) assert.ok(page.button(row, label))
    }
    await page.click(page.toggle(page.rows()[0]))
    assert.equal(page.toggle(page.rows()[0]).props['aria-expanded'], true)
    const detailsId = page.toggle(page.rows()[0]).props['aria-controls']
    assert.ok(page.rows()[0].findByProps({id: detailsId}).findAllByType('input').length > 0)
    assert.equal(page.rows()[1].findAllByType('input').length, 0)
    await page.click(page.toggle(page.rows()[1]))
    await page.click(page.toggle(page.rows()[0]))
    assert.equal(page.rows()[0].findAllByType('input').length, 0)
    assert.ok(page.rows()[1].findAllByType('input').length > 0)
  } finally {await page.close()}
})

test('collapse preserves unsaved fields and model details without changing the save contract', async () => {
  const page = await settingsView()
  try {
    assert.equal(page.view.root.findAllByProps({className: 's2a_iconBtn s2a_endpointToggle'}).length, 2)
    await page.click(page.toggle(page.rows()[0]))
    await act(async () => {
      page.view.root.findByProps({'aria-label': 'Team A 网关地址'}).props.onChange({target: {value: 'https://edited.test/v1'}})
      page.view.root.findByProps({'aria-label': 'Team A API Key'}).props.onChange({target: {value: 'fake-new-key'}})
    })
    await page.click(page.rows()[0].findByProps({className: 's2a_iconBtn s2a_expandBtn'}))
    await act(async () => {
      page.view.root.findByProps({'aria-label': 'Team A 上下文窗口'}).props.onChange({target: {value: '8192'}})
      page.view.root.findByProps({'aria-label': 'Team A model-a 图片输入'}).props.onChange({target: {value: 'text-image'}})
    })
    await page.click(page.toggle(page.rows()[0]))
    assert.equal(page.rows()[0].findAllByType('input').length, 0)
    await page.click(page.toggle(page.rows()[0]))
    assert.equal(page.view.root.findByProps({'aria-label': 'Team A 网关地址'}).props.value, 'https://edited.test/v1')
    assert.equal(page.view.root.findByProps({'aria-label': 'Team A API Key'}).props.value, 'fake-new-key')
    assert.equal(page.view.root.findByProps({'aria-label': 'Team A 上下文窗口'}).props.value, '8192')
    assert.equal(page.rows()[0].findByProps({className: 's2a_iconBtn s2a_expandBtn'}).props['aria-expanded'], true)
    await page.click(page.toggle(page.rows()[0]))
    await page.click(page.button(page.view.root, '保存配置'))
    assert.equal(page.saved[0].endpoints[0].baseURL, 'https://edited.test/v1')
    assert.equal(page.saved[0].endpoints[0].apiKey, 'fake-new-key')
    assert.equal(page.saved[0].endpoints[0].apiKeyEnv, 'KEY_A')
    assert.equal(page.saved[0].endpoints[0].models[0].contextWindow, 8192)
    assert.deepEqual(page.saved[0].endpoints[0].models[0].input, ['text', 'image'])
    assert.deepEqual(Object.keys(page.saved[0]).sort(), ['baseURL', 'endpoints', 'tools'])
    assert.equal(Object.keys(page.saved[0].endpoints[0]).some(key => /expand|collapse|rowId/i.test(key)), false)
  } finally {await page.close()}
})

test('new endpoints open for editing and removing a row leaves other expansion states alone', async () => {
  const page = await settingsView()
  try {
    assert.equal(page.view.root.findAllByProps({className: 's2a_iconBtn s2a_endpointToggle'}).length, 2)
    await page.click(page.toggle(page.rows()[1]))
    await page.click(page.button(page.view.root, '添加端点'))
    assert.equal(page.rows().length, 3)
    assert.equal(page.toggle(page.rows()[0]).props['aria-expanded'], false)
    assert.equal(page.toggle(page.rows()[1]).props['aria-expanded'], true)
    assert.equal(page.toggle(page.rows()[2]).props['aria-expanded'], true)
    assert.ok(page.rows()[2].findAllByType('input').length > 0)
    await page.click(page.button(page.rows()[0], '删除端点'))
    assert.equal(page.rows().length, 2)
    assert.equal(page.toggle(page.rows()[0]).props['aria-expanded'], true)
    assert.equal(page.toggle(page.rows()[1]).props['aria-expanded'], true)
  } finally {await page.close()}
})
