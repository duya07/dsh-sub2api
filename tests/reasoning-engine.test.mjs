import assert from 'node:assert/strict'
import test from 'node:test'
import {setImmediate} from 'node:timers/promises'
import {ReasoningProbeService, ProbeScheduler, createSdkProbeTransport, classifyProbeError, inspectProbeWire, retryAfterMs, loadPeerProbeSdk, probeWireModel} from '../src/reasoning-probe.ts'
import {probeDraft, protocols, sseFrames, sseResponse} from './reasoning-fixtures.mjs'
import {translateToPiAi} from '../src/pi-ai.ts'

const accepted = {kind: 'accepted', reason: 'accepted-parameter', transmitted: true}
const rejected = {kind: 'rejected', reason: 'unconfirmed-rejection', transmitted: true}
const unknown = {kind: 'unknown', reason: 'ambiguous-error', transmitted: true}
function clock() {
  let time = 10000
  return {now: () => time, advance(ms) {time += ms}, scheduler: new ProbeScheduler(() => time, async (ms, signal) => {if (signal.aborted) throw new Error('cancelled'); time += ms})}
}
async function settle(service, id, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {await setImmediate(); const view = service.status(id); if (!['queued', 'running'].includes(view.phase)) return view}
  assert.fail('bounded probe did not settle')
}

test('settle admits more than 1000 event-loop turns within its time bound', async () => {
  let polls = 0
  const service = {status() {return {phase: ++polls > 1500 ? 'completed' : 'running'}}}
  assert.equal((await settle(service, 'fake-task')).phase, 'completed')
  assert.equal(polls, 1501)
  await assert.rejects(settle({status() {return {phase: 'running'}}}, 'stalled-task', 10), /bounded probe did not settle/)
})

test('no successful control means no removal, even when every candidate is explicitly rejected', async () => {
  const time = clock()
  const service = new ReasoningProbeService(async attempt => {attempt.sent(); return attempt.level === undefined ? unknown : rejected}, time.scheduler, time.now)
  try {
    const started = service.start(probeDraft(), 'fakekey')
    const view = await settle(service, started.id)
    assert.deepEqual(view.suggestion, ['low', 'high'])
    assert.deepEqual(view.levels.map(item => item.state), ['unknown', 'unknown'])
    assert.deepEqual(view.levels.map(item => item.reason), ['no-control', 'no-control'])
    assert.equal(view.requests, 5)
  } finally {service.dispose()}
})

test('only exact repeat rejection plus a successful same-context control removes that single level', async () => {
  const time = clock(), calls = []
  const service = new ReasoningProbeService(async attempt => {calls.push({level: attempt.level, at: time.now(), model: attempt.draft.model.id, key: attempt.key}); attempt.sent(); time.advance(31); return attempt.level === 'high' ? rejected : accepted}, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft(), 'fakekey').id)
    assert.deepEqual(view.suggestion, ['low'])
    assert.deepEqual(view.levels.map(item => item.state), ['accepted', 'unsupported'])
    assert.equal(view.requests, 5)
    assert.deepEqual(calls.map(item => item.level), [undefined, 'low', 'high', undefined, 'high'])
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 5031)
    assert.equal(calls.every(item => item.model === 'model-a' && item.key === 'fakekey'), true)
  } finally {service.dispose()}
})

test('inconsistent confirmation remains unknown and an empty suggestion never declares reasoning false', async () => {
  const time = clock(); let rejection = 0
  const service = new ReasoningProbeService(async attempt => {attempt.sent(); return attempt.level === undefined ? accepted : ++rejection === 1 ? rejected : unknown}, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['high']), 'fakekey').id)
    assert.deepEqual(view.suggestion, ['high'])
    assert.equal(view.levels[0].state, 'unknown')
  } finally {service.dispose()}
  const all = new ReasoningProbeService(async attempt => {attempt.sent(); return attempt.level === undefined ? accepted : rejected}, time.scheduler, time.now)
  try {
    const view = await settle(all, all.start(probeDraft('openai-responses', ['high']), 'fakekey').id)
    assert.deepEqual(view.suggestion, [])
    assert.equal('reasoning' in view, false)
  } finally {all.dispose()}
})

