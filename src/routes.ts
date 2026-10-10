/**
 * HTTP routes for the dsh-sub2api settings page.
 *
 * The browser half of a static plugin talks to the host through the web
 * server (there is no package-private `host.call` seam outside dynamic
 * packages), so this module exposes read/write endpoints for the plugin's
 * settings section. Requests are restricted to trusted local origins — the
 * same `trustedRequest` posture the oauth plugin uses — because these routes
 * mutate configuration and echo credential state.
 *
 * @module dsh-sub2api/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { API_PROTOCOLS, MAX_STREAM_IDLE_TIMEOUT_MS, PROVIDERS, gatewayApiRoot, type ApiProtocol, type CatalogModel, type Config, type ImageToolModelRef, type ImageToolsConfig, type ProviderEndpoint, type ProviderKey, type ProviderProfile, type WebSearchToolConfig } from './index.ts'
import { endpointRoute, platformLabel } from './pi-ai.ts'
import { ReasoningProbeService, parseProbeDraft } from './reasoning-probe.ts'

export const ROUTES = {
  get: '/plugins/dsh-sub2api/config',
  set: '/plugins/dsh-sub2api/config',
  discover: '/plugins/dsh-sub2api/discover',
  usage: '/plugins/dsh-sub2api/usage',
  status: '/plugins/dsh-sub2api/status',
  attachment: '/plugins/dsh-sub2api/attachment',
  reasoningStart: '/plugins/dsh-sub2api/reasoning/start',
  reasoningStatus: '/plugins/dsh-sub2api/reasoning/status',
  reasoningCancel: '/plugins/dsh-sub2api/reasoning/cancel',
} as const

/** One endpoint as the settings page sees it. Secrets are never echoed. */
export interface ConfigPayloadEndpoint {
  name: string
  baseURL: string
  platform: ProviderKey
  /** Credential reference the page echoes back so a rename keeps its key. */
  apiKeyEnv?: string
  keyConfigured: boolean
  api?: ApiProtocol
  models: CatalogModel[]
  /** Route-level stream idle timeout in milliseconds; absent keeps the host default. */
  streamIdleTimeoutMs?: number
  /** Route id this endpoint currently resolves to. */
  route: string
}

export interface ConfigPayload {
  baseURL: string
  catalogFormat: 'structured-v1'
  providers: Record<string, { keyConfigured: boolean; models: CatalogModel[] }>
  endpoints: ConfigPayloadEndpoint[]
  tools: ImageToolsConfig
}

function trustedRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  if (host === undefined) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  const value: unknown = JSON.parse(text)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    const text = String(error)
    return text.length > 0 ? text : 'unknown error'
  } catch {
    return 'unknown error'
  }
}

// A probe request failure used to collapse into one fixed English string, so the
// settings page could only ever say "probe request unavailable" no matter what
// actually went wrong. Errors this module authors carry a reason the user can
// act on; anything else stays generic, because an upstream message can echo the
// credential or the URL that produced it.
const PROBE_UNAVAILABLE = 'probe request unavailable'
class ProbeRequestError extends Error {}

function probeRequestReason(error: unknown): string {
  if (error instanceof ProbeRequestError) return `${PROBE_UNAVAILABLE}: ${error.message}`
  if (error instanceof SyntaxError) return `${PROBE_UNAVAILABLE}: request body is not valid JSON`
  return PROBE_UNAVAILABLE
}

