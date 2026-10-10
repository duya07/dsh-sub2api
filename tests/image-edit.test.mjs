import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerImageTools } from '../src/image-tools.ts'
import { EndpointCooldownTracker, RATE_LIMITED_COOLDOWN_MS, endpointCooldowns } from '../src/http-resilience.ts'

// The endpoint cooldown registry is process-wide on purpose, so tests that
// deliberately fail against the same endpoint must not leak into each other.
test.beforeEach(() => {
  endpointCooldowns.clear()
})

const FAKE_KEY = 'sk-sub2api-fake-key-never-echo'
// Eight bytes are enough: the media-type sniffer only needs the PNG signature.
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const ATTACHMENT_ID = `sha256:${'a'.repeat(64)}`
const SECOND_ATTACHMENT_ID = `sha256:${'b'.repeat(64)}`

const reference = (over = {}) => ({
  attachmentId: ATTACHMENT_ID,
  mediaType: 'image/png',
  bytes: PNG.length,
  width: 2,
  height: 2,
  ...over,
})

const limits = { maxImagesPerMessage: 5, maxImageBytes: 1024 * 1024, maxMessageImageBytes: 4 * 1024 * 1024 }

function attachmentStore(over = {}) {
  return {
    imageLimits: limits,
    async readImage(ref) {
      return { ref, data: PNG }
    },
    async saveImage(input) {
      return { attachmentId: ATTACHMENT_ID, mediaType: input.mediaType, bytes: input.data.byteLength, width: 2, height: 2 }
    },
    ...over,
  }
}

function fsMock(root) {
  return {
    async resolve(path) {
      return { displayPath: path }
    },
    async stat() {
      return undefined
    },
    async readBytes() {
      throw new Error('readBytes is not used by the image tool')
    },
    contains() {
      return true
    },
    processPath(target) {
      return join(root, String(target.displayPath).replace(/[\\/:]+/g, '_'))
    },
  }
}

const baseConfig = (over = {}) => ({
  baseURL: 'https://gw.test',
  providers: {
    openai: { apiKeyEnv: 'GW_KEY', models: [{ id: 'gpt-image-1.5' }] },
    claude: {},
    grok: {},
  },
  tools: { generate: { provider: 'openai', model: 'gpt-image-1.5' } },
  ...over,
})

/**
 * Mount the tool against mocked services and return its definition plus the
 * routes `resolveApiKey` was asked for.
 */
async function toolFixture(options = {}) {
  let definition
  const root = await mkdtemp(join(tmpdir(), 'sub2api-image-'))
  const routes = []
  // `attachments: undefined` is a meaningful case (no attachment service), so
  // distinguish "not given" from "explicitly none" instead of using defaults.
  const config = options.config === undefined ? baseConfig() : options.config
  const attachments = Object.hasOwn(options, 'attachments') ? options.attachments : attachmentStore()
  const ctx = {
    inject(_deps, callback) {
      callback({
        systemPrompt: { section() {} },
        tools: {
          register(value) {
            definition = value
            return () => {}
          },
        },
      })
    },
    get(name) {
      if (name === 'attachments') return attachments
      if (name === 'fs') return fsMock(root)
      return undefined
    },
  }
  registerImageTools(ctx, {
    config: () => config,
    resolveApiKey: async (route) => {
      routes.push(route)
      return options.resolveApiKey === undefined ? FAKE_KEY : options.resolveApiKey(route)
    },
    // Both are optional host overrides; the tests that exercise resilience pass
    // them so a watchdog window can be reached without a real 120s wait.
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.rateLimitRetry === undefined ? {} : { rateLimitRetry: options.rateLimitRetry }),
    ...(options.endpointCooldowns === undefined ? {} : { endpointCooldowns: options.endpointCooldowns }),
  })
  assert.ok(definition !== undefined, 'the tool was registered')
  return {
    definition,
    routes,
    root,
    exec: { signal: new AbortController().signal, agent: { session: { header: { cwd: root } } } },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

const b64Payload = (bytes = PNG) => ({
  data: [{ b64_json: Buffer.from(bytes).toString('base64') }],
})

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

async function withFetch(stub, run) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

test('referenceImages are sent to the gateway images/edits endpoint as multipart', async () => {
  const fixture = await toolFixture()
  const calls = []
  try {
    const result = await withFetch(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(b64Payload())
    }, () => fixture.definition.execute({
      prompt: 'add a hat',
      referenceImages: [reference()],
    }, fixture.exec))

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://gw.test/v1/images/edits')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers.authorization, `Bearer ${FAKE_KEY}`)
    // A FormData body must stay unlabelled so fetch sets its own multipart
    // boundary; a JSON content-type here would make the gateway misparse it.
    assert.equal(calls[0].init.headers['content-type'], undefined)
    const body = calls[0].init.body
    assert.ok(body instanceof FormData, 'the edit body is multipart FormData')
    assert.equal(body.get('model'), 'gpt-image-1.5')
    assert.equal(body.get('prompt'), 'add a hat')
    const images = body.getAll('image[]')
    assert.equal(images.length, 1)
    assert.equal(images[0].size, PNG.length)
    assert.equal(result.bytes, PNG.length)
    assert.equal(fixture.routes[0], 'sub2api-openai')
  } finally {
    await fixture.cleanup()
  }
})

