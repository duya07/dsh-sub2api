import assert from 'node:assert/strict'
import test from 'node:test'
import z from '@deepseek-ai/schemastery'
import {Context, Service} from '@deepseek-ai/cordis'
import * as routesModule from '../src/routes.ts'
import * as plugin from '../src/index.ts'

const { registerRoutes, endpointCredentialRef } = routesModule
const SECRET = 'sk-test-secret-never-echo'
const initialConfig = () => ({baseURL: 'https://old.test', providers: {openai: {}, claude: {}, grok: {}}})
const endpoint = (over = {}) => ({platform: 'openai', name: 'Team', baseURL: 'https://a.test', apiKeyEnv: 'A', apiKey: SECRET, models: [{id: 'model'}], ...over})
const postBody = (endpoints = [endpoint()]) => ({baseURL: 'https://default.test', endpoints})
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done}); return {promise, resolve}}
const configFailure = outcome => routesModule.ConfigSaveError
  ? new routesModule.ConfigSaveError(outcome)
  : Object.assign(new Error(SECRET), {outcome})

function fixture(options = {}) {
  let config = structuredClone(options.config ?? initialConfig())
  const original = structuredClone(config)
  const files = new Map(Object.entries(options.files ?? {}))
  const fallback = new Map(Object.entries(options.fallback ?? {}))
  const env = new Map(Object.entries(options.env ?? {}))
  const events = [], commits = [], handlers = []
  const credentials = {
    async describe(ref) {
      events.push(['describe', ref])
      if (options.describe) await options.describe(ref)
      if (env.has(ref)) return {configured: true, writable: false, source: 'env'}
      if (files.has(ref)) return {configured: true, writable: true, source: 'file'}
      if (fallback.has(ref)) return {configured: true, writable: true, source: 'project-env'}
      return {configured: false, writable: true}
    },
    async resolve(ref) {
      events.push(['resolve', ref])
      if (options.resolve) await options.resolve(ref)
      if (env.has(ref)) return {value: env.get(ref), source: 'env'}
      if (files.has(ref)) return {value: files.get(ref), source: 'file'}
      if (fallback.has(ref)) return {value: fallback.get(ref), source: 'project-env'}
    },
    async set(ref, value) {
      events.push(['set', ref, value])
      if (options.beforeSet) await options.beforeSet(ref, value)
      files.set(ref, value)
      if (options.afterSet) await options.afterSet(ref, value)
    },
    async unset(ref) {
      events.push(['unset', ref])
      if (options.beforeUnset) await options.beforeUnset(ref)
      files.delete(ref)
    },
  }
  if (options.dropMethod) delete credentials[options.dropMethod]
  const routes = {
    config: () => {events.push(['config']); return config},
    async setConfig(next) {
      commits.push(structuredClone(next))
      if (options.commit) await options.commit(next, value => {config = value})
      else config = next
    },
    ...(options.prepare ? {prepareConfig: options.prepare} : {}),
    listRegisteredRoutes: () => {if (options.receiptThrow) throw options.receiptThrow; return ['sub2api-openai']},
    resolveApiKey: async () => SECRET,
  }
  registerRoutes({
    inject(_deps, callback) {callback({webServer: {register(entry) {handlers.push(entry)}}, effect() {}})},
    get(name) {return name === 'credentials' && !options.missingCredentials ? credentials : undefined},
  }, routes)
  const handler = handlers.find(entry => entry.path === '/plugins/dsh-sub2api/config').handler
  const call = async (body, method = 'POST') => {
    const req = {method, socket: {remoteAddress: '127.0.0.1'}, headers: {host: '127.0.0.1:43120'},
      async *[Symbol.asyncIterator]() {if (method === 'POST') yield Buffer.from(JSON.stringify(body))}}
    let status, text
    await handler(req, {writeHead(code) {status = code}, end(value) {text = value}})
    return {status, body: JSON.parse(text), text}
  }
  const mutations = () => events.filter(([kind]) => kind === 'set' || kind === 'unset')
  return {call, files, fallback, events, commits, mutations, original, current: () => config}
}