function readProviderConfig(config: Config): ConfigPayload {
  const providers: ConfigPayload['providers'] = {}
  for (const def of PROVIDERS) {
    const profile = config.providers[def.key]
    providers[def.key] = {
      keyConfigured: profile.apiKeyEnv !== undefined,
      models: profile.models?.map((model) => ({ ...model })) ?? [],
    }
  }
  const list = config.endpoints ?? []
  const endpoints: ConfigPayloadEndpoint[] = list.map((endpoint) => ({
    name: endpoint.name ?? '',
    baseURL: endpoint.baseURL ?? '',
    platform: endpoint.platform,
    ...(endpoint.apiKeyEnv !== undefined ? { apiKeyEnv: endpoint.apiKeyEnv } : {}),
    keyConfigured: endpoint.apiKeyEnv !== undefined,
    ...(endpoint.api !== undefined ? { api: endpoint.api } : {}),
    models: endpoint.models?.map((model) => ({ ...model })) ?? [],
    ...(endpoint.streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs: endpoint.streamIdleTimeoutMs } : {}),
    route: endpointRoute(endpoint, list),
  }))
  return {
    baseURL: config.baseURL,
    catalogFormat: 'structured-v1',
    providers,
    endpoints,
    tools: {
      ...(config.tools?.generate !== undefined ? { generate: { ...config.tools.generate } } : {}),
      ...(config.tools?.webSearch !== undefined
        ? {
            webSearch: {
              enabled: config.tools.webSearch.enabled === true,
              provider: config.tools.webSearch.provider ?? '',
              model: config.tools.webSearch.model ?? '',
            },
          }
        : {}),
    },
  }
}

function legacyCatalogModel(value: string): CatalogModel | undefined {
  const [rawId = '', rawName = '', rawContextWindow = ''] = value.split('|')
  const id = rawId.trim()
  if (id.length === 0) return undefined
  const name = rawName.trim()
  const parsedContextWindow = Number(rawContextWindow.trim())
  const contextWindow = Number.isSafeInteger(parsedContextWindow) && parsedContextWindow > 0
    ? parsedContextWindow
    : undefined
  return {
    id,
    ...(name.length > 0 ? { name } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  }
}

function structuredCatalogModel(value: unknown): CatalogModel | undefined {
  if (typeof value === 'string') return legacyCatalogModel(value)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id.length === 0) return undefined
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const contextWindow = typeof raw.contextWindow === 'number' && Number.isSafeInteger(raw.contextWindow) && raw.contextWindow > 0
    ? raw.contextWindow
    : undefined
  const maxTokens = typeof raw.maxTokens === 'number' && Number.isSafeInteger(raw.maxTokens) && raw.maxTokens > 0
    ? raw.maxTokens
    : undefined
  const reasoningEfforts = Array.isArray(raw.reasoningEfforts)
    ? (raw.reasoningEfforts as unknown[]).filter((effort): effort is string => typeof effort === 'string' && effort.length > 0)
    : undefined
  // 'adaptive' / 'budget' is the only accepted spelling; anything else is
  // dropped so a stored catalog keeps matching the settings schema.
  const thinkingMode = raw.thinkingMode === 'adaptive' || raw.thinkingMode === 'budget' ? raw.thinkingMode : undefined
  const input = Array.isArray(raw.input)
    ? (raw.input as unknown[]).filter((modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image')
    : undefined
  return {
    id,
    ...(name.length > 0 ? { name } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
    ...(thinkingMode !== undefined ? { thinkingMode } : {}),
    ...(input !== undefined && input.length > 0 ? { input } : {}),
  }
}

function readCatalogModels(value: unknown, fallback: CatalogModel[]): CatalogModel[] {
  if (Array.isArray(value)) return value.map(structuredCatalogModel).filter((model) => model !== undefined)
  if (typeof value === 'string') {
    return value.split(/[\n,]/).map(legacyCatalogModel).filter((model) => model !== undefined)
  }
  return fallback
}

function providerCredentialRef(platform: string): CredentialRef {
  return credentialRef(`SUB2API_${platform.toUpperCase()}_API_KEY`)
}

/**
 * Credential reference for one endpoint.
 *
 * The first endpoint on a platform keeps the historical
 * `SUB2API_<PLATFORM>_API_KEY` name, so a key stored before this feature
 * existed survives as the platform's sole endpoint. Later ones append a slug.
 * The reference is generated once: the page echoes the stored `apiKeyEnv`
 * back, so renaming an endpoint never orphans its key.
 */
export function endpointCredentialRef(platform: ProviderKey, name: string, siblings: readonly ProviderEndpoint[]): string {
  const upper = platform.toUpperCase()
  const stub = `SUB2API_${upper}_API_KEY`
  if (siblings.length === 0) return stub
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const taken = new Set(siblings.map((entry) => entry.apiKeyEnv).filter((ref) => ref !== undefined))
  const candidate = slug.length > 0 ? `SUB2API_${upper}_${slug}_API_KEY` : `${stub}_${siblings.length + 1}`
  let ref = candidate
  let suffix = siblings.length + 1
  while (taken.has(ref)) ref = `${candidate}_${suffix++}`
  return ref
}

function isProviderKey(value: string): value is ProviderKey {
  return PROVIDERS.some((def) => def.key === value)
}

/**
 * Read one image-tool slot. Both spellings the settings UI can emit are
 * accepted: a bare platform key (`openai`) and an endpoint route id
 * (`sub2api-openai-gw`, `toolOptions` emits `<endpoint.route>:<modelId>`).
 * {@link resolveToolModel} maps each of them back — route id first, platform
 * key second. An unknown name is not rejected here: the tool reports a clear
 * error when it resolves the model, so a stale route never blocks a save.
 */
function readToolModelRef(value: unknown): ImageToolModelRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return undefined
  const compatToolName = typeof raw.compatToolName === 'boolean' ? raw.compatToolName : undefined
  return { provider, model, ...(compatToolName !== undefined ? { compatToolName } : {}) }
}

/**
 * Read the search section. Unlike {@link readToolModelRef} this also accepts an
 * endpoint route id, because a search route has to name *which* endpoint answers
 * it: with several endpoints on one platform the bare platform key cannot say.
 * An unknown route is not rejected here — the provider reports itself
 * unavailable for it, which is the same posture the host applies to a provider
 * that cannot serve requests.
 */
function readWebSearchTool(value: unknown, fallback: WebSearchToolConfig | undefined): WebSearchToolConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
  const raw = value as Record<string, unknown>
  if (raw.enabled !== true) return undefined
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return undefined
  return { enabled: true, provider, model }
}

function readImageTools(value: unknown, fallback: ImageToolsConfig | undefined): ImageToolsConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback
  const raw = value as Record<string, unknown>
  const generate = readToolModelRef(raw.generate)
  // The two tool sections are independent: an unusable image slot must not take
  // the search section down with it (and vice versa).
  const webSearch = readWebSearchTool(raw.webSearch, fallback?.webSearch)
  if (generate === undefined && webSearch === undefined) return undefined
  return {
    ...(generate !== undefined ? { generate } : {}),
    ...(webSearch !== undefined ? { webSearch } : {}),
  }
}

