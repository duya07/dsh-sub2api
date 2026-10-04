/**
 * dsh-sub2api → dsh-llm-pi-ai profile bridge.
 *
 * The LLM routes this plugin used to own (`sub2api-openai` / `sub2api-claude`
 * / `sub2api-grok`) are now served by the harness's pi-ai
 * adapter (`dsh-llm-pi-ai`, mounted dormant by dsh-base): protocol
 * serialization, streaming, usage mapping, replay, and retry handling all live
 * in pi-ai. This module is the translation layer — it turns this plugin's
 * `llm-sub2api:` settings section (gateway baseURL + per-group model catalogs
 * + keys) into `llm-pi-ai:` provider profiles and writes them through the
 * settings service, so routes register the moment the section lands and drop
 * again when a key is cleared.
 *
 * Every sub2api group is translated as a *hand-declared* route — pi-ai ships
 * no provider under these keys — with `api` naming the group's native wire
 * protocol (openai→responses, claude→messages, grok→chat-completions),
 * `baseURL` set to the shared gateway, and `models` carrying the configured
 * catalog with each model's capacity, modalities, and reasoning levels mapped
 * onto pi-ai's vocabulary (`none` becomes `off` with wire spelling `none`).
 *
 * @module dsh-sub2api/pi-ai
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
// The section schema, as a value: the bridge stores profiles through it so that
// what it compares against a read-back is exactly what the settings service
// keeps — every defaulted field filled in.
import { Config as PiAiSectionSchema } from '@deepseek-ai/dsh-llm-pi-ai'
import type { CatalogModel, Config, ProviderEndpoint, ProviderKey, ProviderProfile } from './index.ts'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  PROVIDERS,
  apiProtocolForKey,
  gatewayAnthropicRoot,
  gatewayApiRoot,
} from './index.ts'

/** The settings namespace owned by dsh-llm-pi-ai. */
export const PI_AI_NS = 'llm-pi-ai'

/** Route prefix this plugin's groups own in the llm-pi-ai profile dict. */
export const ROUTE_PREFIX: string = 'sub2api-'

/** pi-ai thinking levels a profile may declare (catalog `THINKING_LEVELS`). */
const THINKING_LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// Use the adapter's public contract so schema changes cannot silently drift.
export type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'

/** The llm-pi-ai settings section value this plugin writes. */
export interface PiAiSettingsSection {
  providers?: Record<string, PiAiProviderProfile>
}

/**
 * Request modalities a catalog model declares to the harness. An explicit
 * `input` wins; absent/empty falls back to a family guess — frontier
 * multimodal families accept images, everything else stays text-only (the
 * official harness posture: a hand-entered model is text-only until it says
 * otherwise).
 */
function catalogInputModalities(model: { id: string; input?: Array<'text' | 'image'> }): Array<'text' | 'image'> {
  if (model.input !== undefined && model.input.length > 0) return [...model.input]
  return /^(gpt|o[1-9]|claude|gemini|grok|glm|qwen|kimi|moonshot|minimax|mistral|llama|phi|command|jamba|codex|sora|veo|imagen|dall-e)/i.test(model.id)
    ? ['text', 'image']
    : ['text']
}

/**
 * Map this plugin's reasoning-effort ids (OpenAI vocabulary — `none`,
 * `xhigh`, `max`, …) onto pi-ai's level keys. `none` is not a pi-ai level; it
 * becomes `off` with wire spelling `none`, which pi-ai dispatches as
 * `reasoning_effort: "none"` (chat/completions) or `reasoning:{effort:"none"}`
 * (responses) — exactly what this plugin used to send. An empty list declares
 * a non-reasoning model; unmappable ids are dropped.
 */
function translateReasoningEfforts(model: CatalogModel): false | Partial<Record<string, string | null>> | undefined {
  const ids = model.reasoningEfforts
  if (ids === undefined) {
    // The plugin's old default: every non-image model exposes low/medium/high.
    if (/image/i.test(model.id)) return false
    return { low: 'low', medium: 'medium', high: 'high' }
  }
  if (ids.length === 0) return false
  const efforts: Record<string, string | null> = {}
  for (const id of ids) {
    if (id === 'none') efforts.off = 'none'
    else if (THINKING_LEVELS.includes(id)) efforts[id] = id
  }
  return Object.keys(efforts).length > 0 ? efforts : undefined
}