function assertNoMutation(f, result, status = 400) {
  assert.equal(result.status, status)
  assert.deepEqual(f.mutations(), [])
  assert.deepEqual(f.current(), f.original)
  assert.deepEqual(f.commits, [])
  assert.ok(!result.text.includes(SECRET))
}

for (const [name, bad] of [
  ['protocol', {api: SECRET}], ['platform', {platform: SECRET}],
  ['URL scheme', {baseURL: 'ftp://bad.test'}], ['URL host', {baseURL: 'https://'}],
  ['kept reference', {apiKey: '', apiKeyEnv: 'BAD-REF'}],
]) {
  test(`late invalid endpoint ${name} causes zero credential mutation`, async () => {
    const f = fixture({files: {A: 'old-a'}})
    assertNoMutation(f, await f.call(postBody([endpoint(), endpoint({...bad, apiKeyEnv: bad.apiKeyEnv ?? 'B'})])))
    assert.equal(f.files.get('A'), 'old-a')
  })
}

test('same-row legacy protocol validation precedes its Key write', async () => {
  const f = fixture()
  assertNoMutation(f, await f.call({baseURL: 'https://a.test', providers: {openai: {apiKey: SECRET, api: SECRET}}}))
})

test('combined legacy Key and invalid endpoint never partially save', async () => {
  const f = fixture()
  assertNoMutation(f, await f.call({...postBody([endpoint({api: SECRET})]), providers: {openai: {apiKey: SECRET}}}))
})

test('invalid retained provider reference is rejected before endpoint writes', async () => {
  const config = initialConfig()
  config.providers.claude.apiKeyEnv = 'BAD-REF'
  const f = fixture({config})
  assertNoMutation(f, await f.call(postBody()))
})

test('an endpoint needs a valid effective host even when baseURL is blank', async () => {
  const f = fixture()
  assertNoMutation(f, await f.call({baseURL: '', endpoints: [endpoint({baseURL: ''})]}))
})

for (const missing of ['service', 'resolve', 'describe', 'unset', 'set']) {
  test(`new Key fails closed with missing credentials ${missing}`, async () => {
    const f = fixture(missing === 'service' ? {missingCredentials: true} : {dropMethod: missing})
    const result = await f.call(postBody())
    assert.notEqual(result.status, 200)
    assertNoMutation(f, result, result.status)
    assert.equal('endpoints' in result.body, false)
  })
}

for (const phase of ['resolve', 'describe']) {
  test(`${phase} failure snapshots all-or-none before any Key writes`, async () => {
    const f = fixture({files: {A: 'old-a'}, [phase]: async ref => {if (ref === 'B') throw new Error(SECRET)}})
    const result = await f.call(postBody([endpoint(), endpoint({apiKeyEnv: 'B'})]))
    assertNoMutation(f, result, 500)
    assert.equal(f.files.get('A'), 'old-a')
  })
}

test('environment override refuses the whole save before writable refs mutate', async () => {
  const f = fixture({files: {A: 'old-a'}, env: {B: 'env-value'}})
  const result = await f.call(postBody([endpoint(), endpoint({apiKeyEnv: 'B'})]))
  assert.notEqual(result.status, 200)
  assertNoMutation(f, result, result.status)
})

test('all snapshots finish before the first credential set', async () => {
  const f = fixture()
  const result = await f.call(postBody([endpoint(), endpoint({apiKeyEnv: 'B'})]))
  assert.equal(result.status, 200)
  const firstSet = f.events.findIndex(([kind]) => kind === 'set')
  for (const ref of ['A', 'B']) for (const kind of ['describe', 'resolve']) {
    const snapshot = f.events.findIndex(event => event[0] === kind && event[1] === ref)
    assert.ok(snapshot >= 0 && snapshot < firstSet)
  }
})

