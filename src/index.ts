/**
 * Sub2API gateway integration for the harness LLM seam.
 *
 * One OpenAI-compatible base URL, many provider routes. In the sub2api
 * gateway each API key is bound to a group, and the group decides the
 * platform (openai / anthropic / grok) and the model list the key
 * can serve.
 *
 * The LLM routes this plugin used to own (`sub2api-openai` / `sub2api-claude`
 * / `sub2api-grok`) are served by the harness's own pi-ai
 * adapter (`dsh-llm-pi-ai`, mounted dormant by dsh-base): protocol
 * serialization, streaming, usage mapping, replay, and retry handling all live
 * in pi-ai, which speaks each platform's native wire protocol upstream (OpenAI
 * → Responses API, Claude → Messages API, the rest → chat/completions).
 * This plugin contributes the sub2api-specific surface on top: the
 * `llm-sub2api:` settings section and its web page (baseURL + per-key model
 * catalogs + keys), gateway model discovery and usage probes, the global
 * image-generation tools, and a bridge
 * that materializes the configured groups as `llm-pi-ai:` provider profiles
 * the moment the section lands (see `./pi-ai.ts`).
 *
 * Keys are stored through the harness credential seam; the base URL and
 * per-key model catalogs live in the `llm-sub2api:` settings section
 * (persisted by the harness into the active profile, written by the web Models
 * page).
 *
 * @module dsh-sub2api
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import {
  LlmError,
  assertUsableApiKey,
} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
// The loader owns the `loader/volatile-update` event; importing its types is
// what adds that event to cordis's Events map. Type-only, so it erases.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { ConfigSaveError, registerRoutes } from './routes.ts'
import { registerImageTools } from './image-tools.ts'
import { registerWebSearchProvider } from './web-search.ts'
import { syncPiAiProfiles } from './pi-ai.ts'
import { applyPiAiMultiTurnPatch } from './pi-ai-patch.ts'

export {
  PI_AI_NS,
  ROUTE_PREFIX,
  syncPiAiProfiles,
  translateToPiAi,
  type PiAiModelProfile,
  type PiAiProviderProfile,
  type PiAiSettingsSection,
} from './pi-ai.ts'
export { applyPiAiMultiTurnPatch, type PiAiPatchResult } from './pi-ai-patch.ts'

export const name = 'llm-sub2api'
export const inject: string[] = ['llm', 'settings', 'credentials']

const NS = 'llm-sub2api'

/** Context capacity assumed for a model neither configuration nor discovery sizes. */
export const DEFAULT_CONTEXT_WINDOW = 128000
/** Output capability assumed for a model neither configuration nor discovery sizes. */
export const DEFAULT_MAX_TOKENS = 8192

/**
 * Reasoning effort levels exposed for reasoning-capable models. The gateway
 * speaks the OpenAI chat-completions protocol, so the ids are the OpenAI
 * `reasoning_effort` vocabulary and are sent through verbatim. Per-model
 * configuration (filled from models.dev `reasoning_options`) may expose
 * additional vocabulary such as `none`, `xhigh`, or `max`.
 */
export const REASONING_EFFORTS: readonly { id: string; name: string }[] = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
]

export type ProviderKey = 'openai' | 'claude' | 'grok'

export interface ProviderDef {
  key: ProviderKey
  route: string
  label: string
  icon: string
}

/** The provider routes this plugin owns, keyed by sub2api platform name. */
export const PROVIDERS: readonly ProviderDef[] = [
  { key: 'openai', route: 'sub2api-openai', label: 'OpenAI', icon: 'openai' },
  { key: 'claude', route: 'sub2api-claude', label: 'Claude', icon: 'claude' },
  { key: 'grok', route: 'sub2api-grok', label: 'Grok', icon: 'grok' },
]