/** One configured catalog model, translated onto pi-ai's per-model fields. */
function translateModel(model: CatalogModel): PiAiModelProfile {
  const reasoningEfforts = translateReasoningEfforts(model)
  return {
    id: model.id,
    ...(model.name !== undefined && model.name.length > 0 ? { name: model.name } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    input: catalogInputModalities(model),
    ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
  }
}

/**
 * Translate one sub2api group into a hand-declared llm-pi-ai provider profile.
 * `apiKeyEnv` passes through verbatim (the harness resolves it per request
 * through `ctx.credentials`); routes without a key are skipped by the caller.
 *
 * The settings store the bare gateway host; the protocols join it differently.
 * OpenAI-compatible SDKs append their endpoint to the `/v1` API root, while
 * `@anthropic-ai/sdk` treats the given URL as the bare host and appends
 * `/v1/messages` itself — so OpenAI-style routes get the `/v1`-rooted URL and
 * the anthropic route gets the bare host.
 */
function translateProfile(key: ProviderKey, profile: ProviderProfile, baseURL: string, label: string): PiAiProviderProfile {
  const api = apiProtocolForKey(key, profile)
  return {
    ...(profile.apiKeyEnv !== undefined ? { apiKeyEnv: profile.apiKeyEnv } : {}),
    displayName: `Sub2API ${label}`,
    api,
    baseURL: api === 'anthropic-messages' ? gatewayAnthropicRoot(baseURL) : gatewayApiRoot(baseURL),
    models: (profile.models ?? []).map(translateModel),
    // Route-level fallbacks mirror the plugin's old adapter defaults, so a
    // catalog entry that omits a size keeps sizing like before.
    defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: DEFAULT_MAX_TOKENS,
    defaultInput: ['text'],
    // Sub2api acts as a proxy to upstream providers that may enforce their own
    // rate limits (HTTP 429). The default normal policy (2 retries, max 10s)
    // is too short for upstream throttling windows; raise to 5 retries / 120s
    // so transient rate limits resolve before the agent gives up.
    retryPolicy: {
      mode: 'normal',
      maxRetries: 5,
      retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
      backoff: { initialDelayMs: 1000, maxDelayMs: 120000, jitterRatio: 0.2 },
    },
  }
}

/** Display label for one platform, used when an endpoint carries no name. */
export function platformLabel(platform: ProviderKey): string {
  return PROVIDERS.find((def) => def.key === platform)?.label ?? platform
}

/**
 * Route id for one endpoint.
 *
 * Compatibility is the whole point of this function: agent presets, the
 * default-model setting and the user's own notes all name routes, so an
 * unnamed endpoint that is the only one on its platform keeps the historical
 * `sub2api-<platform>` id. A name — or a sibling on the same platform —
 * switches it to `sub2api-<platform>-<slug>`.
 */
export function endpointRoute(endpoint: ProviderEndpoint, all: readonly ProviderEndpoint[]): string {
  const siblings = all.filter((entry) => entry.platform === endpoint.platform)
  const slug = routeSlug(endpoint.name ?? '')
  if (slug.length > 0) return `${ROUTE_PREFIX}${endpoint.platform}-${slug}`
  if (siblings.length <= 1) return `${ROUTE_PREFIX}${endpoint.platform}`
  return `${ROUTE_PREFIX}${endpoint.platform}-${siblings.indexOf(endpoint) + 1}`
}

/**
 * Normalize a user-supplied endpoint name into a route id fragment. Route ids
 * travel through profile dict keys and through model ids (`<route>/<model>`),
 * so only letters (any script), digits and single dashes survive.
 */
function routeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the `llm-pi-ai` provider profile dict for every configured sub2api
 * group. A group is emitted only when it has both a key and at least one
 * model — a hand-declared pi-ai route needs a non-empty `models` list, and a
 * keyless group would otherwise surface as an unauthenticated route.
 *
 * A non-empty `endpoints` list takes over completely: each entry carries its
 * own host and key, so the legacy per-platform slots are ignored rather than
 * merged — merging would resurrect routes the user just deleted.
 */
export function translateToPiAi(config: Config): Record<string, PiAiProviderProfile> {
  const fallback = (config.baseURL ?? '').trim().replace(/\/+$/, '')
  const endpoints = config.endpoints ?? []
  if (endpoints.length > 0) return translateEndpoints(endpoints, fallback)
  if (fallback.length === 0) return {}
  const profiles: Record<string, PiAiProviderProfile> = {}
  for (const def of PROVIDERS) {
    const profile = config.providers[def.key]
    if (profile.apiKeyEnv === undefined) continue
    const models = (profile.models ?? []).filter((model) => model.id.length > 0)
    if (models.length === 0) continue
    profiles[def.route] = translateProfile(def.key, { ...profile, models }, fallback, def.label)
  }
  return profiles
}

function translateEndpoints(
  endpoints: readonly ProviderEndpoint[],
  fallback: string,
): Record<string, PiAiProviderProfile> {
  const profiles: Record<string, PiAiProviderProfile> = {}
  for (const endpoint of endpoints) {
    if (endpoint.apiKeyEnv === undefined) continue
    const host = (endpoint.baseURL ?? '').trim().replace(/\/+$/, '') || fallback
    if (host.length === 0) continue
    const models = (endpoint.models ?? []).filter((model) => model.id.length > 0)
    if (models.length === 0) continue
    const label = (endpoint.name ?? '').trim() || platformLabel(endpoint.platform)
    profiles[endpointRoute(endpoint, endpoints)] = translateProfile(endpoint.platform, endpoint, host, label)
  }
  return profiles
}

/**
 * Read the stored `llm-pi-ai` section.
 *
 * DSH 0.2 removed `Settings.get()`. The only public read path left is
 * `describe()`, which reports each loader entry's resolved config projected
 * through that entry's own schema. The projection is faithful for this section:
 * pi-ai declares `providers` as a `z.dict(...)`, which serializes as a `dict`
 * node rather than an `object`, and `projectForm` passes every non-object node
 * through untouched — so the dynamic provider keys (including routes the user
 * declared by hand on the Models page) survive the round trip. Values come back
 * with schema defaults filled in, which is what a later read sees as well, so
 * the idempotence check in the caller still matches.
 *
 * `describe()` re-stamps the entry revision and emits
 * `settings/document-updated` as a side effect; that is unavoidable on the only
 * read path, and this bridge only reads when it is about to write anyway.
 */
function readPiAiSection(settings: SettingsForms): PiAiSettingsSection | undefined {
  const described = settings.describe().find((entry) => entry.ns === PI_AI_NS)
  const value = described?.value
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  return value as PiAiSettingsSection
}

/**
 * Put a provider map through pi-ai's own schema, so that comparing it against a
 * read-back compares like with like.
 *
 * Storing a section runs it through that schema, which fills every defaulted
 * field — `defaultContextWindow`, `defaultInput`, `streamIdleTimeoutMs`, the
 * request-image budgets, and so on. A value read back therefore never equals the
 * bare literal this module builds, and comparing the two raw makes every boot
 * look like a change. Every boot would then write, and a write is a loader-level
 * edit that re-registers pi-ai's providers: the plugin and the loader would keep
 * handing the work back to each other instead of finishing startup.
 */
function normalizeProviders(providers: Record<string, PiAiProviderProfile>): Record<string, PiAiProviderProfile> {
  const resolved: unknown = PiAiSectionSchema({ providers }).providers
  if (resolved !== null && typeof resolved === 'object'
    && typeof (resolved as { get?: unknown }).get === 'function') {
    return (resolved as { get(): unknown }).get() as Record<string, PiAiProviderProfile>
  }
  return resolved as Record<string, PiAiProviderProfile>
}

/**
 * Write the translated profiles into the `llm-pi-ai` settings section. Routes
 * under this plugin's `sub2api-` prefix are replaced wholesale; any other
 * route the user configured (e.g. through the built-in Models page) is
 * preserved. The write goes through the settings service, so dsh-llm-pi-ai's
 * own validation (schema + `assertServiceable`) refuses an unserviceable
 * profile at the write site and the section keeps its last good value.
 */
export async function syncPiAiProfiles(ctx: Context, config: Config): Promise<void> {
  const settings = ctx.get('settings')
  if (settings === undefined) return
  const current = readPiAiSection(settings)
  const providers: Record<string, PiAiProviderProfile> = { ...(current?.providers ?? {}) }
  for (const route of Object.keys(providers)) {
    if (route.startsWith(ROUTE_PREFIX)) delete providers[route]
  }
  Object.assign(providers, translateToPiAi(config))
  const normalized = normalizeProviders(providers)
  const before = JSON.stringify(current?.providers ?? {})
  if (JSON.stringify(normalized) === before) return
  const next: PiAiSettingsSection = { providers: normalized }
  await settings.replace(PI_AI_NS, next)
}