for (const prior of ['file', 'absent', 'fallback']) {
  test(`second set-then-throw restores old file and ${prior} ref in reverse order`, async () => {
    const f = fixture({files: {A: 'old-a', UNRELATED: 'untouched', ...(prior === 'file' ? {B: 'old-b'} : {})},
      fallback: prior === 'fallback' ? {B: 'fallback-b'} : {},
      afterSet: async (ref, value) => {if (ref === 'B' && value === SECRET) throw new Error(SECRET)}})
    const result = await f.call(postBody([endpoint(), endpoint({apiKeyEnv: 'B'})]))
    assert.equal(result.status, 500)
    assert.equal(result.body.settingsOutcome, 'not-committed')
    assert.equal(result.body.credentialOutcome, 'restored')
    assert.deepEqual(f.current(), f.original)
    assert.deepEqual([...f.files], [['A', 'old-a'], ['UNRELATED', 'untouched'], ...(prior === 'file' ? [['B', 'old-b']] : [])])
    assert.equal(f.fallback.get('B'), prior === 'fallback' ? 'fallback-b' : undefined)
    assert.deepEqual(f.mutations().slice(2).map(([kind, ref]) => [kind, ref]), [[prior === 'file' ? 'set' : 'unset', 'B'], ['set', 'A']])
    assert.ok(!result.text.includes(SECRET))
  })
}

test('one compensation failure cannot prevent compensation of remaining refs', async () => {
  const f = fixture({files: {A: 'old-a'},
    afterSet: async (ref, value) => {if (ref === 'B' && value === SECRET) throw new Error(SECRET)},
    beforeUnset: async ref => {if (ref === 'B') throw new Error(SECRET)}})
  const result = await f.call(postBody([endpoint(), endpoint({apiKeyEnv: 'B'})]))
  assert.equal(result.status, 500)
  assert.equal(result.body.credentialOutcome, 'restore-incomplete')
  assert.equal(f.files.get('A'), 'old-a')
  assert.equal(f.files.get('B'), SECRET)
  assert.deepEqual(f.mutations().slice(2).map(([kind, ref]) => [kind, ref]), [['unset', 'B'], ['set', 'A']])
  assert.ok(result.text.length < 512)
  assert.ok(!result.text.includes(SECRET))
})

test('shared explicit ref and same Key are written once', async () => {
  const f = fixture()
  assert.equal((await f.call(postBody([endpoint(), endpoint({name: 'Other'})]))).status, 200)
  assert.equal(f.mutations().length, 1)
})

test('shared explicit ref and conflicting Keys fail before writes', async () => {
  const f = fixture()
  assertNoMutation(f, await f.call(postBody([endpoint(), endpoint({apiKey: 'different-key'})])))
})

for (const same of [false, true]) {
  test(`legacy and endpoint shared ref ${same ? 'deduplicates' : 'rejects conflict'}`, async () => {
    const config = initialConfig()
    config.providers.openai.apiKeyEnv = 'SHARED'
    const f = fixture({config})
    const result = await f.call({...postBody([endpoint({apiKeyEnv: 'SHARED', apiKey: same ? SECRET : 'different-key'})]), providers: {openai: {apiKey: SECRET}}})
    if (!same) assertNoMutation(f, result)
    else {
      assert.equal(result.status, 200)
      assert.deepEqual(f.mutations(), [['set', 'SHARED', SECRET]])
    }
  })
}

test('auto refs are ASCII and skip every occupied collision', () => {
  const siblings = ['SUB2API_OPENAI_TEAM_API_KEY', 'SUB2API_OPENAI_TEAM_API_KEY_4', 'SUB2API_OPENAI_TEAM_API_KEY_5']
    .map(apiKeyEnv => endpoint({apiKeyEnv}))
  const ref = endpointCredentialRef('openai', 'Team', siblings)
  assert.ok(/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref))
  assert.ok(!siblings.some(row => row.apiKeyEnv === ref))
  assert.ok(/^[A-Za-z_][A-Za-z0-9_]*$/.test(endpointCredentialRef('openai', '\u4e2d\u6587', siblings)))
})

test('auto allocation also avoids retained refs and later explicit rows', async () => {
  const config = initialConfig()
  config.providers.claude.apiKeyEnv = 'SUB2API_OPENAI_API_KEY'
  const f = fixture({config, files: {SUB2API_OPENAI_API_KEY: 'keep-root'}})
  const explicit = 'SUB2API_OPENAI_TEAM_API_KEY'
  const result = await f.call(postBody([endpoint({apiKeyEnv: ''}), endpoint({apiKeyEnv: explicit, apiKey: ''})]))
  assert.equal(result.status, 200)
  assert.equal(f.files.get('SUB2API_OPENAI_API_KEY'), 'keep-root')
  assert.notEqual(result.body.endpoints[0].apiKeyEnv, explicit)
  assert.notEqual(result.body.endpoints[0].apiKeyEnv, 'SUB2API_OPENAI_API_KEY')
})

