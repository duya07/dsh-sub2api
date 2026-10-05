/**
 * The settings UI for the route-level stream idle timeout.
 *
 * The value belongs to an endpoint (`PiAiProviderProfile.streamIdleTimeoutMs`),
 * so the control lives in the endpoint editor, saves as a number on the
 * endpoint payload, and is omitted entirely when the field is left empty — the
 * host then applies its own 300000 ms default.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'

const fixture = (streamIdleTimeoutMs) => ({
  baseURL: 'https://gateway.test',
  catalogFormat: 'structured-v1',
  endpoints: [
    {
      name: 'Team A',
      platform: 'openai',
      baseURL: 'https://a.test',
      apiKeyEnv: 'KEY_A',
      keyConfigured: true,
      api: '',
      route: 'sub2api-openai-team-a',
      models: [{id: 'model-a'}],
      ...(streamIdleTimeoutMs === undefined ? {} : {streamIdleTimeoutMs}),
    },
  ],
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
  const status = () => view.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('s2a_statusErr'))
  return {
    view,
    saved,
    status,
    timeoutInput: (name) => view.root.findByProps({'aria-label': `${name} 流空闲超时`}),
    async expandEndpoint(name) {
      const node = view.root.findByProps({'aria-label': `展开 ${name} 端点`})
      await act(async () => {node.props.onClick()})
    },
    async change(node, value) {await act(async () => {node.props.onChange({target: {value, checked: value}})})},
    async save() {await act(async () => {await button(view.root, '保存配置').props.onClick()})},
    async close() {await act(async () => view.unmount())},
  }
}

test('a stored timeout renders in the endpoint editor', async () => {
  const page = await settingsView(fixture(900000))
  try {
    await page.expandEndpoint('Team A')
    assert.equal(page.timeoutInput('Team A').props.value, '900000')
  } finally {await page.close()}
})

test('an unset timeout stays empty and is not written into the payload', async () => {
  const page = await settingsView(fixture(undefined))
  try {
    await page.expandEndpoint('Team A')
    assert.equal(page.timeoutInput('Team A').props.value, '')
    await page.save()
    assert.equal('streamIdleTimeoutMs' in page.saved[0].endpoints[0], false)
  } finally {await page.close()}
})

test('editing the timeout saves it as a number on the endpoint', async () => {
  const page = await settingsView(fixture(undefined))
  try {
    await page.expandEndpoint('Team A')
    await page.change(page.timeoutInput('Team A'), '450000')
    await page.save()
    assert.equal(page.saved[0].endpoints[0].streamIdleTimeoutMs, 450000)
  } finally {await page.close()}
})

test('an invalid timeout refuses to save instead of dropping the value silently', async () => {
  for (const bad of ['0', 'abc', '2147483648']) {
    const page = await settingsView(fixture(undefined))
    try {
      await page.expandEndpoint('Team A')
      await page.change(page.timeoutInput('Team A'), bad)
      await page.save()
      assert.deepEqual(page.saved, [], `"${bad}" must not be saved`)
      assert.equal(page.status().length, 1)
      assert.match(page.status()[0].children.join(''), /流空闲超时/)
    } finally {await page.close()}
  }
})