/**
 * How a model's reasoning levels reach an `anthropic-messages` gateway.
 *
 * `adaptive` (the default) is what current Claude deployments require: the
 * request sends `thinking:{type:"adaptive"}` and the selected level travels as
 * `output_config.effort`. `budget` restores the fixed-budget shape
 * (`thinking:{type:"enabled",budget_tokens:N}`) that older deployments and
 * gateways still expect. OpenAI-style protocols carry the level as
 * `reasoning_effort` / `reasoning.effort`, so they ignore this field.
 */
export type ThinkingMode = 'adaptive' | 'budget'

/**
 * Upper bound the host accepts for one stream-idle timeout, mirroring
 * `MAX_TIMER_DELAY_MS` of `@deepseek-ai/dsh-timeout`. llm-pi-ai rejects a
 * larger `streamIdleTimeoutMs` when the translated provider profile is loaded,
 * so the settings schema clamps it here instead of failing at runtime.
 */
export const MAX_STREAM_IDLE_TIMEOUT_MS: number = 2_147_483_647

/**
 * Default stream idle timeout used by the host when a model does not set one
 * (`DEFAULT_STREAM_IDLE_TIMEOUT_MS` in `@deepseek-ai/dsh-llm-pi-ai`: 300000 ms
 * = 5 minutes). Kept here only for documentation and tests.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS: number = 300_000

export interface CatalogModel {
  /** Model id sent to the provider and accepted by {@link GenerateOptions.model}. */
  id: string
  /** Display name for selectors; defaults to the id. */
  name?: string
  /** Maximum combined request and response context in tokens. */
  contextWindow?: number
  /** Maximum output tokens. */
  maxTokens?: number
  /**
   * Accepted request modalities. Absent or empty: the adapter guesses from
   * the model id (multimodal families such as gpt/claude/gemini/grok/glm
   * declare `[text, image]`, everything else stays `[text]`). Non-empty:
   * exactly those modalities, e.g. `[text]` to pin a multimodal-looking
   * model to text only.
   */
  input?: Array<'text' | 'image'>
  /**
   * Reasoning effort levels selectable for this model. Absent: every non-image
   * model on any route exposes low/medium/high (the gateway is OpenAI-compatible
   * on all routes). Empty array: reasoning effort is explicitly off for this
   * model. Non-empty: exposes exactly those levels verbatim (e.g. models.dev
   * vocabularies such as `xhigh`/`max`/`none`).
   */
  reasoningEfforts?: string[]
  /**
   * Thinking dispatch this model's levels use on an `anthropic-messages` route.
   * Absent: `adaptive` (see {@link ThinkingMode}). Set `budget` only for a
   * gateway that still rejects adaptive thinking. Ignored on OpenAI-style
   * routes, which carry the level themselves.
   */
  thinkingMode?: ThinkingMode
}

export interface ProviderProfile {
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
  apiKeyEnv?: string
  /**
   * Wire protocol spoken to the gateway for this platform group. Absent
   * selects the group's native protocol (openai → responses, claude →
   * messages, grok → chat/completions). Explicitly name a protocol to
   * force a different endpoint, e.g. a gateway that serves a group through
   * chat/completions after all.
   */
  api?: ApiProtocol
  /** Advisory model catalog for this route. */
  models?: CatalogModel[]
}

/**
 * One independently-keyed sub2api endpoint.
 *
 * The shipped layout is one fixed slot per platform, which caps a user at a
 * single gateway per platform: a second gateway — or a second group key on the
 * same gateway — has nowhere to go. An endpoint list removes that cap. Every
 * entry carries its own host and its own key; `platform` only decides which
 * native wire protocol the entry speaks, because the gateway still serves
 * openai groups through the Responses API and claude groups through Messages.
 */