test('shared scheduler serializes independent services and measures gap from request end, not start', async () => {
  const time = clock(), events = []; let active = 0, peak = 0
  const transport = async attempt => {active++; peak = Math.max(peak, active); const start = time.now(); attempt.sent(); await setImmediate(); time.advance(113); events.push({start, end: time.now()}); active--; return accepted}
  const a = new ReasoningProbeService(transport, time.scheduler, time.now), b = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const ids = [a.start(probeDraft('openai-responses', ['low']), 'fakekey').id, b.start(probeDraft('openai-responses', ['high']), 'fakekey').id]
    await Promise.all([settle(a, ids[0]), settle(b, ids[1])])
    assert.equal(peak, 1)
    assert.equal(events.length, 4)
    for (let i = 1; i < events.length; i++) assert.ok(events[i].start - events[i - 1].end >= 5000)
  } finally {a.dispose(); b.dispose()}
})

test('cancel aborts the in-flight attempt and stops every subsequent send, including a late success', async () => {
  const time = clock(); let sends = 0, signal, release
  const held = new Promise(resolve => {release = resolve})
  const service = new ReasoningProbeService(async attempt => {signal = attempt.signal; sends++; attempt.sent(); return held}, time.scheduler, time.now)
  const started = service.start(probeDraft(), 'fakekey')
  await setImmediate()
  service.cancel(started.id)
  assert.equal(signal.aborted, true)
  release(accepted)
  await setImmediate()
  assert.equal(sends, 1)
  assert.equal(service.status(started.id).phase, 'cancelled')
  assert.deepEqual(service.status(started.id).suggestion, ['low', 'high'])
  service.dispose()
})

test('queued cancellation, disposal and task bounds prevent extra provider attempts', async () => {
  const time = clock(); let sends = 0, release
  const held = new Promise(resolve => {release = resolve})
  const service = new ReasoningProbeService(async attempt => {sends++; attempt.sent(); return held}, time.scheduler, time.now)
  const ids = Array.from({length: 8}, () => service.start(probeDraft(), 'fakekey').id)
  assert.equal(service.start(probeDraft(), 'fakekey'), undefined)
  await setImmediate()
  service.cancel(ids[1]); service.dispose(); release(accepted)
  await setImmediate()
  assert.equal(sends, 1)
  assert.equal(ids.every(id => service.status(id).phase === 'cancelled'), true)
  assert.equal(service.start(probeDraft(), 'fakekey'), undefined)
})

test('429 pauses all services through Retry-After, extreme headers cannot collapse waits to 1ms', async () => {
  assert.equal(retryAfterMs('3000000', 0), 3000000000)
  assert.equal(retryAfterMs('9'.repeat(400), 0), 60000)
  assert.equal(retryAfterMs('not-a-date', 0), 60000)
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT', 10000), 110000)
  const time = clock(), events = []; let first = true
  const transport = async attempt => {events.push(time.now()); attempt.sent(); if (first) {first = false; return {kind: 'unknown', reason: 'rate-limited', transmitted: true, retryAfterMs: 3000000000}} return accepted}
  const a = new ReasoningProbeService(transport, time.scheduler, time.now), b = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const one = a.start(probeDraft('openai-responses', ['low']), 'fakekey')
    await settle(a, one.id)
    const two = b.start(probeDraft('openai-responses', ['low']), 'fakekey')
    await settle(b, two.id)
    assert.ok(events[1] - events[0] >= 3000000000)
  } finally {a.dispose(); b.dispose()}
})

test('R4 header Retry-After survives a stalled-body deadline or task cancellation across services', async () => {
  for (const mode of ['timeout', 'cancel']) {
    const time = clock(), calls = [], nativeTimeout = globalThis.setTimeout
    let deadline, began, capturedPause = false
    const active = new Promise(resolve => {began = resolve})
    globalThis.setTimeout = (fn, ms, ...args) => {if (ms === 30000) deadline = () => fn(...args); return nativeTimeout(fn, ms, ...args)}
    const transport = createSdkProbeTransport({fetch: async (_url, init) => {
      calls.push({at: time.now(), effort: JSON.parse(init.body).reasoning?.effort})
      if (calls.length === 1) {began(); return new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('{'))}}), {status: 429, headers: {'retry-after': '120'}})}
      return sseResponse('openai-responses')
    }})
    const a = new ReasoningProbeService(transport, time.scheduler, time.now), b = new ReasoningProbeService(transport, time.scheduler, time.now)
    try {
      const first = a.start(probeDraft('openai-responses', ['low']), 'fakekey')
      await active; await setImmediate()
      capturedPause = time.scheduler.estimate() >= 120000
      time.advance(30000)
      if (mode === 'timeout') {assert.equal(typeof deadline, 'function'); deadline()} else a.cancel(first.id)
      for (let i = 0; i < 1000 && ['queued', 'running'].includes(a.status(first.id).phase); i++) await setImmediate()
      const second = b.start(probeDraft('openai-responses', ['low']), 'fakekey')
      const view = await settle(b, second.id)
      assert.deepEqual(view.levels.map(item => item.state), ['accepted'])
      assert.ok(calls.length >= 3)
      assert.ok(calls.slice(1).every(item => item.at >= 130000), `${mode}: sends ${JSON.stringify(calls)}`)
      assert.equal(calls[1].at, 130000, 'pause is absolute at header arrival, not restarted after body parsing')
      assert.equal(capturedPause, true, 'pause must already be visible while the body is stalled')
    } finally {a.dispose(); b.dispose(); globalThis.setTimeout = nativeTimeout}
  }
})