test('blank Key, omitted endpoints, legacy old ref and API clearing stay compatible', async () => {
  const config = initialConfig()
  config.providers.openai = {apiKeyEnv: 'OLDER_OPENAI_KEY', api: 'openai-completions'}
  config.endpoints = [endpoint({apiKey: undefined, apiKeyEnv: 'KEEP'})]
  const f = fixture({config, files: {OLDER_OPENAI_KEY: 'old-key', KEEP: 'keep'}})
  const result = await f.call({baseURL: 'https://default.test', providers: {openai: {apiKey: '   ', api: ''}}})
  assert.equal(result.status, 200)
  assert.deepEqual(f.mutations(), [])
  assert.deepEqual(f.current().endpoints, config.endpoints)
  assert.equal(f.current().providers.openai.apiKeyEnv, 'OLDER_OPENAI_KEY')
  assert.equal(f.current().providers.openai.api, undefined)
  assert.equal((await f.call(undefined, 'GET')).status, 200)
  assert.equal((await f.call({baseURL: 'https://default.test', providers: {openai: {apiKey: 'opaque-legal-token'}}})).status, 200)
  assert.equal(f.files.get('OLDER_OPENAI_KEY'), 'opaque-legal-token')
  assert.ok(!result.text.includes(SECRET))
})

for (const apiKey of ['bad\nheader', 'bad\rheader', '\u4e2d\u6587', 'bad\u0000header']) {
  test(`unusable new Key ${JSON.stringify(apiKey)} is rejected without mutation`, async () => {
    const f = fixture()
    assertNoMutation(f, await f.call(postBody([endpoint({apiKey})])))
  })
}

test('successful receipt preserves row order and never includes new Keys', async () => {
  const f = fixture()
  const result = await f.call(postBody([endpoint({name: 'First'}), endpoint({platform: 'claude', name: 'Second', apiKeyEnv: 'B'})]))
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.endpoints.map(row => [row.platform, row.name, row.apiKeyEnv]), [['openai', 'First', 'A'], ['claude', 'Second', 'B']])
  assert.ok(result.body.endpoints.every(row => row.keyConfigured))
  assert.ok(!result.text.includes(SECRET))
})

for (const outcome of ['not-committed', 'committed', 'unknown']) {
  test(`explicit settings ${outcome} failure respects credential outcome`, async () => {
    const f = fixture({files: {A: 'old-a'}, commit: async (next, assign) => {
      if (outcome === 'committed') assign(next)
      throw configFailure(outcome)
    }})
    const result = await f.call(postBody())
    assert.equal(result.status, 500)
    assert.equal(result.body.settingsOutcome, outcome)
    assert.equal(result.body.credentialOutcome, outcome === 'not-committed' ? 'restored' : 'preserved')
    assert.equal(f.files.get('A'), outcome === 'not-committed' ? 'old-a' : SECRET)
    assert.equal(f.current().baseURL, outcome === 'committed' ? 'https://default.test' : 'https://old.test')
    assert.ok(!result.text.includes(SECRET))
  })
}

for (const assigned of [false, true]) {
  test(`unattested setConfig throw with ${assigned ? 'committed' : 'old live'} config never blindly rolls Keys back`, async () => {
    const f = fixture({files: {A: 'old-a'}, commit: async (next, assign) => {
      if (assigned) assign(next)
      throw new Error(SECRET)
    }})
    const result = await f.call(postBody())
    assert.equal(result.status, 500)
    assert.equal(result.body.settingsOutcome, 'unknown')
    assert.equal(result.body.credentialOutcome, 'preserved')
    assert.equal(f.files.get('A'), SECRET)
    assert.equal(f.mutations().length, 1)
    assert.ok(!result.text.includes(SECRET))
    assert.ok(result.text.length < 512)
  })
}