export interface ProviderEndpoint {
  /** Optional label; names the route and titles the settings-page row. */
  name?: string
  /** This entry's own gateway host. Absent falls back to the section `baseURL`. */
  baseURL?: string
  /** Sub2api platform group this key belongs to; decides the native protocol. */
  platform: ProviderKey
  /** Credential reference holding this entry's key. */
  apiKeyEnv?: string
  /** Wire-protocol override for this entry. */
  api?: ApiProtocol
  /** Advisory model catalog for this entry. */
  models?: CatalogModel[]
  /**
   * Override of the host's stream idle timeout for this route, in milliseconds.
   * Absent keeps the host default ({@link DEFAULT_STREAM_IDLE_TIMEOUT_MS},
   * 5 minutes): a route that stalls longer than that between stream chunks (a
   * long thinking turn, a loaded proxy) is aborted as an idle timeout, and
   * raising this value is the only way to keep such a request alive without
   * changing host settings.
   *
   * Route-level on purpose: llm-pi-ai reads `streamIdleTimeoutMs` from the
   * provider profile (`PiAiProviderProfile`, not `PiAiModelProfile`), so one
   * endpoint carries one value; per-model entries would be ignored by the host.
   * Bounded by {@link MAX_STREAM_IDLE_TIMEOUT_MS}.
   */
  streamIdleTimeoutMs?: number
}

/** One dedicated model used by a global image tool, independent of the chat route. */
export interface ImageToolModelRef {
  /** Sub2API platform that owns the key and catalog (`openai` / `claude` / `grok`). */
  provider: string
  /** Model id sent to the gateway. */
  model: string
  /**
   * Opt-in compatibility switch: also register the legacy `generate_image`
   * name, but only while that name is still free. Off by default, so this
   * plugin never competes with another image plugin for the plain name.
   * Toggling it changes what the next plugin load registers — it is not a hot
   * switch.
   */
  compatToolName?: boolean
}

export interface ImageToolsConfig {
  /** Image-generation model used by the global `sub2api_generate_image` tool. */
  generate?: ImageToolModelRef
  /** Gateway-backed candidate for the host's global `web_search` tool. */
  webSearch?: WebSearchToolConfig
}

/**
 * Opt-in switch for the gateway-backed search candidate.
 *
 * It stays off by default and must name both a route and a model before the
 * provider reports itself available: the host refuses to pick between two
 * available search providers (`WEB_PROVIDER_AMBIGUOUS`), so a candidate that
 * announced itself while the user has not asked for it would break the search
 * setup that already works.
 */
export interface WebSearchToolConfig {
  /** Explicit opt-in; while this is not `true` the provider stays unavailable. */
  enabled?: boolean
  /** Route id of the endpoint that serves the search request. */
  provider?: string
  /** Model id sent with the search request. */
  model?: string
}

export interface Config {
  /** OpenAI-compatible gateway base URL, e.g. http://localhost:8080/v1. */
  baseURL: string
  /** Per-platform provider profiles keyed by sub2api platform name. */
  providers: Record<ProviderKey, ProviderProfile>
  /**
   * Independently-keyed endpoints. A non-empty list is the sole source of chat
   * routes; {@link providers} then stays untouched as the legacy shape, so a
   * section written by an older build keeps working. Absent or empty keeps the
   * original one-slot-per-platform behaviour.
   */
  endpoints?: ProviderEndpoint[]
  /** Dedicated models for the global image-generation tools. */
  tools?: ImageToolsConfig
}

/**
 * A live configuration cell. DSH 0.2's loader hands each `volatile()` schema
 * field to `apply` as one of these frozen references instead of a plain value:
 * it keeps the object identity and re-points the value in place when the
 * configuration changes, then emits `loader/volatile-update` on this plugin's
 * own context. Reading `.get()` is also what subscribes the plugin to that
 * event — the loader only notifies plugins whose resolved config carries the
 * references it collected.
 */
export interface Volatile<T> {
  get(): T
}

/** Runtime brand cosmokit's `createVolatile` stamps onto a live cell. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * The configuration `apply` receives. Every field declared volatile in
 * {@link Config} arrives as a {@link Volatile} cell; fields are optional
 * because a section that never stored a value still resolves — an unset
 * `baseURL` is a live cell holding `undefined`.
 */