test('R4 absolute header evidence survives cancelled SDK completion and SDK exceptions', async () => {
  for (const mode of ['cancel', 'throw']) {
    const controller = new AbortController(), pauses = []
    let began
    const active = new Promise(resolve => {began = resolve})
    const sdk = await loadPeerProbeSdk('openai-responses')
    const transport = createSdkProbeTransport({now: () => 10000, loadSdk: async () => ({streamSimple(...args) {
      const stream = sdk.streamSimple(...args)
      return {result: async () => {const result = await stream.result(); if (mode === 'throw') throw new Error('private-sdk-error'); return result}}
    }}), fetch: async () => {
      began()
      return mode === 'cancel'
        ? new Response(new ReadableStream({start(stream) {stream.enqueue(new TextEncoder().encode('{'))}}), {status: 429, headers: {'retry-after': '120'}})
        : new Response('{', {status: 429, headers: {'retry-after': '120'}})
    }})
    const running = transport({draft: probeDraft('openai-responses'), key: 'fakekey', level: 'low', signal: controller.signal, pauseUntil: until => pauses.push(until), sent() {}})
    await active; await setImmediate()
    if (mode === 'cancel') controller.abort()
    const result = await running
    assert.equal(result.kind, 'unknown')
    assert.equal(result.reason, mode === 'cancel' ? 'cancelled' : 'rate-limited')
    assert.equal(result.retryAfterMs, 120000)
    assert.equal(result.retryAfterUntil, 130000)
    assert.deepEqual(pauses, [130000])
    assert.equal(JSON.stringify(result).includes('private-sdk-error'), false)
  }
})

test('generic 400, wrong parameter/value, auth/quota and sensitive error echoes stay unknown and private', () => {
  const exact = inspectProbeWire('openai-responses', 'high', {reasoning: {effort: 'high'}, max_output_tokens: 32768}, 32768)
  for (const [status, error] of [[400, {message: 'invalid request'}], [400, {param: 'max_tokens', message: "invalid value 'high'"}], [400, {param: 'reasoning.effort', message: "unsupported value 'xhigh'"}], [401, {message: 'fake-secret https://sensitive.test'}], [403, {}], [429, {}], [500, {}]]) {
    const result = classifyProbeError(status, {error}, exact)
    assert.equal(result.kind, 'unknown')
    assert.equal(JSON.stringify(result).includes('sensitive'), false)
    assert.equal(JSON.stringify(result).includes('fake-secret'), false)
  }
  assert.equal(classifyProbeError(400, {error: {param: 'reasoning.effort', code: 'unsupported_value', message: "unsupported value 'high'"}}, exact).kind, 'rejected')
})

test('clamps, omitted parameters, managed effort and insufficient thinking budgets are never exact evidence', () => {
  for (const [api, level, wire, cap] of [
    ['openai-responses', 'max', {reasoning: {effort: 'high'}, max_output_tokens: 32768}, 32768],
    ['openai-completions', 'high', {max_tokens: 32768}, 32768],
    ['openai-responses', 'none', {max_output_tokens: 32768}, 32768],
    ['anthropic-messages', 'high', {thinking: {type: 'enabled', budget_tokens: 7168}, max_tokens: 8192}, 8192],
    ['anthropic-messages', 'low', {thinking: {type: 'adaptive'}, output_config: {effort: 'high'}, max_tokens: 32768, messages: [{role: 'system', output_config: {effort: 'low'}}]}, 32768],
    ['anthropic-messages', 'high', {thinking: {type: 'adaptive'}, output_config: {effort: 'high'}, max_tokens: 32768, messages: [{role: 'system', output_config: {effort: 'high'}}]}, 32768],
    ['anthropic-messages', 'high', {thinking: {type: 'adaptive'}, output_config: {effort: 'high'}, max_tokens: 128}, 128],
  ]) assert.equal(inspectProbeWire(api, level, wire, cap).exact, false)
})

