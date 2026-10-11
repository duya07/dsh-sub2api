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
import type { ApiProtocol, CatalogModel, Config, ProviderEndpoint, ProviderKey, ProviderProfile } from './index.ts'
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

/**
 * Catalog fields that never reach a pi-ai profile.
 *
 * `defaultReasoningEffort` is a per-model *preference* the host has no slot for:
 * `PiAiModelProfile` (dsh-llm-pi-ai `lib/types/catalog.d.ts`) carries no
 * per-model default, and the only default pi-ai knows is route-level
 * (`PiAiProviderProfile.reasoning`) — promoting one model's preference there
 * would change every other model on the same route. The field therefore lives in
 * the `llm-sub2api` section and in the built-in preset table only, and
 * `translateModel` leaves it out on purpose.
 *
 * `thinkingMode` is the other one: it selects the dispatch shape and is folded
 * into `compat` / `reasoningEfforts` rather than copied verbatim.
 */
export const CATALOG_ONLY_FIELDS: readonly (keyof CatalogModel)[] = ['defaultReasoningEffort', 'thinkingMode']

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
function translateReasoningEfforts(
  model: CatalogModel,
  adaptive: boolean,
): false | Partial<Record<string, string | null>> | undefined {
  const ids = model.reasoningEfforts
  if (ids === undefined) {
    // The plugin's old default: every non-image model exposes low/medium/high.
    if (/image/i.test(model.id)) return false
    return { low: 'low', medium: 'medium', high: 'high' }
  }
  if (ids.length === 0) return false
  const efforts: Record<string, string | null> = {}
  let declaresOff = false
  for (const id of ids) {
    if (id === 'none' || id === 'off') {
      // An adaptive-thinking deployment also rejects `thinking:{type:"disabled"}`,
      // so "off" has no verbatim wire spelling worth sending on an anthropic
      // route: `reasoning_effort: "none"` there is a 400. OpenAI-style protocols
      // keep that spelling; an adaptive route spells the level as null below.
      declaresOff = true
      if (!adaptive) efforts.off = id === 'none' ? 'none' : 'off'
    } else if (THINKING_LEVELS.includes(id)) {
      efforts[id] = id
    }
  }
  if (adaptive && declaresOff && Object.keys(efforts).length === 0) {
    // Only "off" survived. The host refuses a profile offering nothing beyond
    // off ("offers no level beyond \"off\"") and refuses an empty dict too, so
    // the model is declared as a non-reasoning one instead.
    return false
  }
  if (adaptive && declaresOff) {
    // The host turns a level this dict does not carry into `null` and then drops
    // it from the supported list, so an adaptive route that keeps other levels
    // has to spell "off" out or the level disappears from the picker entirely.
    // `null` is the spelling the host accepts for "off": the level stays absent
    // from its thinkingLevelMap, which both `getSupportedThinkingLevels` (the
    // picker) and pi-ai read as "supported". With `thinkingEnabled: false` pi-ai
    // then sends `thinking: { type: "disabled" }` for it
    // (anthropic-messages.js), the only disable spelling the plugin side can
    // produce on an adaptive route.
    efforts.off = null
  }
  return Object.keys(efforts).length > 0 ? efforts : undefined
}

/** One configured catalog model, translated onto pi-ai's per-model fields. */
function translateModel(model: CatalogModel, api: ApiProtocol): PiAiModelProfile {
  // Adaptive dispatch is the default on anthropic routes; an explicit
  // `thinkingMode: 'budget'` asks for the legacy fixed-budget shape instead.
  const adaptive = api === 'anthropic-messages' && model.thinkingMode !== 'budget'
  const reasoningEfforts = translateReasoningEfforts(model, adaptive)
  // `defaultReasoningEffort` is deliberately absent from the object below — see
  // CATALOG_ONLY_FIELDS: pi-ai has no per-model default slot, and the route-level
  // `reasoning` it does have would leak one model's preference onto every other
  // model on the route. The level stays a llm-sub2api concern.
  return {
    id: model.id,
    ...(model.name !== undefined && model.name.length > 0 ? { name: model.name } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    input: catalogInputModalities(model),
    ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
    // pi-ai picks the Anthropic thinking shape from the model alone. Without
    // this switch it always sends the fixed-budget shape
    // (`thinking:{type:"enabled",budget_tokens:N}`), which current Claude
    // deployments reject with 400 invalid_request_error ("... requires adaptive
    // thinking or thinking.type=between_tools; omit thinking or use one of
    // those modes"); with it, the selected level travels as
    // `output_config.effort` and `thinking:{type:"adaptive"}`. OpenAI-style
    // protocols carry the level themselves, so the switch is set on anthropic
    // routes only, and only when the catalog did not ask for the budget shape
    // (`thinkingMode: 'budget'`).
    ...(adaptive ? { compat: { forceAdaptiveThinking: true } } : {}),
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
/**
 * One gateway route on pi-ai's provider-profile fields.
 *
 * `streamIdleTimeoutMs` is a route-level field the host keeps on the provider
 * profile (`PiAiProviderProfile`), not on a model, and it is passed as its own
 * argument: only an endpoint entry can set it, so the legacy per-platform
 * `providers` groups always keep the host default.
 */
function translateProfile(key: ProviderKey, profile: ProviderProfile, baseURL: string, label: string, streamIdleTimeoutMs?: number): PiAiProviderProfile {
  const api = apiProtocolForKey(key, profile)
  return {
    ...(profile.apiKeyEnv !== undefined ? { apiKeyEnv: profile.apiKeyEnv } : {}),
    displayName: `Sub2API ${label}`,
    api,
    baseURL: api === 'anthropic-messages' ? gatewayAnthropicRoot(baseURL) : gatewayApiRoot(baseURL),
    models: (profile.models ?? []).map((model) => translateModel(model, api)),
    // Route-level stream idle timeout: llm-pi-ai reads `streamIdleTimeoutMs`
    // from the provider profile, so the endpoint's value travels here and an
    // absent one lets the host default (DEFAULT_STREAM_IDLE_TIMEOUT_MS, 300000)
    // apply — which is what every previously stored configuration gets.
    ...(streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs } : {}),
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
    profiles[endpointRoute(endpoint, endpoints)] = translateProfile(endpoint.platform, endpoint, host, label, endpoint.streamIdleTimeoutMs)
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