test('prepareConfig refusal is known precommit and causes zero credential operations', async () => {
  const f = fixture({prepare: async () => {throw new Error(SECRET)}})
  assertNoMutation(f, await f.call(postBody()), 500)
  assert.deepEqual(f.events.filter(([kind]) => kind === 'describe' || kind === 'resolve'), [])
})

for (const failing of [false, true]) {
  test(`concurrent A/B saves serialize state read through ${failing ? 'compensation' : 'commit'} and tail recovers`, async () => {
    const entered = deferred(), release = deferred()
    let first = true
    const f = fixture({files: {A: 'old-a'}, afterSet: async () => {
      if (!first) return
      first = false
      entered.resolve()
      await release.promise
      if (failing) throw new Error(SECRET)
    }})
    const saveA = f.call(postBody())
    await entered.promise
    const reads = f.events.filter(([kind]) => kind === 'config').length
    const saveB = f.call({baseURL: 'https://b.test', providers: {openai: {models: [{id: 'later'}]}}})
    await tick()
    const during = f.events.filter(([kind]) => kind === 'config').length
    release.resolve()
    const [a, b] = await Promise.all([saveA, saveB])
    assert.equal(during, reads, 'second save must not read state until first has finished')
    assert.equal(a.status, failing ? 500 : 200)
    assert.equal(b.status, 200)
    assert.equal(f.current().baseURL, 'https://b.test')
    assert.equal(f.current().endpoints?.length, failing ? undefined : 1)
    assert.equal(f.files.get('A'), failing ? 'old-a' : SECRET)
    assert.equal((await f.call({baseURL: 'https://next.test'})).status, 200)
  })
}

function settingsFixture(options = {}) {
  const form = new z(plugin.Config.toJSON())
  for (const field of Object.values(form.dict)) delete field.meta.volatile
  const schema = form.toJSON()
  let revision = 8
  const replacements = []
  const descriptor = {ns: 'llm-sub2api', revision, schema, applies: 'live'}
  const settings = {
    describe: () => options.absent ? [] : [{...descriptor, revision, ...(options.descriptor ?? {})}],
    async replace(ns, next, expectedRevision) {
      replacements.push({ns, next, expectedRevision})
      if (options.replace) return options.replace(next)
    },
  }
  const ctx = {get: name => name === 'settings' && !options.missing ? settings : undefined}
  return {ctx, replacements, advance: () => {revision++}}
}

function trackedSettingsFixture() {
  const host = settingsFixture()
  const original = host.ctx.get('settings')
  class TrackedSettings extends Service {
    constructor(ctx) {super(ctx, 'settings')}
    describe() {return original.describe()}
    async replace(...args) {return original.replace(...args)}
  }
  const ctx = new Context()
  new TrackedSettings(ctx)
  return {...host, ctx, replaceService(value) {ctx.reflect.set('settings', value)}}
}

test('Cordis tracked settings service accepts fresh proxies of one provider', async () => {
  const host = trackedSettingsFixture()
  const first = host.ctx.get('settings'), second = host.ctx.get('settings')
  assert.notEqual(first, second)
  assert.equal(first[Symbol.for('cordis.original')], second[Symbol.for('cordis.original')])
  const f = fixture({files: {A: 'old-a'}, prepare: next => plugin.prepareConfigSave(host.ctx, next)})
  assert.equal((await f.call(postBody())).status, 200)
  assert.equal(host.replacements.length, 1)
  assert.equal(host.replacements[0].expectedRevision, 8)
  assert.equal(f.files.get('A'), SECRET)
  assert.equal(f.mutations().length, 1)
})

for (const missing of [false, true]) {
  test(`Cordis ${missing ? 'removed' : 'replaced'} provider still refuses commit and compensates`, async () => {
    const host = trackedSettingsFixture()
    const f = fixture({files: {A: 'old-a'}, prepare: next => plugin.prepareConfigSave(host.ctx, next),
      afterSet: async (_ref, value) => {
        if (value === SECRET) host.replaceService(missing ? undefined : {describe: () => [], replace: async () => {throw new Error('wrong provider')}})
      }})
    const result = await f.call(postBody())
    assert.equal(result.status, 500)
    assert.equal(result.body.settingsOutcome, 'not-committed')
    assert.equal(f.files.get('A'), 'old-a')
    assert.deepEqual(host.replacements, [])
  })
}