test('a target appearing only in an allowed-values list or contradictory clauses is not rejected', () => {
  const exact = {exact: true, reason: 'accepted-parameter', parameter: 'reasoning_effort', value: 'high'}
  for (const message of ["Unsupported value: 'max'. Supported values are 'low', 'medium', 'high'.", "Unsupported value: 'xhigh'; use 'high' instead.", "Unsupported value 'high', but 'high' is supported.", "The value 'high' is valid; unsupported value: 'max'."]) assert.equal(classifyProbeError(400, {error: {param: 'reasoning_effort', code: 'unsupported_value', message}}, exact).kind, 'unknown')
})

test('R1 multiline allowed lists, negated and quoted rejection messages preserve unknown', async () => {
  const messages = [
    "Unsupported value: 'high'. Supported values:\n'low', 'medium', 'high'.",
    "Unsupported value: 'high'. Allowed values:\r\n[\r\n'low',\r\n'high'\r\n].",
    "This is not an unsupported value 'high' error; request data is malformed.",
    'The upstream quoted "unsupported value \'high\'" as an example; request data is malformed.',
    '"unsupported value \'high\'" is a quoted diagnostic, not this request rejection.',
  ]
  for (const api of ['openai-responses', 'openai-completions']) {
    const param = api === 'openai-responses' ? 'reasoning.effort' : 'reasoning_effort'
    for (const message of messages) {
      const time = clock(), calls = []
      const transport = createSdkProbeTransport({fetch: async (_url, init) => {
        const body = JSON.parse(init.body), effort = body.reasoning?.effort ?? body.reasoning_effort
        calls.push({at: time.now(), effort})
        return effort === 'high' ? new Response(JSON.stringify({error: {param, code: 'unsupported_value', message}}), {status: 400}) : sseResponse(api)
      }})
      const service = new ReasoningProbeService(transport, time.scheduler, time.now)
      try {
        const view = await settle(service, service.start(probeDraft(api, ['high']), 'fakekey').id)
        assert.equal(view.levels[0].state, 'unknown', `${api}: ${message}`)
        assert.deepEqual(view.suggestion, ['high'])
        assert.equal(calls.length, 2)
        assert.ok(calls[1].at - calls[0].at >= 5000)
      } finally {service.dispose()}
    }
    for (const message of ["unsupported value 'high'", "invalid effort: 'high'", "'high' is not supported"]) {
      assert.equal(classifyProbeError(400, {error: {param, code: 'unsupported_value', message}}, {exact: true, reason: 'accepted-parameter', parameter: param, value: 'high'}).kind, 'rejected')
    }
  }
})

test('a target rejection mentioning budget or capacity is ambiguous rather than unsupported', () => {
  const exact = {exact: true, reason: 'accepted-parameter', parameter: 'reasoning_effort', value: 'high'}
  for (const message of ["unsupported value 'high': insufficient output token budget", "invalid effort 'high': context capacity is too small", "unsupported value 'high' due to quota"]) assert.equal(classifyProbeError(400, {error: {param: 'reasoning_effort', code: 'unsupported_value', message}}, exact).kind, 'unknown')
})

test('legal CRLF SSE split at every byte remains accepted in all protocols', async () => {
  for (const api of protocols) {
    const text = await sseResponse(api).text()
    const bytes = new TextEncoder().encode(text.replace(/\n/g, '\r\n'))
    const transport = createSdkProbeTransport({fetch: async () => new Response(new ReadableStream({start(controller) {for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close()}}), {headers: {'content-type': 'text/event-stream'}})})
    const result = await transport({draft: probeDraft(api), key: 'fakekey', level: 'low', signal: new AbortController().signal, sent() {}})
    assert.equal(result.kind, 'accepted')
  }
})