export interface ConfigInput {
  baseURL?: Volatile<string | undefined>
  providers?: Volatile<Record<ProviderKey, ProviderProfile>>
  endpoints?: Volatile<ProviderEndpoint[]>
  tools?: Volatile<ImageToolsConfig>
}

/**
 * Read one configuration cell. The loader always supplies a volatile
 * reference for a volatile schema field, but test fixtures call `apply` with
 * plain literals, so both shapes are accepted.
 */
export function readVolatile<T>(value: Volatile<T> | T | undefined): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && VOLATILE_WRITE in value) return (value as Volatile<T>).get()
  return value as T
}

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  // Default to an empty list so the settings normalization never fills a
  // fabricated value: an empty/absent `input` means "auto" (the adapter
  // guesses modalities from the model id).
  input: z.array(z.union([z.const('text'), z.const('image')])).default([]),
  // The settings layer normalizes every section through this schema, and an
  // absent optional array would otherwise be filled with an empty array —
  // silently turning reasoning off for every unconfigured model. Default the
  // field to the full OpenAI effort vocabulary so a model without explicit
  // configuration exposes low/medium/high (image models are excluded at
  // resolve time); an explicit empty array still opts the model out.
  reasoningEfforts: z.array(z.string()).default(REASONING_EFFORTS.map((effort) => effort.id)),
  // Absent keeps the adaptive dispatch that anthropic routes default to; only
  // an explicit 'budget' asks for the fixed-budget thinking shape.
  thinkingMode: z.union([z.const('adaptive'), z.const('budget')]),
})

const apiProtocol = z.union([
  z.const('openai-completions'),
  z.const('openai-responses'),
  z.const('anthropic-messages'),
])

const providerProfile = z.object({
  apiKeyEnv: z.string().role('credential-ref'),
  api: apiProtocol,
  models: z.array(catalogModel),
})

/**
 * One endpoint entry. `platform` is required: the wire protocol cannot be
 * guessed from a host, and a wrong guess sends an Anthropic key to an OpenAI
 * endpoint. `name` and `baseURL` stay optional so an unnamed entry on the
 * section's default host still resolves to the legacy route id.
 */
const providerEndpoint = z.object({
  name: z.string(),
  baseURL: z.string(),
  platform: z.union([z.const('openai'), z.const('claude'), z.const('grok')]),
  apiKeyEnv: z.string().role('credential-ref'),
  api: apiProtocol,
  models: z.array(catalogModel),
  // Route-level (llm-pi-ai reads it from the provider profile), and
  // deliberately without a default: the loader normalizes every section through
  // this schema, and a materialized value would be written back on the next
  // save as a timeout the user never chose. While unset, llm-pi-ai applies its
  // own default (300000 ms).
  streamIdleTimeoutMs: z.number().step(1).min(1).max(MAX_STREAM_IDLE_TIMEOUT_MS),
})

// Keep these fields optional strings. The settings layer fills absent
// objects, and a required union here would reject a still-empty tools
// section (or silently coerce it) before the user picks a model.
const imageToolModelRef = z.object({
  provider: z.string(),
  model: z.string(),
  // Optional compatibility switch: absent means "off" (see ImageToolModelRef).
  compatToolName: z.boolean(),
})

// Same reasoning as above: every field stays optional so an enabled-but-unfilled
// section still saves. The provider itself treats a half-filled section as
// "not available" instead of failing the save.
const webSearchToolConfig = z.object({
  enabled: z.boolean(),
  provider: z.string(),
  model: z.string(),
})

/**
 * Runtime schema for {@link Config}. Every field is volatile: DSH 0.2 dropped
 * `settings.installSection`, so the section is declared here and the loader
 * hands the plugin live references to these fields instead. A volatile node
 * must not enclose another one, and marking the whole object would hand `apply`
 * a single opaque cell — so the four fields are marked individually and the
 * structure stays addressable.
 *
 * Volatility is also what makes the section writable: the settings service
 * refuses any write to a path that does not sit beneath a declared volatile
 * node.
 *
 * Resolved values are live cells, not plain values, so the annotation names
 * {@link ConfigInput} rather than the pre-volatility `Config` that `apply` used
 * to receive. tsdown's declaration emit also requires an explicit annotation on
 * every exported value. The value is asserted to that annotation rather than
 * checked against it: schemastery resolves a volatile field through
 * `NoInfer`-wrapped generics whose concrete shape (readonly members, index
 * signatures, an `| undefined` inside each nested object) is not something a
 * hand-written interface can equal, while `apply` still consumes exactly
 * {@link ConfigInput}.
 */