for (const [name, options] of [
  ['service', {missing: true}], ['entry', {absent: true}],
  ['nonvolatile field', {descriptor: {schema: z.object({baseURL: z.string()}).toJSON()}}],
  ['invalid revision', {descriptor: {revision: undefined}}],
]) {
  test(`host ${name} preflight refuses before Key mutation`, async () => {
    const host = settingsFixture(options)
    const f = fixture({prepare: plugin.prepareConfigSave ? next => plugin.prepareConfigSave(host.ctx, next) : undefined})
    assertNoMutation(f, await f.call(postBody()), 500)
    assert.deepEqual(host.replacements, [])
  })
}

test('host preflight validates schema and passes captured revision without a dry-run write', async () => {
  const host = settingsFixture()
  const f = fixture({prepare: plugin.prepareConfigSave ? next => plugin.prepareConfigSave(host.ctx, next) : undefined})
  assert.equal((await f.call(postBody())).status, 200)
  assert.equal(host.replacements.length, 1)
  assert.equal(host.replacements[0].ns, 'llm-sub2api')
  assert.equal(host.replacements[0].expectedRevision, 8)
})

test('host schema preflight rejection never mutates credentials or calls replace', async () => {
  const host = settingsFixture()
  const form = new z(plugin.Config.toJSON())
  for (const field of Object.values(form.dict)) delete field.meta.volatile
  form.dict.baseURL = z.const('https://old.test')
  const schema = form.toJSON()
  const f = fixture({prepare: plugin.prepareConfigSave ? next => plugin.prepareConfigSave({...host.ctx,
    get: () => ({describe: () => [{ns: 'llm-sub2api', revision: 8, schema, applies: 'live'}], replace: async () => {host.replacements.push('unexpected')}})}, next) : undefined})
  assertNoMutation(f, await f.call(postBody()), 500)
  assert.deepEqual(host.replacements, [])
})

test('revision drift after Key writes is known precommit and compensates before replace', async () => {
  const host = settingsFixture()
  const f = fixture({files: {A: 'old-a'}, afterSet: async (_ref, value) => {if (value === SECRET) host.advance()},
    prepare: plugin.prepareConfigSave ? next => plugin.prepareConfigSave(host.ctx, next) : undefined})
  const result = await f.call(postBody())
  assert.equal(result.status, 500)
  assert.equal(result.body.settingsOutcome, 'not-committed')
  assert.equal(f.files.get('A'), 'old-a')
  assert.deepEqual(host.replacements, [])
})

test('host replace write-then-throw is indeterminate despite old live state', async () => {
  let durable
  const host = settingsFixture({replace: async next => {durable = next; throw new Error(SECRET)}})
  const f = fixture({files: {A: 'old-a'}, prepare: plugin.prepareConfigSave ? next => plugin.prepareConfigSave(host.ctx, next) : undefined})
  const result = await f.call(postBody())
  assert.equal(result.status, 500)
  assert.equal(result.body.settingsOutcome, 'unknown')
  assert.equal(durable?.baseURL, 'https://default.test')
  assert.equal(f.current().baseURL, 'https://old.test')
  assert.equal(f.files.get('A'), SECRET)
  assert.ok(!result.text.includes(SECRET))
})

for (const attested of [false, true]) {
  test(`receipt formation throw after commit preserves Keys even with ${attested ? 'misplaced attestation' : 'generic error'}`, async () => {
    const f = fixture({files: {A: 'old-a'}, receiptThrow: attested ? configFailure('not-committed') : new Error(SECRET)})
    const result = await f.call(postBody())
    assert.equal(result.status, 500)
    assert.equal(result.body.settingsOutcome, 'committed')
    assert.equal(result.body.credentialOutcome, 'preserved')
    assert.equal(f.current().baseURL, 'https://default.test')
    assert.equal(f.files.get('A'), SECRET)
    assert.ok(!result.text.includes(SECRET))
    assert.ok(result.body.error.includes('\u5df2\u63d0\u4ea4'))
  })
}

test('non-object late endpoint fails closed without partial mutation', async () => {
  const f = fixture()
  assertNoMutation(f, await f.call(postBody([endpoint(), null])))
})