test('R2 named SSE errors including byte-split CRLF invalidate candidates and controls', async () => {
  const namedError = 'event: error\ndata: {"code":"upstream_error","message":"fake-secret https://sensitive.test"}'
  const response = async (api, bad, chunked) => {
    const blocks = (await sseResponse(api, sseFrames(api, 'model-a', 'assistant says error')).text()).split('\n\n').filter(Boolean)
    const afterText = api === 'openai-completions' ? 1 : 3
    if (bad) blocks.splice(afterText, 0, namedError)
    const text = blocks.join('\n\n') + '\n\n'
    const body = chunked ? new ReadableStream({start(controller) {for (const byte of new TextEncoder().encode(text.replace(/\n/g, '\r\n'))) controller.enqueue(Uint8Array.of(byte)); controller.close()}}) : text
    return new Response(body, {headers: {'content-type': 'text/event-stream'}})
  }
  for (const api of protocols) for (const chunked of [false, true]) {
    for (const bad of [true, false]) {
      const transport = createSdkProbeTransport({fetch: () => response(api, bad, chunked)})
      const result = await transport({draft: probeDraft(api, ['low']), key: 'fakekey', level: 'low', signal: new AbortController().signal, sent() {}})
      assert.equal(result.kind, bad ? 'unknown' : 'accepted', `${api}: named error=${bad}, chunked=${chunked}`)
      assert.equal(JSON.stringify(result).includes('fake-secret'), false)
      assert.equal(JSON.stringify(result).includes('sensitive'), false)
    }
    const time = clock(), transport = createSdkProbeTransport({fetch: async (_url, init) => {
      const body = JSON.parse(init.body)
      const candidate = body.reasoning?.effort || body.reasoning_effort || body.thinking
      const param = api === 'openai-responses' ? 'reasoning.effort' : 'reasoning_effort'
      return candidate ? new Response(JSON.stringify({error: {param, code: 'unsupported_value', message: "unsupported value 'low'"}}), {status: 400}) : response(api, true, chunked)
    }})
    const service = new ReasoningProbeService(transport, time.scheduler, time.now)
    try {
      const view = await settle(service, service.start(probeDraft(api, ['low']), 'fakekey').id)
      assert.equal(view.levels[0].state, 'unknown')
      assert.deepEqual(view.suggestion, ['low'])
      if (api !== 'anthropic-messages') assert.equal(view.levels[0].reason, 'no-control')
      assert.equal(JSON.stringify(view).includes('fake-secret'), false)
    } finally {service.dispose()}
  }
})

for (const api of protocols) {
  test(`actual peer ${api} accepts complete same-model SSE and makes one exact no-retry request`, async () => {
    const calls = []
    const transport = createSdkProbeTransport({fetch: async (url, init) => {calls.push({url: String(url), body: JSON.parse(init.body), headers: init.headers}); return sseResponse(api)}})
    let sent = 0
    const result = await transport({draft: probeDraft(api), key: 'fakekey', level: 'low', signal: new AbortController().signal, sent: () => {sent++}})
    assert.equal(result.kind, 'accepted')
    assert.equal(sent, 1)
    assert.equal(calls.length, 1)
    assert.equal(new URL(calls[0].url).hostname, 'fake.test')
    if (api === 'openai-responses') assert.equal(calls[0].body.reasoning.effort, 'low')
    else if (api === 'openai-completions') assert.equal(calls[0].body.reasoning_effort, 'low')
    // An anthropic probe must send the adaptive shape: the route's own
    // translation sets forceAdaptiveThinking, so a fixed-budget probe would
    // verify a shape the real request never uses.
    else {
      assert.equal(calls[0].body.thinking.type, 'adaptive')
      assert.equal(calls[0].body.output_config.effort, 'low')
    }
  })
  test(`actual peer ${api} keeps 200 errors, missing terminal, empty, limit and wrong-model responses unknown`, async () => {
    const error = {type: 'error', error: {message: 'fake-secret https://sensitive.test', type: 'api_error'}}
    const good = sseFrames(api)
    for (const frames of [[error], [...good.slice(0, -1), error], good.slice(0, -1), sseFrames(api, 'model-a', ''), sseFrames(api, 'model-a', 'OK', 'limit'), sseFrames(api, 'wrong-model'), ['{malformed']]) {
      let count = 0
      const transport = createSdkProbeTransport({fetch: async () => {count++; return sseResponse(api, frames)}})
      const result = await transport({draft: probeDraft(api), key: 'fakekey', level: 'low', signal: new AbortController().signal, sent() {}})
      assert.equal(result.kind, 'unknown')
      assert.equal(count, 1)
      assert.equal(JSON.stringify(result).includes('fake-secret'), false)
      assert.equal(JSON.stringify(result).includes('sensitive'), false)
    }
  })
  test(`actual peer ${api} disables both SDK retry layers for 400, 429 and 5xx`, async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      let count = 0
      const transport = createSdkProbeTransport({fetch: async () => {count++; return new Response(JSON.stringify({error: {message: 'fake-secret https://sensitive.test'}}), {status, headers: {'retry-after': '12'}})}})
      const result = await transport({draft: probeDraft(api), key: 'fakekey', level: 'low', signal: new AbortController().signal, sent() {}})
      assert.equal(result.kind, 'unknown')
      assert.equal(count, 1)
      if (status === 429) assert.equal(result.retryAfterMs, 12000)
      assert.equal(JSON.stringify(result).includes('sensitive'), false)
    }
  })
}