export const Config: z<ConfigInput> = z.object({
  baseURL: z.string().volatile(),
  providers: z.object({
    openai: providerProfile,
    claude: providerProfile,
    grok: providerProfile,
  }).volatile(),
  endpoints: z.array(providerEndpoint).volatile(),
  tools: z.object({
    generate: imageToolModelRef,
    webSearch: webSearchToolConfig,
  }).volatile(),
}) as unknown as z<ConfigInput>

/**
 * Wire protocol the adapter speaks to the gateway for one route. Each value
 * names a real endpoint: `openai-completions` → `/chat/completions`,
 * `openai-responses` → `/responses`, `anthropic-messages` → `/messages`.
 */
export type ApiProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export const API_PROTOCOLS: readonly ApiProtocol[] = ['openai-completions', 'openai-responses', 'anthropic-messages']

/**
 * The wire protocol each sub2api platform group speaks natively at the
 * gateway. Openai groups are served upstream through the Responses API and
 * Claude groups through the Messages API; grok groups are
 * chat-completions. Speaking the native protocol avoids the gateway's
 * chat/completions ↔ native conversion, which drops/misaligns tool-call
 * names and ids for parallel calls. A provider profile may override.
 */
const DEFAULT_PROTOCOL: Record<ProviderKey, ApiProtocol> = {
  openai: 'openai-responses',
  claude: 'anthropic-messages',
  grok: 'openai-completions',
}

/** Resolve the wire protocol for one provider key; shared by chat routes and the global image tools. */
export function apiProtocolForKey(key: ProviderKey, profile: ProviderProfile): ApiProtocol {
  return profile.api ?? DEFAULT_PROTOCOL[key]
}

/**
 * The OpenAI-style API root for a gateway base URL. The Sub2API settings page
 * stores the bare host (e.g. `https://gateway.example:6443`); OpenAI-compatible
 * endpoints (`/responses`, `/chat/completions`, `/models`, `/usage`) live under
 * the `/v1` root, so it is appended here when missing. A URL already carrying
 * `/v1` passes through unchanged.
 */
export function gatewayApiRoot(baseURL: string): string {
  const cleaned = (baseURL ?? '').trim().replace(/\/+$/, '')
  if (cleaned.length === 0) return ''
  return /\/v1$/i.test(cleaned) ? cleaned : `${cleaned}/v1`
}

/**
 * The bare-host form the Anthropic SDK expects: `@anthropic-ai/sdk` treats the
 * configured URL as the host and always appends `/v1/messages` itself, so a
 * `/v1`-rooted URL would hit `/v1/v1/messages` (404). Strips a trailing `/v1`
 * when present.
 */
export function gatewayAnthropicRoot(baseURL: string): string {
  return gatewayApiRoot(baseURL).replace(/\/v1$/i, '')
}

function resolveAdapterOptions(config: Config) {
  const baseURL = (config.baseURL ?? '').trim().replace(/\/+$/, '')
  // An empty baseURL means "not configured yet": boot dormant and let the
  // settings scope (or setConfig) supply the URL later. Only validate the
  // scheme once a URL is actually present.
  if (baseURL.length > 0 && !/^https?:\/\//.test(baseURL)) {
    throw new Error('llm-sub2api: baseURL must start with http(s)://')
  }
  return { baseURL }
}

const EMPTY_PROVIDER: ProviderProfile = {}