interface RouteContext {
  config: () => Config
  setConfig: (config: Config) => void | Promise<void>
  /** Preflight without mutation; the returned closure owns the settings commit. */
  prepareConfig?: (config: Config) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>
  listRegisteredRoutes: () => string[]
  /**
   * Resolve the stored credential for one provider route. Used by discovery
   * and usage probes when the settings form does not carry a freshly typed
   * key (keys are write-only and stay in the credential store).
   */
  resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>
}

export type SettingsSaveOutcome = 'not-committed' | 'committed' | 'unknown'

/** An explicit attestation; a generic settings rejection is not a rollback receipt. */
export class ConfigSaveError extends Error {
  readonly outcome: SettingsSaveOutcome

  constructor(outcome: SettingsSaveOutcome) {
    super('settings save failed')
    this.outcome = outcome
  }
}

function validConfigRef(value: unknown): value is CredentialRef {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function validConfigURL(value: string): boolean {
  try {
    const url = new URL(value)
    return /^https?:\/\//.test(value) && (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0
  } catch { return false }
}

function validSavedProfile(profile: ProviderProfile): boolean {
  return (profile.apiKeyEnv === undefined || validConfigRef(profile.apiKeyEnv))
    && (profile.api === undefined || (API_PROTOCOLS as readonly string[]).includes(profile.api))
}

/**
 * One-shot probe key for discovery/usage: a freshly typed key wins (it is the
 * one under test); otherwise fall back to the credential already stored for
 * that provider, so the settings page does not force the user to re-type the
 * key every time.
 */
async function resolveProbeKey(
  ctx: Context,
  routes: RouteContext,
  provider: string,
  typedKey: string,
  storedRef?: string,
): Promise<string> {
  if (typedKey.length > 0) return typedKey
  // Endpoint rows hand back their own credential reference, so a gateway
  // holding several keys probes the key on that row instead of whichever one
  // the platform happens to store first.
  if (typeof storedRef === 'string' && storedRef.length > 0) {
    try {
      return await routes.resolveApiKey(storedRef, { apiKeyEnv: storedRef })
    } catch {
      // The upstream text is never repeated back: it can quote the credential or
      // the URL that rejected it, and the user only needs to know which row and
      // what to do about it.
      throw new ProbeRequestError(`端点「${storedRef}」已保存的 key 无法解析，请在设置中重新填写并保存后再探测`)
    }
  }
  if (!isProviderKey(provider)) throw new ProbeRequestError('provider 无效，应为 openai / claude / grok')
  const def = PROVIDERS.find((entry) => entry.key === provider)
  const profile = routes.config().providers[provider]
  if (profile?.apiKeyEnv === undefined) {
    throw new ProbeRequestError(`${def?.label ?? provider} 未配置 API key：请先填写 key 并保存配置，再获取模型/查看用量`)
  }
  try {
    return await routes.resolveApiKey(`sub2api-${provider}`, profile)
  } catch {
    throw new ProbeRequestError(`${def?.label ?? provider} 已保存的 key 无法解析，请在设置中重新填写并保存后再试`)
  }
}

export function registerRoutes(ctx: Context, routes: RouteContext): void {
  let configSaveTail: Promise<void> = Promise.resolve()
  ctx.inject(['webServer'], (webCtx) => {
    const probes = new ReasoningProbeService()
    webCtx.effect(() => () => probes.dispose())
    const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
      webCtx.webServer.register({ kind: 'exact', path, handler })
    }

    for (const [path, action] of [[ROUTES.reasoningStart, 'start'], [ROUTES.reasoningStatus, 'status'], [ROUTES.reasoningCancel, 'cancel']] as const) {
      register(path, async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, {error: 'method not allowed'})
        if (!trustedRequest(req)) return json(res, 403, {error: 'forbidden'})
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += buffer.length
            if (size > 32768) return json(res, 413, {error: 'probe request too large'})
            chunks.push(buffer)
          }
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (action === 'start') {
            const draft = parseProbeDraft(body)
            if (!draft) return json(res, 400, {error: 'invalid probe draft'})
            const key = await resolveProbeKey(ctx, routes, draft.endpoint.platform, draft.endpoint.apiKey, draft.endpoint.apiKeyEnv)
            const task = probes.start(draft, key)
            return task ? json(res, 202, task) : json(res, 429, {error: 'probe task limit'})
          }
          const id = body !== null && typeof body === 'object' && 'id' in body && typeof body.id === 'string' ? body.id : ''
          const task = action === 'cancel' ? probes.cancel(id) : probes.status(id)
          return task ? json(res, 200, task) : json(res, 404, {error: 'probe task not found'})
        } catch (error) {return json(res, 400, {error: probeRequestReason(error)})}
      })
    }

    // GET/POST config share one pathname. The webserver routes by path only and
    // rejects duplicate paths, so a single handler dispatches on the method.
    register(ROUTES.get, async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })

      // GET config: redacted view for the settings page.
      if (req.method === 'GET') {
        json(res, 200, readProviderConfig(routes.config()))
        return
      }

      // POST config: persist baseURL + per-platform models; keys go to credentials.
      try {
        const body = await readJson(req)
        const save = configSaveTail.then(async () => {
        const credentials = ctx.get('credentials')
        const snapshots = new Map<CredentialRef, string | undefined>()
        const attempted: CredentialRef[] = []
        let settingsOutcome: SettingsSaveOutcome = 'not-committed'
        try {
        const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim().replace(/\/+$/, '') : ''
        const rawEndpoints = Array.isArray(body.endpoints) ? body.endpoints : undefined
        const hasEndpoints = rawEndpoints !== undefined && rawEndpoints.length > 0
        // Endpoints carry their own host, so the section-level URL is only
        // required by the legacy one-slot-per-platform shape.
        if (!hasEndpoints && baseURL.length === 0) return json(res, 400, { error: 'baseURL is required' })
        if (baseURL.length > 0 && !validConfigURL(baseURL)) return json(res, 400, { error: 'invalid baseURL' })

        // Build a fresh config instead of mutating: the settings snapshot is
        // frozen (handed out immutably by the settings service).
        const current = routes.config()
        const next: Config = {
          baseURL,
          providers: {
            openai: { ...current.providers.openai },
            claude: { ...current.providers.claude },
            grok: { ...current.providers.grok },
          },
          // Keep whatever the section already holds: a request carrying no
          // `endpoints` key (an older page) must not silently drop them.
          ...(current.endpoints !== undefined ? { endpoints: current.endpoints } : {}),
          ...(current.tools !== undefined ? { tools: { ...current.tools } } : {}),
        }

        const rawProviders = typeof body.providers === 'object' && body.providers !== null
          ? body.providers as Record<string, unknown>
          : {}
        const writes = new Map<CredentialRef, string>()
        const addKey = (ref: string, apiKey: string): boolean => {
          if (!validConfigRef(ref)) return false
          let value: string
          try { value = assertUsableApiKey(apiKey, 'llm-sub2api', ref) } catch { return false }
          if (writes.has(ref) && writes.get(ref) !== value) return false
          writes.set(ref, value)
          return true
        }

        for (const def of PROVIDERS) {
          const raw = rawProviders[def.key] as Record<string, unknown> | undefined
          const profile = next.providers[def.key]
          const apiKey = typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : ''
          if (apiKey.length > 0) {
            const ref = profile.apiKeyEnv ?? providerCredentialRef(def.key)
            if (!addKey(ref, apiKey)) return json(res, 400, { error: 'invalid Key or conflicting credential reference' })
            profile.apiKeyEnv = ref
          }
          // Wire protocol: empty string clears an explicit override (the
          // group's native protocol applies); a valid name sets one.
          const api = typeof raw?.api === 'string' ? raw.api.trim() : undefined
          if (api !== undefined) {
            if (api.length === 0) {
              delete profile.api
            } else if ((API_PROTOCOLS as readonly string[]).includes(api)) {
              profile.api = api as ApiProtocol
            } else {
              return json(res, 400, { error: 'invalid provider protocol' })
            }
          }
          profile.models = readCatalogModels(raw?.models, profile.models ?? [])
        }

        // Reserve retained and explicit refs before allocating any new endpoint ref.
        const reserved: ProviderEndpoint[] = [
          ...(current.endpoints ?? []),
          ...PROVIDERS.flatMap((def) => {
            const ref = next.providers[def.key].apiKeyEnv
            return ref === undefined ? [] : [{ platform: def.key, apiKeyEnv: ref }]
          }),
          ...(rawEndpoints ?? []).flatMap((entry) => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
            const ref = (entry as Record<string, unknown>).apiKeyEnv
            return typeof ref === 'string' && ref.trim().length > 0 ? [{ platform: 'openai' as const, apiKeyEnv: ref.trim() }] : []
          }),
        ]
        if (rawEndpoints !== undefined) {
          const parsed: ProviderEndpoint[] = []
          for (const entry of rawEndpoints) {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return json(res, 400, { error: 'invalid endpoint' })
            const raw = entry as Record<string, unknown>
            const platform = typeof raw.platform === 'string' && isProviderKey(raw.platform) ? raw.platform : undefined
            const name = typeof raw.name === 'string' ? raw.name.trim() : ''
            if (platform === undefined) {
              return json(res, 400, { error: 'invalid endpoint platform' })
            }
            const host = typeof raw.baseURL === 'string' ? raw.baseURL.trim().replace(/\/+$/, '') : ''
            if (!validConfigURL(host || baseURL)) {
              return json(res, 400, { error: 'invalid endpoint URL' })
            }
            // Wire protocol: empty string clears an explicit override (the
            // platform's native protocol applies); a valid name sets one.
            let api: ApiProtocol | undefined
            const rawApi = typeof raw.api === 'string' ? raw.api.trim() : undefined
            if (rawApi !== undefined) {
              if ((API_PROTOCOLS as readonly string[]).includes(rawApi)) api = rawApi as ApiProtocol
              else if (rawApi.length > 0) {
                return json(res, 400, { error: 'invalid endpoint protocol' })
              }
            }
            // A stored `apiKeyEnv` is echoed back by the page: keeping it means
            // renaming an endpoint does not orphan the key already saved under
            // the old reference.
            const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
            let apiKeyEnv = typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : ''
            if (apiKey.length > 0) {
              if (apiKeyEnv.length === 0) apiKeyEnv = endpointCredentialRef(platform, name, [...reserved, ...parsed])
              if (!addKey(apiKeyEnv, apiKey)) return json(res, 400, { error: 'invalid Key or conflicting credential reference' })
            }
            // Rows arrive in page order, so the previous entry at this index
            // supplies the catalog when the request omits one.
            const previous = current.endpoints?.[parsed.length]
            // Route-level stream idle timeout, bounded like the settings schema:
            // a value the host would reject must not survive a settings round
            // trip, so anything unusable is dropped rather than stored.
            const rawTimeout = raw.streamIdleTimeoutMs
            const streamIdleTimeoutMs = typeof rawTimeout === 'number'
              && Number.isSafeInteger(rawTimeout)
              && rawTimeout > 0
              && rawTimeout <= MAX_STREAM_IDLE_TIMEOUT_MS
              ? rawTimeout
              : undefined
            parsed.push({
              ...(name.length > 0 ? { name } : {}),
              ...(host.length > 0 ? { baseURL: host } : {}),
              platform,
              ...(apiKeyEnv.length > 0 ? { apiKeyEnv } : {}),
              ...(api !== undefined ? { api } : {}),
              models: readCatalogModels(raw.models, previous?.models ?? []),
              ...(streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs } : {}),
            })
          }
          next.endpoints = parsed
        }

        const tools = readImageTools(body.tools, current.tools)
        if (tools !== undefined) next.tools = tools
        else delete next.tools

        if (!PROVIDERS.every((def) => validSavedProfile(next.providers[def.key]))) {
          return json(res, 400, { error: 'invalid retained provider configuration' })
        }
        for (const entry of next.endpoints ?? []) {
          if (!isProviderKey(entry.platform) || !validSavedProfile(entry) || !validConfigURL(entry.baseURL || baseURL)) {
            return json(res, 400, { error: 'invalid retained endpoint configuration' })
          }
        }
        const commit = routes.prepareConfig === undefined ? () => routes.setConfig(next) : await routes.prepareConfig(next)
        if (writes.size > 0) {
          if (credentials === undefined || ['describe', 'resolve', 'set', 'unset'].some((method) => typeof Reflect.get(credentials, method) !== 'function')) {
            return json(res, 503, { error: 'credential save service unavailable' })
          }
          for (const ref of writes.keys()) {
            const state = await credentials.describe(ref)
            const hit = await credentials.resolve(ref)
            if (state.writable !== true || state.source === 'env' || hit?.source === 'env') {
              return json(res, 400, { error: 'credential reference is not writable' })
            }
            if (typeof state.configured !== 'boolean' || state.configured !== (hit !== undefined)
              || state.source !== hit?.source || (hit !== undefined && (typeof hit.value !== 'string' || hit.value.length === 0))) {
              throw new ConfigSaveError('not-committed')
            }
            snapshots.set(ref, hit?.source === 'file' ? hit.value : undefined)
          }
          for (const [ref, value] of writes) {
            // Host notifications can throw after the credential was durably written.
            attempted.push(ref)
            await credentials.set(ref, value)
          }
        }
        settingsOutcome = 'unknown'
        await commit()
        settingsOutcome = 'committed'
        json(res, 200, { ok: true, ...readProviderConfig(next), routes: routes.listRegisteredRoutes() })
      } catch (error) {
        if (settingsOutcome !== 'committed' && error instanceof ConfigSaveError) settingsOutcome = error.outcome
        let credentialOutcome = attempted.length === 0 ? 'unchanged' : 'preserved'
        if (settingsOutcome === 'not-committed' && attempted.length > 0) {
          credentialOutcome = 'restored'
          for (const ref of attempted.reverse()) {
            try {
              const value = snapshots.get(ref)
              if (value === undefined) await credentials!.unset(ref)
              else await credentials!.set(ref, value)
            } catch { credentialOutcome = 'restore-incomplete' }
          }
        }
        const message = settingsOutcome === 'unknown'
          ? '保存结果无法确认，Key 可能已写入且未回滚；请重新加载配置后再重试。'
          : settingsOutcome === 'committed'
            ? '配置已提交，但保存结果未能完整返回；Key 已保留，请重新加载确认。'
            : credentialOutcome === 'restore-incomplete'
              ? '配置未提交，但部分 Key 未能恢复；请重新加载并检查后再重试。'
              : '配置未提交，Key 已恢复或未写入；请检查配置后再重试。'
        json(res, 500, { error: message, settingsOutcome, credentialOutcome })
      }
        })
        configSaveTail = save.then(() => undefined, () => undefined)
        await save
      } catch {
        json(res, 500, { error: 'configuration save unavailable' })
      }
    })

    // POST discover: GET {baseURL}/models. A freshly typed key wins; without
    // one the stored credential for the provider is used.
    register(ROUTES.discover, async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
      try {
        const body = await readJson(req)
        const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim().replace(/\/+$/, '') : ''
        const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
        if (baseURL.length === 0) return json(res, 400, { error: 'baseURL is required' })
        let apiKey: string
        try {
          apiKey = await resolveProbeKey(ctx, routes, provider, typeof body.apiKey === 'string' ? body.apiKey.trim() : '', typeof body.apiKeyEnv === 'string' ? body.apiKeyEnv.trim() : undefined)
        } catch (error) {
          return json(res, 400, { error: safeMessage(error) })
        }
        const response = await fetch(`${gatewayApiRoot(baseURL)}/models`, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          return json(res, response.status, { error: `HTTP ${response.status}: ${text.slice(0, 300)}` })
        }
        const payload = await response.json() as { data?: Array<{ id?: unknown; display_name?: unknown; name?: unknown }> }
        const models = Array.isArray(payload.data)
          ? payload.data
            .map((m) => ({
              id: typeof m.id === 'string' ? m.id : '',
              name: typeof m.display_name === 'string' ? m.display_name : typeof m.name === 'string' ? m.name : undefined,
            }))
            .filter((m) => m.id.length > 0)
          : []
        json(res, 200, { ok: true, models })
      } catch (error) {
        json(res, 500, { error: safeMessage(error) })
      }
    })

    // POST usage: GET {baseURL}/usage. Same key fallback as discovery.
    register(ROUTES.usage, async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
      try {
        const body = await readJson(req)
        const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim().replace(/\/+$/, '') : ''
        const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
        if (baseURL.length === 0) return json(res, 400, { error: 'baseURL is required' })
        let apiKey: string
        try {
          apiKey = await resolveProbeKey(ctx, routes, provider, typeof body.apiKey === 'string' ? body.apiKey.trim() : '', typeof body.apiKeyEnv === 'string' ? body.apiKeyEnv.trim() : undefined)
        } catch (error) {
          return json(res, 400, { error: safeMessage(error) })
        }
        const response = await fetch(`${gatewayApiRoot(baseURL)}/usage`, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(30000),
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          return json(res, response.status, { error: `HTTP ${response.status}: ${text.slice(0, 300)}` })
        }
        const payload = await response.json() as Record<string, unknown>
        const parts: string[] = []
        const quota = payload.quota as Record<string, unknown> | undefined
        if (quota !== undefined && typeof quota.limit === 'number') {
          parts.push(`配额 ${String(quota.used ?? 0)}/${quota.limit}${typeof quota.unit === 'string' ? ` ${quota.unit}` : ''}（剩余 ${String(quota.remaining ?? 0)}）`)
        } else if (typeof payload.balance === 'number') {
          parts.push(`余额 $${payload.balance}`)
        } else if (typeof payload.remaining === 'number') {
          parts.push(`剩余 ${payload.remaining}${typeof payload.unit === 'string' ? ` ${payload.unit}` : ' USD'}`)
        }
        if (typeof payload.planName === 'string') parts.push(`分组: ${payload.planName}`)
        if (typeof payload.mode === 'string') parts.push(`模式: ${payload.mode}`)
        if (typeof payload.status === 'string') parts.push(`状态: ${payload.status}`)
        if (Array.isArray(payload.rate_limits)) {
          parts.push(`限流: ${(payload.rate_limits as Array<{ window?: unknown; used?: unknown; limit?: unknown }>)
            .map((r) => `${String(r.window ?? '')} ${String(r.used ?? 0)}/${String(r.limit ?? 0)}`).join(', ')}`)
        }
        const sub = payload.subscription as Record<string, unknown> | undefined
        if (sub !== undefined) {
          parts.push(`订阅日/周/月: ${[sub.daily_usage_usd, sub.weekly_usage_usd, sub.monthly_usage_usd]
            .map((v) => typeof v === 'number' ? `$${v}` : '-').join(' / ')}`)
        }
        json(res, 200, { ok: true, summary: parts.length > 0 ? parts.join('；') : '该 key 无配额/余额信息（unrestricted 模式）' })
      } catch (error) {
        json(res, 500, { error: safeMessage(error) })
      }
    })

    // GET status: registered routes + models per route.
    register(ROUTES.status, async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
      const config = routes.config()
      const models: Record<string, string[]> = {}
      const list = config.endpoints ?? []
      if (list.length > 0) {
        for (const endpoint of list) {
          if (endpoint.apiKeyEnv === undefined) continue
          models[endpointRoute(endpoint, list)] = endpoint.models?.map((m) => m.id) ?? []
        }
      } else {
        for (const def of PROVIDERS) {
          if (config.providers[def.key].apiKeyEnv !== undefined) {
            models[def.route] = config.providers[def.key].models?.map((m) => m.id) ?? []
          }
        }
      }
      json(res, 200, { routes: routes.listRegisteredRoutes(), models })
    })

    // GET attachment: serve one durable image attachment as raw bytes so the
    // generate_image tool card can render it inline (<img src>). The request
    // carries the full ImageAttachmentRef (base64url JSON in `ref`); the
    // attachment store re-verifies the digest against the stored object, so a
    // forged ref cannot read anything — the id must match the bytes exactly.
    // Bound to trusted local origins like every other plugin route.
    webCtx.webServer.register({ kind: 'prefix', path: ROUTES.attachment, handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden' })
      let ref: ImageAttachmentRef
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        const raw = url.searchParams.get('ref') ?? ''
        if (raw.length === 0) return json(res, 400, { error: 'ref is required' })
        const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null) throw new Error('ref must be an object')
        const candidate = parsed as Record<string, unknown>
        if (typeof candidate.attachmentId !== 'string' || typeof candidate.mediaType !== 'string') throw new Error('ref is incomplete')
        ref = candidate as unknown as ImageAttachmentRef
      } catch {
        return json(res, 400, { error: 'invalid ref' })
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) return json(res, 503, { error: 'attachment service unavailable' })
      try {
        const stored = await attachments.readImage(ref)
        res.writeHead(200, {
          'content-type': stored.ref.mediaType,
          'cache-control': 'private, max-age=86400',
          'x-content-type-options': 'nosniff',
        })
        res.end(Buffer.from(stored.data))
      } catch {
        json(res, 404, { error: 'attachment not found' })
      }
    } })
  })
}