test('actual peer OpenAI xhigh/max are sent exactly when declared, and an anthropic level still goes out under a small model cap', async () => {
  for (const api of ['openai-responses', 'openai-completions']) for (const level of ['xhigh', 'max']) {
    let payload
    const transport = createSdkProbeTransport({fetch: async (_url, init) => {payload = JSON.parse(init.body); return sseResponse(api)}})
    const result = await transport({draft: probeDraft(api, [level]), key: 'fakekey', level, signal: new AbortController().signal, sent() {}})
    assert.equal(result.kind, 'accepted')
    assert.equal(api === 'openai-responses' ? payload.reasoning.effort : payload.reasoning_effort, level)
  }
  const small = probeDraft('anthropic-messages', ['high']); small.model.maxTokens = 8192
  let payload
  const transport = createSdkProbeTransport({fetch: async (_url, init) => {payload = JSON.parse(init.body); return sseResponse('anthropic-messages')}})
  const result = await transport({draft: small, key: 'fakekey', level: 'high', signal: new AbortController().signal, sent() {}})
  // The adaptive shape carries no thinking budget, so a small model cap no
  // longer makes the level unsendable; the payload proves it reached the wire.
  assert.equal(result.kind, 'accepted')
  assert.equal(result.transmitted, true)
  assert.equal(payload.max_tokens, 8192)
  assert.equal(payload.thinking.type, 'adaptive')
  assert.equal(payload.output_config.effort, 'high')
})

test('an SDK-clamped value never reaches the fetch and cannot cause a false rejection', async () => {
  let calls = 0
  const transport = createSdkProbeTransport({loadSdk: async api => {
    const sdk = await loadPeerProbeSdk(api)
    return {...sdk, streamSimple(model, context, options) {return sdk.streamSimple({...model, thinkingLevelMap: {...model.thinkingLevelMap, xhigh: null}}, context, options)}}
  }, fetch: async () => {calls++; return new Response(JSON.stringify({error: {param: 'reasoning.effort', code: 'unsupported_value', message: "unsupported value 'high'"}}), {status: 400})}})
  const result = await transport({draft: probeDraft('openai-responses', ['low', 'high', 'xhigh']), key: 'fakekey', level: 'xhigh', signal: new AbortController().signal, sent() {}})
  assert.equal(result.kind, 'unknown')
  assert.equal(calls, 0)
})

test('R3 omitted capabilities inherit translated capacities and keep the real request thinking shape', async () => {
  for (const api of protocols) {
    const draft = probeDraft(api, ['high']); draft.model = {id: 'model-a'}
    const profile = Object.values(translateToPiAi({baseURL: draft.endpoint.baseURL, providers: {openai: {}, claude: {}, grok: {}}, endpoints: [{name: 'reasoning-probe', platform: draft.endpoint.platform, baseURL: draft.endpoint.baseURL, apiKeyEnv: 'PROBE_ONLY', api, models: [{...draft.model, reasoningEfforts: draft.candidates}]}]}))[0]
    const model = probeWireModel(draft)
    assert.equal(model.contextWindow, profile.defaultContextWindow)
    assert.equal(model.maxTokens, profile.defaultMaxTokens)
    assert.equal(model.contextWindow, 128000)
    assert.equal(model.maxTokens, 8192)
    const bodies = [], forwarded = []
    const sdk = await loadPeerProbeSdk(api)
    let normalBody
    const normal = {...model, contextWindow: profile.defaultContextWindow, maxTokens: profile.defaultMaxTokens}
    await sdk.streamSimple(normal, {messages: [{role: 'user', content: 'Reply exactly OK.', timestamp: 0}]}, {apiKey: 'fakekey', reasoning: 'high', maxRetries: 0, fetch: async (_url, init) => {normalBody = JSON.parse(init.body); return sseResponse(api)}}).result()
    const transport = createSdkProbeTransport({loadSdk: async () => ({streamSimple(model, context, options) {forwarded.push(Object.hasOwn(options, 'maxTokens')); return sdk.streamSimple(model, context, options)}}), fetch: async (_url, init) => {bodies.push(JSON.parse(init.body)); return sseResponse(api)}})
    for (const level of [undefined, 'high']) {
      const result = await transport({draft, key: 'fakekey', level, signal: new AbortController().signal, sent() {}})
      assert.equal(result.kind, 'accepted')
    }
    const tokens = body => api === 'openai-responses' ? body.max_output_tokens : api === 'openai-completions' ? body.max_completion_tokens ?? body.max_tokens : body.max_tokens
    assert.deepEqual(forwarded, [false, false])
    assert.equal(tokens(normalBody), 8192)
    assert.equal(tokens(bodies[0]), 8192)
    if (api === 'anthropic-messages') {
      // The real request and the probe now both send adaptive thinking, so the
      // small inherited cap changes max_tokens only, never the thinking shape.
      assert.equal(normalBody.thinking.type, 'adaptive')
      assert.equal(normalBody.output_config.effort, 'high')
      assert.equal(bodies.length, 2)
      assert.equal(bodies[1].thinking.type, 'adaptive')
      assert.equal(bodies[1].output_config.effort, 'high')
    } else assert.equal(tokens(bodies[1]), 8192)
    assert.equal(bodies.every(body => tokens(body) <= tokens(normalBody)), true)
  }
})

