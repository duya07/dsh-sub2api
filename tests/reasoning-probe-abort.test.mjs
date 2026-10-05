// t1 red tests (spec item 1/1-2/3): a probe whose no-level control fails must not be
// reported as a completed probe, and a rate-limited control must honor Retry-After once
// before giving up. These tests fail on the current implementation on purpose.
//
// Engine contract asserted here (to be implemented by the fix step):
//   ProbeView.phase === 'aborted'  and  ProbeView.abortReason === <ProbeReason>
// for control-level failures { rate-limited, auth-or-quota, sdk-unavailable }.
import assert from 'node:assert/strict'
import test from 'node:test'
import {setImmediate} from 'node:timers/promises'
import {ReasoningProbeService, ProbeScheduler, createSdkProbeTransport} from '../src/reasoning-probe.ts'
import {probeDraft, sseResponse} from './reasoning-fixtures.mjs'

function clock() {
  let time = 10000
  return {now: () => time, advance(ms) {time += ms}, scheduler: new ProbeScheduler(() => time, async (ms, signal) => {if (signal.aborted) throw new Error('cancelled'); time += ms})}
}

async function settle(service, id) {
  for (let i = 0; i < 5000; i++) {
    await setImmediate()
    const view = service.status(id)
    if (view && !['queued', 'running'].includes(view.phase)) return view
  }
  assert.fail('probe did not settle')
}

function levelOf(body) {
  if (body.reasoning?.effort !== undefined) return body.reasoning.effort
  if (body.reasoning_effort !== undefined) return body.reasoning_effort
  if (body.thinking !== undefined) return 'anthropic-level'
  return undefined
}

const controlCalls = calls => calls.filter(item => item.level === undefined)
const levelCalls = calls => calls.filter(item => item.level !== undefined)

test('a rate-limited control honors Retry-After once and then probes every level', async () => {
  const time = clock(), calls = []
  const transport = createSdkProbeTransport({now: time.now, fetch: async (_url, init) => {
    const level = levelOf(JSON.parse(init.body))
    calls.push({at: time.now(), level})
    if (level !== undefined) return sseResponse('openai-responses')
    return controlCalls(calls).length === 1
      ? new Response(JSON.stringify({error: {message: 'slow down'}}), {status: 429, headers: {'retry-after': '6'}})
      : sseResponse('openai-responses')
  }})
  const service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['low', 'high']), 'fakekey').id)
    const controls = controlCalls(calls)
    assert.equal(controls.length, 2, 'the rate-limited control is retried exactly once')
    assert.ok(controls[1].at - controls[0].at >= 6000, `the retry waits for Retry-After, saw ${controls[1].at - controls[0].at}ms`)
    assert.deepEqual(levelCalls(calls).map(item => item.level), ['low', 'high'])
    assert.equal(view.phase, 'completed')
    assert.deepEqual(view.levels.map(item => `${item.level}=${item.state}`), ['low=accepted', 'high=accepted'])
  } finally {service.dispose()}
})

test('a second rate-limited control aborts the batch with a visible reason instead of "completed"', async () => {
  const time = clock(), calls = []
  const transport = createSdkProbeTransport({now: time.now, fetch: async (_url, init) => {
    const level = levelOf(JSON.parse(init.body))
    calls.push({at: time.now(), level})
    if (level !== undefined) return sseResponse('openai-responses')
    return new Response(JSON.stringify({error: {message: 'slow down'}}), {status: 429, headers: {'retry-after': '6'}})
  }})
  const service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['low', 'high']), 'fakekey').id)
    assert.equal(view.phase, 'aborted')
    assert.equal(view.abortReason, 'rate-limited')
    assert.equal(view.requests, 2, 'one control plus exactly one bounded retry, never a retry storm')
    assert.deepEqual(levelCalls(calls), [], 'no level request may be sent after the control was abandoned')
    assert.deepEqual(view.levels.map(item => `${item.level}=${item.state}/${item.reason}`), ['low=unknown/rate-limited', 'high=unknown/rate-limited'])
    assert.deepEqual(view.suggestion, ['low', 'high'], 'an aborted batch never removes a candidate level')
  } finally {service.dispose()}
})

test('an auth-or-quota control is never retried and aborts with its own reason', async () => {
  const time = clock(), calls = []
  const transport = createSdkProbeTransport({now: time.now, fetch: async (_url, init) => {
    const level = levelOf(JSON.parse(init.body))
    calls.push({at: time.now(), level})
    if (level !== undefined) return sseResponse('openai-responses')
    return new Response(JSON.stringify({error: {message: 'invalid api key'}}), {status: 401})
  }})
  const service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['low', 'high']), 'fakekey').id)
    assert.equal(view.phase, 'aborted')
    assert.equal(view.abortReason, 'auth-or-quota')
    assert.equal(view.requests, 1, '401/403 must never be retried')
    assert.equal(calls.length, 1)
    assert.deepEqual(levelCalls(calls), [])
    assert.deepEqual(view.suggestion, ['low', 'high'])
  } finally {service.dispose()}
})

test('an unavailable probe SDK aborts honestly even though nothing was transmitted', async () => {
  const time = clock(), calls = []
  const transport = createSdkProbeTransport({now: time.now, loadSdk: async () => {throw new Error('sdk-unavailable')}, fetch: async (_url, init) => {
    calls.push({at: time.now(), level: levelOf(JSON.parse(init.body))})
    return sseResponse('openai-responses')
  }})
  const service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['low', 'high']), 'fakekey').id)
    assert.equal(view.phase, 'aborted')
    assert.equal(view.abortReason, 'sdk-unavailable')
    assert.equal(view.requests, 0)
    assert.equal(calls.length, 0)
    assert.deepEqual(view.levels.map(item => `${item.level}=${item.state}/${item.reason}`), ['low=unknown/sdk-unavailable', 'high=unknown/sdk-unavailable'])
    assert.deepEqual(view.suggestion, ['low', 'high'])
  } finally {service.dispose()}
})

test('a Retry-After longer than the task budget aborts without waiting it out', async () => {
  const time = clock(), calls = []
  const transport = createSdkProbeTransport({now: time.now, fetch: async (_url, init) => {
    const level = levelOf(JSON.parse(init.body))
    calls.push({at: time.now(), level})
    if (level !== undefined) return sseResponse('openai-responses')
    return new Response(JSON.stringify({error: {message: 'slow down'}}), {status: 429, headers: {'retry-after': '3600'}})
  }})
  const service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['low', 'high']), 'fakekey').id)
    assert.equal(view.phase, 'aborted')
    assert.equal(view.abortReason, 'rate-limited')
    assert.equal(view.requests, 1, 'an hour of Retry-After must not be waited out inside a ten-minute task')
    assert.equal(calls.length, 1)
    assert.deepEqual(levelCalls(calls), [])
    assert.deepEqual(view.suggestion, ['low', 'high'])
  } finally {service.dispose()}
})