test('an endpoint route id in the image slot resolves to its endpoint for edits', async () => {
  const config = baseConfig({
    baseURL: '',
    endpoints: [{
      name: 'GW',
      baseURL: 'https://gw.test',
      platform: 'openai',
      apiKeyEnv: 'GW_ENDPOINT_KEY',
      api: 'openai-responses',
      models: [{ id: 'gpt-image-1.5' }],
    }],
    tools: { generate: { provider: 'sub2api-openai-gw', model: 'gpt-image-1.5' } },
  })
  const fixture = await toolFixture({ config })
  const calls = []
  try {
    await withFetch(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(b64Payload())
    }, () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: [reference()] }, fixture.exec))
    assert.equal(calls[0].url, 'https://gw.test/v1/images/edits')
    assert.deepEqual(fixture.routes, ['sub2api-openai-gw'])
  } finally {
    await fixture.cleanup()
  }
})

test('an empty referenceImages array fails before any request', async () => {
  const fixture = await toolFixture()
  let calls = 0
  try {
    await withFetch(async () => {
      calls += 1
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: [] }, fixture.exec),
      (error) => {
        assert.match(error.message, /1–5/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls, 0)
})

test('more than five references fail before any request', async () => {
  const fixture = await toolFixture()
  const many = Array.from({ length: 6 }, (_value, index) => reference({
    attachmentId: `sha256:${String(index).repeat(64)}`,
  }))
  let calls = 0
  try {
    await withFetch(async () => {
      calls += 1
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: many }, fixture.exec),
      (error) => {
        assert.match(error.message, /1–5/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls, 0)
})

test('an incomplete reference is rejected instead of silently generating a new image', async () => {
  const fixture = await toolFixture()
  const calls = []
  try {
    await withFetch(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      // A plain path is what a model produces when it ignores the "copy a
      // complete reference" instruction; it must never degrade to text-to-image.
      () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: ['./photo.png'] }, fixture.exec),
      (error) => {
        assert.match(error.message, /无效|invalid/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls.length, 0)
})

test('a reference the attachment store cannot verify is rejected', async () => {
  const fixture = await toolFixture()
  const calls = []
  try {
    await withFetch(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      () => fixture.definition.execute({
        prompt: 'add a hat',
        referenceImages: [reference({ attachmentId: 'photo.png' })],
      }, fixture.exec),
      (error) => {
        assert.match(error.message, /无效|invalid/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls.length, 0)
})

test('duplicate references are rejected', async () => {
  const fixture = await toolFixture()
  let calls = 0
  try {
    await withFetch(async () => {
      calls += 1
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      () => fixture.definition.execute({
        prompt: 'add a hat',
        referenceImages: [reference(), reference()],
      }, fixture.exec),
      (error) => {
        assert.match(error.message, /重复|duplicate/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls, 0)
})

test('references above the attachment limits are rejected', async () => {
  const fixture = await toolFixture({
    attachments: attachmentStore({
      imageLimits: { ...limits, maxImageBytes: 4 },
    }),
  })
  let calls = 0
  try {
    await withFetch(async () => {
      calls += 1
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: [reference()] }, fixture.exec),
      (error) => {
        assert.match(error.message, /限制|limit/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls, 0)
})

test('editing without the attachment service reports a clear error', async () => {
  const fixture = await toolFixture({ attachments: undefined })
  let calls = 0
  try {
    await withFetch(async () => {
      calls += 1
      return jsonResponse(b64Payload())
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: [reference()] }, fixture.exec),
      (error) => {
        assert.match(error.message, /附件服务|attachment service/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls, 0)
})

test('a failing edit endpoint is reported instead of falling back to generation', async () => {
  const fixture = await toolFixture()
  const calls = []
  try {
    await withFetch(async (url, init) => {
      calls.push({ url, init })
      // The images API rejects the edit; the tool must not silently continue
      // through the chat fallback and produce an unrelated image.
      if (String(url).endsWith('/images/edits')) return jsonResponse({ error: { message: 'unknown endpoint' } }, 404)
      return jsonResponse({ choices: [{ message: { content: 'no image' } }] })
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'add a hat', referenceImages: [reference()] }, fixture.exec),
      (error) => {
        assert.match(error.message, /images\/edits/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://gw.test/v1/images/edits')
})

test('omitting referenceImages keeps the text-to-image path unchanged', async () => {
  const fixture = await toolFixture()
  const calls = []
  try {
    const result = await withFetch(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse(b64Payload())
    }, () => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://gw.test/v1/images/generations')
    assert.equal(calls[0].init.headers['content-type'], 'application/json')
    assert.equal(result.bytes, PNG.length)
  } finally {
    await fixture.cleanup()
  }
})

test('the tool declares referenceImages as an ordered 1-5 image reference list', async () => {
  const fixture = await toolFixture()
  try {
    // defineTool compiles the author-facing spec into raw JSON Schema, so the
    // declared shape is read back through `properties` / `required`.
    const parameters = fixture.definition.parameters
    assert.equal(parameters.type, 'object')
    const reference = parameters.properties.referenceImages
    assert.equal(reference.type, 'array')
    assert.equal(reference.items.type, 'object')
    assert.deepEqual(
      [...reference.items.required].sort(),
      ['attachmentId', 'bytes', 'height', 'mediaType', 'width'],
    )
    assert.deepEqual(reference.items.properties.mediaType.enum, [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ])
    assert.equal(reference.items.properties.originalDimensions.type, 'object')
    assert.deepEqual([...reference.items.properties.originalDimensions.required].sort(), ['height', 'width'])
    assert.match(reference.description, /1–5/)
    assert.match(fixture.definition.description, /referenceImages/)
  } finally {
    await fixture.cleanup()
  }
})

test('a 429 that states a Retry-After is retried exactly once', async () => {
  const fixture = await toolFixture()
  const calls = []
  try {
    const result = await withFetch(async (url, init) => {
      calls.push({ url, init })
      if (calls.length === 1) {
        // A stated delay is the only thing that unlocks the single retry, and
        // `0` keeps the test from actually sleeping through the gateway's wait.
        return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        })
      }
      return jsonResponse(b64Payload())
    }, () => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec))
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, 'https://gw.test/v1/images/generations')
    assert.equal(result.bytes, PNG.length)
  } finally {
    await fixture.cleanup()
  }
})

test('a 429 without a stated delay is not retried', async () => {
  const fixture = await toolFixture()
  let calls = 0
  try {
    await withFetch(async () => {
      calls += 1
      return jsonResponse({ error: { message: 'rate limited' } }, 429)
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec),
      (error) => {
        assert.match(error.message, /rate limited/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  // Without Retry-After the plugin cannot know when the window reopens, so it
  // reports the failure instead of guessing a backoff.
  assert.equal(calls, 1)
})

test('a parked endpoint is refused before the gateway is called again', async () => {
  const clock = { current: 1_000_000 }
  const tracker = new EndpointCooldownTracker({ now: () => clock.current })
  const fixture = await toolFixture({ endpointCooldowns: tracker })
  let calls = 0
  try {
    const fail = () => withFetch(async () => {
      calls += 1
      return jsonResponse({ error: { message: 'rate limited' } }, 429)
    }, () => assert.rejects(() => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec)))

    await fail()
    await fail()
    assert.equal(calls, 2)
    assert.ok(tracker.check('https://gw.test/v1') !== undefined, 'two failures parked the endpoint')

    await withFetch(async () => {
      throw new Error('the gateway must not be called while the endpoint is parked')
    }, () => assert.rejects(() => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec), (error) => {
      assert.match(error.message, /cooling down after 2 consecutive failures \(rate-limited\)/)
      assert.match(error.message, /retry in \d+ms/)
      return true
    }))
    assert.equal(calls, 2, 'the parked endpoint was refused before the request was built')

    clock.current += RATE_LIMITED_COOLDOWN_MS
    const result = await withFetch(async () => {
      calls += 1
      return jsonResponse(b64Payload())
    }, () => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec))
    assert.equal(calls, 3)
    assert.equal(result.bytes, PNG.length)
    assert.equal(tracker.size(), 0, 'one success forgets the endpoint')
  } finally {
    await fixture.cleanup()
  }
})

test('a gateway that stops sending data trips the idle watchdog', async () => {
  // The real window is two minutes; the fixture override keeps the test short.
  const fixture = await toolFixture({ idleTimeoutMs: 30 })
  let calls = 0
  try {
    await withFetch((url, init) => {
      calls += 1
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      })
    }, () => assert.rejects(
      () => fixture.definition.execute({ prompt: 'a cat' }, fixture.exec),
      (error) => {
        assert.match(error.message, /idle timeout/)
        return true
      },
    ))
  } finally {
    await fixture.cleanup()
  }
  assert.equal(calls, 1)
})