/** Provider map used until settings (or setConfig) provide real values. */
function defaultProviders(): Record<ProviderKey, ProviderProfile> {
  return { openai: EMPTY_PROVIDER, claude: EMPTY_PROVIDER, grok: EMPTY_PROVIDER }
}

/** Validate the host's editable form without attempting a profile write. */
export async function prepareConfigSave(ctx: Context, next: Config): Promise<() => Promise<void>> {
  const settings = ctx.get('settings')
  if (settings === undefined || typeof settings.describe !== 'function' || typeof settings.replace !== 'function') {
    throw new ConfigSaveError('not-committed')
  }
  // Cordis creates a new tracing proxy on each get; provider identity is its original service.
  const original = Symbol.for('cordis.original')
  const settingsIdentity = Reflect.get(settings, original) ?? settings
  const preflight = () => {
    const entries = settings.describe({ redactSecrets: true }).filter((entry) => entry.ns === NS)
    if (entries.length !== 1) throw new ConfigSaveError('not-committed')
    const entry = entries[0]!
    if (entry.applies !== 'live' || !Number.isSafeInteger(entry.revision) || entry.revision < 0) {
      throw new ConfigSaveError('not-committed')
    }
    if (typeof entry.schema !== 'object' || entry.schema === null || Array.isArray(entry.schema)) {
      throw new ConfigSaveError('not-committed')
    }
    const form = new z(entry.schema)
    if (form.type !== 'object' || Object.keys(next).some((key) => form.dict?.[key] === undefined)) {
      throw new ConfigSaveError('not-committed')
    }
    form(next)
    return entry.revision
  }
  let revision: number
  try { revision = preflight() } catch { throw new ConfigSaveError('not-committed') }
  return async () => {
    try {
      const currentSettings = ctx.get('settings')
      const currentIdentity = currentSettings === undefined ? undefined : Reflect.get(currentSettings, original) ?? currentSettings
      if (currentIdentity !== settingsIdentity || preflight() !== revision) throw new ConfigSaveError('not-committed')
    } catch { throw new ConfigSaveError('not-committed') }
    try {
      await settings.replace(NS, next, revision)
    } catch {
      // replace can reject after its durable write or a failed host compensation.
      throw new ConfigSaveError('unknown')
    }
  }
}