test('the probe model carries the translated anthropic compat so the wire shape matches the real request', () => {
  for (const api of protocols) {
    const wire = probeWireModel(probeDraft(api))
    assert.equal(wire.compat?.forceAdaptiveThinking === true, api === 'anthropic-messages', `${api} probe compat: ${JSON.stringify(wire.compat)}`)
  }
})

test('an anthropic model declaring more output than the probe cap still probes every level on the wire', async () => {
  const draft = probeDraft('anthropic-messages', ['low', 'high']); draft.model.maxTokens = 131072
  const bodies = []
  const transport = createSdkProbeTransport({fetch: async (_url, init) => {bodies.push(JSON.parse(init.body)); return sseResponse('anthropic-messages')}})
  for (const level of ['low', 'high']) {
    const result = await transport({draft, key: 'fakekey', level, signal: new AbortController().signal, sent() {}})
    assert.equal(result.kind, 'accepted')
    assert.equal(result.transmitted, true)
  }
  assert.deepEqual(bodies.map(body => body.output_config.effort), ['low', 'high'])
})

// The probe always asks for `maxTokens: cap`, so a model whose own maxTokens is
// larger says nothing about the payload. Predicting "budget-limited" from that
// number stranded every openai level before a request went out; the SDK's own
// payload is the only thing that decides now, for every protocol.
test('an openai model declaring more output than the probe cap still sends every level on the wire', async () => {
  for (const api of ['openai-responses', 'openai-completions']) {
    const draft = probeDraft(api, ['low', 'medium', 'high', 'xhigh', 'max']); draft.model.maxTokens = 128000
    const bodies = []
    const transport = createSdkProbeTransport({fetch: async (_url, init) => {bodies.push(JSON.parse(init.body)); return sseResponse(api)}})
    for (const level of draft.candidates) {
      const result = await transport({draft, key: 'fakekey', level, signal: new AbortController().signal, sent() {}})
      assert.equal(result.kind, 'accepted', `${api} ${level}: ${JSON.stringify(result)}`)
      assert.equal(result.transmitted, true, `${api} ${level} reached the wire`)
    }
    assert.deepEqual(bodies.map(body => api === 'openai-responses' ? body.reasoning.effort : body.reasoning_effort), ['low', 'medium', 'high', 'xhigh', 'max'])
    assert.equal(bodies.every(body => (api === 'openai-responses' ? body.max_output_tokens : body.max_completion_tokens ?? body.max_tokens) === 32768), true)
  }
  const draft = probeDraft('openai-responses', ['low', 'medium', 'high', 'xhigh', 'max']); draft.model.maxTokens = 128000
  const time = clock(); let calls = 0
  const service = new ReasoningProbeService(createSdkProbeTransport({fetch: async () => {calls++; return sseResponse('openai-responses')}}), time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(draft, 'fakekey').id)
    assert.equal(calls, 6, 'one control plus all five levels reach the wire')
    assert.deepEqual(view.levels.map(item => item.state), ['accepted', 'accepted', 'accepted', 'accepted', 'accepted'])
    assert.equal(view.levels.some(item => item.reason === 'budget-limited'), false)
  } finally {service.dispose()}
})

// The exemption must not be re-introduced one protocol at a time: every route
// now reaches the SDK when the model declares more output than the probe cap,
// and each one counts its request as sent.
test('no protocol is exempt from the payload verdict when the model declares more output than the cap', async () => {
  for (const api of protocols) {
    const draft = probeDraft(api, ['high']); draft.model.maxTokens = 131072
    let sends = 0
    const transport = createSdkProbeTransport({fetch: async () => sseResponse(api)})
    const result = await transport({draft, key: 'fakekey', level: 'high', signal: new AbortController().signal, sent() {sends++}})
    assert.equal(result.transmitted, true, `${api} reached the wire`)
    assert.equal(sends, 1, `${api} counted its request as sent`)
  }
})

// budget-limited is no longer predicted from the model's own maxTokens: it is
// what inspectProbeWire reports when the payload the SDK actually built exceeds
// the probe cap. The verdict still carries the two numbers the UI renders.
test('budget-limited now comes from the payload and still carries the numbers behind it', async () => {
  const draft = probeDraft('openai-responses', ['high']); draft.model.maxTokens = 128000
  const sdk = await loadPeerProbeSdk('openai-responses')
  let calls = 0
  const transport = createSdkProbeTransport({loadSdk: async () => ({streamSimple(model, context, options) {return sdk.streamSimple(model, context, 'reasoning' in options ? {...options, maxTokens: 65536} : options)}}), fetch: async () => {calls++; return sseResponse('openai-responses')}})
  const time = clock(), service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(draft,'fakekey').id)
    assert.equal(view.levels[0].state, 'unknown')
    assert.equal(view.levels[0].reason, 'budget-limited')
    assert.equal(view.levels[0].maxTokens, 128000)
    assert.equal(view.levels[0].cap, 32768)
    assert.equal(calls, 1, 'only the no-level control request goes out')
  } finally {service.dispose()}
})

test('oversized and abort-stalled HTTP error bodies are bounded and never passed back to SDK raw', async () => {
  const transport = createSdkProbeTransport({fetch: async () => new Response(JSON.stringify({error: {message: `fake-secret https://sensitive.test ${'x'.repeat(70000)}`}}), {status: 400})})
  const large = await transport({draft: probeDraft(), key: 'fakekey', level: 'low', signal: new AbortController().signal, sent() {}})
  assert.equal(large.kind, 'unknown')
  assert.equal(JSON.stringify(large).includes('sensitive'), false)
  const abort = new AbortController()
  let began
  const active = new Promise(resolve => {began = resolve})
  const stalled = createSdkProbeTransport({fetch: async () => {began(); return new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('{'))}}), {status: 400})}})
  const pending = stalled({draft: probeDraft(), key: 'fakekey', level: 'low', signal: abort.signal, sent() {}})
  await active; await setImmediate(); abort.abort()
  const result = await pending
  assert.equal(result.kind, 'unknown')
  assert.equal(result.reason, 'cancelled')
})

// F3 red test: "参数被转换或未发送" says neither what the SDK actually sent nor
// what the level expected, so a not-exact verdict carries both whenever the wire
// payload was readable.
test('a not-exact verdict carries the wire parameter and the value that went out', () => {
  const responses = inspectProbeWire('openai-responses', 'high', {reasoning: {effort: 'low'}, max_output_tokens: 32768}, 32768)
  assert.equal(responses.exact, false)
  assert.equal(responses.reason, 'parameter-not-exact')
  assert.equal(responses.parameter, 'reasoning.effort')
  assert.equal(responses.value, 'low')
  const completions = inspectProbeWire('openai-completions', 'high', {max_tokens: 32768}, 32768)
  assert.equal(completions.parameter, 'reasoning_effort')
  assert.equal(completions.value, undefined, 'an omitted parameter has no value to name')
  const adaptive = inspectProbeWire('anthropic-messages', 'high', {thinking: {type: 'adaptive'}, output_config: {effort: 'medium'}, max_tokens: 32768}, 32768)
  assert.equal(adaptive.parameter, 'output_config.effort')
  assert.equal(adaptive.value, 'medium')
  const fixed = inspectProbeWire('anthropic-messages', 'high', {thinking: {type: 'disabled'}, max_tokens: 32768}, 32768)
  assert.equal(fixed.parameter, 'thinking.type')
  assert.equal(fixed.value, 'disabled')
  // The added detail must never turn a not-exact wire into rejection evidence.
  assert.equal(classifyProbeError(400, {error: {param: 'reasoning.effort', message: "unsupported value 'low'"}}, responses).kind, 'unknown')
  assert.equal(classifyProbeError(400, {error: {param: 'reasoning.effort', message: "unsupported value 'low'"}}, responses).reason, 'ambiguous-error')
})

test('the service carries a not-exact parameter and value from the transport into the level', async () => {
  const time = clock()
  const transport = async ({level}) => level === undefined
    ? accepted
    : {kind: 'unknown', reason: 'parameter-not-exact', transmitted: false, parameter: 'reasoning.effort', value: 'low'}
  const service = new ReasoningProbeService(transport, time.scheduler, time.now)
  try {
    const view = await settle(service, service.start(probeDraft('openai-responses', ['high']), 'fakekey').id)
    assert.equal(view.levels[0].reason, 'parameter-not-exact')
    assert.equal(view.levels[0].parameter, 'reasoning.effort')
    assert.equal(view.levels[0].value, 'low')
  } finally {service.dispose()}
})