export function apply(ctx: Context, config: ConfigInput): void {
  // The loader may start this plugin before any `llm-sub2api:` settings exist,
  // so normalize an empty/undefined config into a dormant boot: no baseURL and
  // no provider profiles yet. The cells handed in here are live, so this reads
  // their current value on every call instead of snapshotting once at mount.
  const current = (): Config => {
    const raw = {
      baseURL: readVolatile(config?.baseURL),
      providers: readVolatile(config?.providers),
      endpoints: readVolatile(config?.endpoints),
      tools: readVolatile(config?.tools),
    }
    const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints : []
    return {
      baseURL: raw.baseURL ?? '',
      providers: { ...defaultProviders(), ...(raw.providers ?? {}) },
      ...(endpoints.length > 0 ? { endpoints } : {}),
      ...(raw.tools !== undefined ? { tools: raw.tools } : {}),
    }
  }
  const options = () => {
    const raw = current()
    return { ...raw, ...resolveAdapterOptions(raw) }
  }
  options()

  // Best-effort guard for the bundled pi-ai multi-turn defect. pi-ai modules
  // are lazy-loaded, so this runs well before any request imports estimate.js.
  const patchResult = applyPiAiMultiTurnPatch()
  if (patchResult.kind === 'patched') {
    ctx.logger.info(`llm-sub2api: applied pi-ai multi-turn guard to ${patchResult.file}`)
  } else if (patchResult.kind === 'skipped') {
    ctx.logger.warn(`llm-sub2api: pi-ai multi-turn guard not applied — ${patchResult.reason}`)
  }

  const resolveApiKey = async (route: string, profile: ProviderProfile) => {
    if (profile.apiKeyEnv === undefined) {
      throw new LlmError(`sub2api: no API key configured for route "${route}"`, 'MISSING_CREDENTIAL')
    }
    const ref = credentialRef(profile.apiKeyEnv)
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined ? await credentials.resolve(ref) : undefined
    if (hit !== undefined && hit.value.length > 0) {
      return assertUsableApiKey(hit.value, 'llm-sub2api', ref)
    }
    throw new LlmError(
      `sub2api: no credential for provider route "${route}"; its profile resolves ${profile.apiKeyEnv}, which is not set — store it through the credentials service (the web Models page writes it) or export it`,
      'MISSING_CREDENTIAL',
    )
  }

  // ── pi-ai profile bridge ────────────────────────────────────────────────
  // The chat routes are owned by dsh-llm-pi-ai: every `llm-sub2api:` change
  // (and boot, see the initial sync at the end of apply) materializes the
  // configured groups as `llm-pi-ai:` provider profiles. A refused write
  // (unserviceable profile) keeps the previous routes and is logged here.
  const syncPiAi = () => {
    syncPiAiProfiles(ctx, current()).catch((error) => {
      ctx.logger.error('llm-sub2api: refused to update llm-pi-ai profiles; keeping the previously registered routes')
      ctx.logger.error(error)
    })
  }
  const prepareConfig = async (next: Config) => {
    const commit = await prepareConfigSave(ctx, next)
    return async () => {
      await commit()
      try { syncPiAi() } catch { throw new ConfigSaveError('committed') }
    }
  }

  // Settings-page HTTP bridge: read/write config, discover models, query usage.
  // `listRegisteredRoutes` reports the routes the pi-ai adapter actually
  // registered for this plugin's groups.
  registerRoutes(ctx, {
    config: () => current(),
    prepareConfig,
    setConfig: async (next) => {
      const commit = await prepareConfig(next)
      await commit()
    },
    listRegisteredRoutes: () => ctx.llm.listProviders()
      .map((info) => info.id)
      .filter((route) => route.startsWith('sub2api-')),
    resolveApiKey,
  })

  registerImageTools(ctx, {
    config: () => current(),
    resolveApiKey,
  })

  // A *candidate* into the host's web seam, not a replacement for the official
  // provider: it reports itself unavailable until the user enables it, so the
  // existing search setup keeps working untouched.
  registerWebSearchProvider(ctx, {
    config: () => current(),
    resolveApiKey,
  })

  // DSH 0.2 removed settings.installSection. The section is now declared by
  // exporting `Config` — the settings service reads the schema off this
  // plugin's fiber — and declaring it does not by itself subscribe us to
  // changes: the loader emits `loader/volatile-update` on the context of the
  // entry whose configuration changed, and only after collecting the volatile
  // references that plugin's resolved config carries. Reading the cells inside
  // `current()` during apply is what puts them in that set.
  //
  // `auto: false` suppresses the generated settings page: this plugin ships its
  // own, served over the routes registered above.
  ctx.effect(() => ctx.settings.configure({ auto: false }))

  ctx.on('loader/volatile-update', () => {
    try {
      syncPiAi()
    } catch (error) {
      ctx.logger.error('llm-sub2api: keeping the previous llm-pi-ai profiles after a refused update')
      ctx.logger.error(error)
    }
  })

  // Boot sync, deferred out of the mounting turn. Writing another entry's
  // configuration is a loader-level edit — it re-registers that entry's
  // providers — and doing it while this plugin is still mounting re-enters the
  // loader that is currently waiting for us to finish. Before 0.2 this ran from
  // installSection's first onChange, which the settings service fired only once
  // the mount had settled.
  ctx.effect(() => {
    const timer = setTimeout(() => syncPiAi(), 0)
    return () => clearTimeout(timer)
  })
}

// NOTE: no default export. The harness loader (cordis-plugin-loader
// unwrapExports) treats a module's default export as the plugin entry;
// `Config` here is the settings schema, so exporting it as default makes the
// loader boot the schema as the plugin and fails with
// "cannot get property \"baseURL\" without inject".
