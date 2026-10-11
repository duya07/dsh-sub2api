/**
 * Built-in static model capability table + matching chain (P0-1).
 *
 * WHY THIS EXISTS
 * The gateway's `GET /v1/models` only returns `{ id, type, display_name,
 * created_at }` — it never exposes `context_length` / `max_input_tokens`, and
 * it does not validate `max_tokens` at all. So a freshly discovered model has
 * no window, no output cap and no reasoning vocabulary. This module carries the
 * values we verified by hand, so discovery can fill those blanks offline.
 *
 * DATA SOURCE (do not re-derive, do not "improve")
 * `sub2api-ref/cc-switch-port/08-our-presets.md` §7 — the cross-checked草案 of
 * cc-switch's static tables (`06-builtin-tables.md`) against the effort
 * authority table (`07-effort-presets.md`). The per-entry markers below are
 * copied from that document verbatim:
 *   - `EVID`   — an independent source backs this value.
 *   - `KEEP`   — no independent evidence; this is our current runtime value,
 *                kept unchanged on purpose.
 *   - `REVIEW` — value is suspect and should be re-checked with a live request.
 *
 * TWO HARD RULES BAKED INTO THE DATA
 *   1. WINDOWS ARE NEVER TAKEN FROM cc-switch. Its `contextWindow` values are
 *      "vendor catalog口径" (e.g. gpt-5.4 = 272000, kimi-k3 = 1048576), while
 *      ours are what the upstream endpoint actually declared (1050000, 256000).
 *      Overwriting the runtime value with the catalog value would break
 *      configurations that are already verified.
 *   2. NO FABRICATED LEVELS. Entries without third-party evidence simply omit
 *      `reasoningEfforts` (and the image models declare an explicit `[]`, which
 *      means "reasoning is off", not "unknown").
 *
 * HOW TO USE IT (see {@link fillMissingModelFields})
 * The table is a *suggestion* for empty fields only. It must never overwrite a
 * value the user already typed — same contract as the models.dev fill path.
 *
 * SANITIZATION
 * No real gateway host, key or credential reference appears here. {@link
 * endpointKey} is a pure string normalizer, and the table itself is stored flat
 * (one entry per unique id) — the one place where a flat table had to choose is
 * documented on {@link BUILTIN_MODEL_PRESETS}.
 */

/**
 * One built-in model capability record.
 *
 * The field names mirror the plugin's own catalog shape
 * (`CatalogModel` in `src/index.ts`) so the values can be dropped straight into
 * an endpoint's `models[]`. Two deliberate differences:
 *   - `input` is required here (the table always knows the modalities).
 *   - `compat` is an extension slot carried for pi-ai's `compat` bag; it is not
 *     a `CatalogModel` field and no entry currently uses it.
 */
export interface ModelPreset {
  /** Model id as the gateway accepts it. */
  id: string
  /** Display name; omitted means "show the id". */
  name?: string
  /** Maximum combined request + response context, in tokens. */
  contextWindow?: number
  /** Maximum output tokens. */
  maxTokens?: number
  /** Accepted request modalities. Never empty in this table. */
  input: Array<'text' | 'image'>
  /**
   * Selectable reasoning levels. Omitted: this table has no evidence, so the
   * caller keeps whatever the schema default is. `[]`: reasoning is explicitly
   * off (image models).
   */
  reasoningEfforts?: string[]
  /**
   * The level this model should start on when the user has not picked one.
   * Omitted: this table has no evidence for a suggestion, so nothing is
   * invented. Set only where a source states a default (`08-our-presets.md` §6)
   * and only with a value that is one of `reasoningEfforts` above; a level stored
   * on the catalog entry always wins over it (`resolveDefaultReasoningEffort` in
   * `src/index.ts`).
   */
  defaultReasoningEffort?: string
  /**
   * pi-ai compatibility bag, when a route needs one. No entry uses it today.
   *
   * If one ever does: {@link fillMissingModelFields} copies this bag *shallowly*
   * (`{ ...preset.compat }`), so a nested object would stay shared with the
   * table. Deep-copy it, or freeze the entry, before putting anything nested
   * here.
   */
  compat?: Record<string, unknown>
}

/**
 * The 44 unique model ids of our own pool, deduplicated from the 70
 * endpoint-model rows of `llm-sub2api.config.endpoints[]`.
 *
 * Cross-endpoint reality, counted rather than assumed: 19 of the 44 ids appear
 * on more than one endpoint — every id of `endpoint-1` (which `endpoint-4`
 * repeats in full) plus the seven ids `endpoint-2` shares with them. 18 of those
 * 19 carry identical values everywhere they appear. The single exception is
 * `codex-auto-review`: `endpoint-1` and `endpoint-4` name it "Codex Auto
 * Review", while `endpoint-2` declares no name at all. This flat table keeps the
 * named spelling, so filling a row on `endpoint-2` supplies a display name that
 * endpoint never declared. That is a deliberate default, not a verbatim mirror
 * of every row.
 */
export const BUILTIN_MODEL_PRESETS: readonly ModelPreset[] = [
  // ---- OpenAI-style endpoints (endpoint-1 / -2 / -4) ----
  { id: 'codex-auto-review', name: 'Codex Auto Review', input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP gateway-synthesized name
  { id: 'gpt-4o-audio-preview', name: 'gpt-4o-audio-preview', input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP
  { id: 'gpt-4o-realtime-preview', name: 'gpt-4o-realtime-preview', contextWindow: 32000, maxTokens: 4096, input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP
  { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] }, // KEEP window
  { id: 'gpt-5.4-2026-03-05', name: 'gpt-5.4-2026-03-05', contextWindow: 1050000, maxTokens: 128000, input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] }, // EVID window
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] }, // EVID levels
  { id: 'gpt-5.5-codex-auto-review', input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP gateway-synthesized name
  { id: 'gpt-5.6', name: 'GPT-5.6 (Sol)', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, // REVIEW possible alias of gpt-5.6-sol
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, // EVID levels
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, // EVID levels
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, // EVID levels
  { id: 'gpt-6', name: 'GPT-6 (Astra)', input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // REVIEW possible alias of gpt-6-astra
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window + levels (no none)
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // KEEP no cc-switch coverage
  { id: 'gpt-image-1', name: 'GPT Image 1', input: ['text', 'image'], reasoningEfforts: [] }, // KEEP image model
  { id: 'gpt-image-1.5', name: 'GPT Image 1.5', input: ['text', 'image'], reasoningEfforts: [] }, // KEEP image model
  { id: 'gpt-image-2', name: 'GPT Image 2', input: ['text', 'image'], reasoningEfforts: [] }, // KEEP image model
  { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', input: ['text', 'image'], reasoningEfforts: [] }, // KEEP image model
  { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', input: ['text', 'image'], reasoningEfforts: [] }, // KEEP image model (tools.generate target)

  // ---- Anthropic-style endpoint (endpoint-3, the only `claude` platform) ----
  { id: 'claude-fable-5', name: 'claude-fable-5', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window; REVIEW levels (cc-switch Pi table has xhigh,max only)
  { id: 'claude-fable-5-1', name: 'claude-fable-5-1', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window (cc-switch spells it claude-fable-5.1); REVIEW levels
  { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high'] }, // EVID window + maxTokens
  { id: 'claude-haiku-4-5-20251001', name: 'claude-haiku-4-5-20251001', contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high'] }, // EVID window + maxTokens
  { id: 'claude-opus-4-1-20250805', name: 'claude-opus-4-1-20250805', contextWindow: 200000, maxTokens: 32000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP cc-switch has no 4.1
  { id: 'claude-opus-4-20250514', name: 'claude-opus-4-20250514', contextWindow: 200000, maxTokens: 32000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP
  { id: 'claude-opus-4-5-20251101', name: 'claude-opus-4-5-20251101', contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP cc-switch has no 4.5
  { id: 'claude-opus-4-8', name: 'claude-opus-4-8', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window; REVIEW levels
  { id: 'claude-opus-5', name: 'claude-opus-5', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window; REVIEW levels
  { id: 'claude-opus-5-5', name: 'claude-opus-5-5', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window; REVIEW levels
  { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'max'] }, // EVID window (no xhigh)
  { id: 'claude-sonnet-5', name: 'claude-sonnet-5', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window; REVIEW levels
  { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // EVID window

  // ---- Composite-group endpoint (endpoint-5) ----
  // WARNING: this endpoint is a gateway composite group, so these model names
  // do not identify a real backend. The windows below are upper-bound hints
  // only; the true values need a live probe. Name-based matching is
  // structurally unreliable here.
  { id: 'deepseek-v4-flash-0731', name: 'deepseek-v4-flash-0731', contextWindow: 256000, maxTokens: 65536, input: ['text'], reasoningEfforts: ['low', 'high', 'max'] }, // levels narrowed: MoArk 400 + DeepSeek docs
  { id: 'deepseek-v4-pro-0813', name: 'deepseek-v4-pro-0813', contextWindow: 256000, maxTokens: 65536, input: ['text'], reasoningEfforts: ['none', 'high'] }, // levels: Tencent docs (conflicts with current config, needs a live verdict)
  { id: 'deepseek-v4-pro-max', name: 'deepseek-v4-pro-max', contextWindow: 256000, maxTokens: 65536, input: ['text'], reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, // xhigh,max added: MoArk 400
  { id: 'glm-5.2', name: 'glm-5.2', contextWindow: 256000, maxTokens: 65536, input: ['text'], reasoningEfforts: ['high', 'max'] }, // EVID levels (Zen)
  { id: 'glm-5.3', name: 'glm-5.3', contextWindow: 256000, maxTokens: 65536, input: ['text'], reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' }, // EVID levels (three sources agree); default: Zhipu ships max while OpenCode Go / Tencent ship high, so the conservative source wins
  { id: 'kimi-k2.6', name: 'kimi-k2.6', contextWindow: 262144, maxTokens: 65536, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'high'] }, // EVID window
  { id: 'kimi-k3', name: 'kimi-k3', contextWindow: 256000, maxTokens: 65536, input: ['text', 'image'], reasoningEfforts: ['low', 'high', 'max'] }, // EVID levels (no default declared on purpose)
  { id: 'qwen3.7-max', name: 'qwen3.7-max', contextWindow: 256000, maxTokens: 65536, input: ['text'], reasoningEfforts: ['low', 'medium', 'high'] }, // KEEP
  { id: 'qwen3.8-max', name: 'qwen3.8-max', contextWindow: 256000, maxTokens: 65536, input: ['text', 'image'], reasoningEfforts: ['low', 'medium', 'xhigh'], defaultReasoningEffort: 'xhigh' }, // EVID levels (vendor default xhigh)
]

/** A `v1` / `v4` / `v1beta` / `v2alpha1`-style path segment. */
const VERSION_SEGMENT = /^v\d+(?:(?:alpha|beta|rc|preview)\d*)?$/

/** Single trailing path segments that name a protocol verb, not a business path. */
const PROTOCOL_SEGMENTS: readonly string[] = ['responses', 'messages', 'completions', 'chat']

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

/**
 * A host we are willing to group by: a dotted name (which also covers IPv4
 * literals) or {@link LOCAL_HOST}, optionally with a port. A single label such
 * as `garbage` is rejected on purpose — see {@link endpointKey}.
 */
const HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?$/

/** The one single-label host we accept, so local development keeps working. */
const LOCAL_HOST = 'localhost'

/**
 * Canonicalize a model id the same way cc-switch does
 * (`cc-switch/src/lib/modelsDev.ts:92-99`), so ids coming from different
 * vendors can be compared:
 *
 *   last `/` segment → first `:` segment → trim → `@` → `-` → lowercase →
 *   drop a trailing `[1m]` marker.
 *
 * Note what it does NOT do: it never swaps `-` with `.`. That omission is
 * exactly why `claude-fable-5-1` and `claude-fable-5.1` used to miss each
 * other; {@link modelIdCandidates} is the fix.
 *
 * @returns the canonical id, or `''` for blank input.
 */
export function normalizeModelId(id: string): string {
  const trimmed = id.trim()
  if (trimmed === '') return ''
  const afterSlash = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  const beforeColon = afterSlash.split(':')[0] ?? ''
  const stripped = beforeColon.trim().replace(/@/g, '-').toLowerCase()
  return stripped.endsWith('[1m]') ? stripped.slice(0, -4) : stripped
}

/**
 * Every spelling of `id` worth trying, most specific first:
 *
 *   1. as typed
 *   2. lowercased
 *   3. {@link normalizeModelId} (strips `vendor/`, `:variant`, `@suffix`, `[1m]`)
 *   4. one variant per separator position, with `-` and `.` swapped
 *
 * Step 4 is per position, not a blanket replace: turning every `-` into `.`
 * would yield `claude.fable.5.1` and still never produce the `claude-fable-5.1`
 * spelling that cc-switch's catalog uses.
 *
 * Duplicates are removed and order is preserved. Blank input yields `[]`.
 */
export function modelIdCandidates(id: string): string[] {
  const raw = id.trim()
  if (raw === '') return []
  const out: string[] = []
  const push = (value: string): void => {
    const candidate = value.trim()
    if (candidate !== '' && !out.includes(candidate)) out.push(candidate)
  }
  push(raw)
  const lower = raw.toLowerCase()
  push(lower)
  const normalized = normalizeModelId(raw)
  push(normalized)
  for (const base of [lower, normalized]) {
    for (const variant of separatorVariants(base)) push(variant)
  }
  return out
}

/** Swap `-` ⇄ `.` at exactly one position per variant. */
function separatorVariants(id: string): string[] {
  const out: string[] = []
  for (let index = 0; index < id.length; index += 1) {
    const char = id.charAt(index)
    if (char !== '-' && char !== '.') continue
    const replacement = char === '-' ? '.' : '-'
    out.push(id.slice(0, index) + replacement + id.slice(index + 1))
  }
  return out
}

/**
 * Normalize a gateway base URL into a grouping key: `host[:port][/business/path]`.
 *
 * Strips the scheme, any userinfo, the query/hash, then peels trailing path
 * segments that carry no grouping information — protocol verbs
 * (`chat/completions`, `responses`, `messages`, `completions`) and bare API
 * version segments (`v1`, `v4`, `v1beta`, `v2alpha1`, ...).
 *
 * Rewritten for our own endpoints rather than copied from cc-switch: cc-switch
 * matches on `hostname` alone, while our endpoints can sit on a non-default
 * port and behind a business prefix (`/anthropic`), so the port and the
 * surviving path segments are kept. That keeps two gateways on one host — or
 * one gateway's `/anthropic` vs `/openai` prefixes — from sharing a key.
 *
 * A single-label host (`garbage`, `a`) is rejected as well: it is far more
 * likely a typo, a relative path or a stray fragment than a gateway, and
 * accepting one is what let `garbage` and `a/b` through as "keys" in the first
 * place. {@link LOCAL_HOST} is the documented escape hatch.
 *
 * @returns the key, or `undefined` when nothing usable can be parsed (the
 *   caller must then treat the endpoint as unknown instead of guessing).
 */
export function endpointKey(baseURL: string): string | undefined {
  const raw = baseURL.trim()
  if (raw === '') return undefined
  let rest = raw.replace(SCHEME_PATTERN, '')
  const cut = rest.search(/[?#]/)
  if (cut >= 0) rest = rest.slice(0, cut)
  const firstSlash = rest.indexOf('/')
  const authority = firstSlash >= 0 ? rest.slice(0, firstSlash) : rest
  const at = authority.lastIndexOf('@')
  if (at >= 0) rest = rest.slice(at + 1)
  const slash = rest.indexOf('/')
  const host = (slash >= 0 ? rest.slice(0, slash) : rest).toLowerCase()
  if (host === '') return undefined
  const hostMatch = HOST_PATTERN.exec(host)
  if (hostMatch === null) return undefined
  const hostname = hostMatch[1] ?? ''
  if (!hostname.includes('.') && hostname !== LOCAL_HOST) return undefined
  const segments = (slash >= 0 ? rest.slice(slash + 1) : '')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment !== '')
  while (segments.length > 0) {
    const last = segments[segments.length - 1] ?? ''
    if (!PROTOCOL_SEGMENTS.includes(last) && !VERSION_SEGMENT.test(last)) break
    segments.pop()
    // `chat/completions` is two segments; peeling the verb first already
    // removed `completions`, so `chat` is handled by the next iteration.
  }
  return segments.length > 0 ? `${host}/${segments.join('/')}` : host
}

/**
 * Look up the built-in preset for `modelId` on the endpoint at `baseURL`.
 *
 * Three-step match, in order: as typed → lowercased → the generated candidates
 * of {@link modelIdCandidates} (which includes the normalized id and the
 * `-`/`.` swapped spellings).
 *
 * Returns `undefined` whenever nothing matches — it never falls back to a
 * prefix match, a family guess or a fabricated value. `gpt-5.4-mini-unknown`
 * does not resolve to `gpt-5.4` or `gpt-5.4-mini`.
 *
 * The endpoint only gates validity: an unparseable `baseURL` yields
 * `undefined`, and a single-label host is refused too (see {@link endpointKey}).
 * The table is stored flat even though 19 of the 44 ids appear on more than one
 * endpoint: 18 of those 19 carry identical values everywhere, and the lone
 * exception (`codex-auto-review`, which `endpoint-2` declares without a name) is
 * documented on {@link BUILTIN_MODEL_PRESETS}. Real endpoint keys are
 * deliberately absent here — the document is sanitized, so there is no host to
 * hard-code.
 */
export function lookupModelPreset(baseURL: string, modelId: string): ModelPreset | undefined {
  const key = endpointKey(baseURL)
  if (key === undefined) return undefined
  for (const candidate of modelIdCandidates(modelId)) {
    for (const preset of BUILTIN_MODEL_PRESETS) {
      if (preset.id === candidate) return preset
      if (preset.id.toLowerCase() === candidate) return preset
      if (normalizeModelId(preset.id) === candidate) return preset
    }
  }
  return undefined
}

/** The subset of a model record this module is allowed to fill. */
export interface FillableModelFields {
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Array<'text' | 'image'>
  reasoningEfforts?: string[]
  compat?: Record<string, unknown>
}

/** One field the capability table may fill. */
export type PresetFillableField =
  | 'name'
  | 'contextWindow'
  | 'maxTokens'
  | 'input'
  | 'reasoningEfforts'
  | 'compat'

/** Every fillable field, in the order {@link presetFieldsToFill} reports them. */
export const PRESET_FILLABLE_FIELDS: readonly PresetFillableField[] = [
  'name',
  'contextWindow',
  'maxTokens',
  'input',
  'reasoningEfforts',
  'compat',
]

/**
 * What a caller already carries, in the table's own vocabulary.
 *
 * The two fill paths hold their state in different shapes — the host works on
 * `CatalogModel` records, the settings page on its own string-typed rows — so
 * each one projects its state into this probe and lets
 * {@link presetFieldsToFill} answer. `undefined` means "empty"; a present value
 * means "the user already decided", including an empty `reasoningEfforts`
 * array, which means reasoning is explicitly off rather than unknown.
 */
export interface PresetFillProbe {
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly ('text' | 'image')[]
  reasoningEfforts?: readonly string[]
  compat?: Record<string, unknown>
}

/**
 * The single implementation of the table's contract: which fields of a model
 * record this preset may fill (P0-F8).
 *
 * This is the whole contract — it suggests, it never overwrites:
 *   - `undefined` counts as empty for every field.
 *   - An empty `input` array counts as empty (the schema treats it as "auto").
 *   - A present `reasoningEfforts` counts as filled even when it is `[]`,
 *     because `[]` means "reasoning is explicitly off" rather than "unknown".
 *
 * `wanted` narrows the answer to the fields a caller can actually write, so a
 * caller with no `compat` slot still gets the same decisions for the fields it
 * does own. The result is in {@link PRESET_FILLABLE_FIELDS} order.
 */
export function presetFieldsToFill(
  probe: PresetFillProbe,
  preset: ModelPreset,
  wanted: readonly PresetFillableField[] = PRESET_FILLABLE_FIELDS,
): PresetFillableField[] {
  const fields: PresetFillableField[] = []
  const wants = (field: PresetFillableField): boolean => wanted.includes(field)
  if (wants('name') && probe.name === undefined && preset.name !== undefined) fields.push('name')
  if (wants('contextWindow') && probe.contextWindow === undefined && preset.contextWindow !== undefined) {
    fields.push('contextWindow')
  }
  if (wants('maxTokens') && probe.maxTokens === undefined && preset.maxTokens !== undefined) {
    fields.push('maxTokens')
  }
  if (wants('input') && (probe.input === undefined || probe.input.length === 0) && preset.input.length > 0) {
    fields.push('input')
  }
  if (wants('reasoningEfforts') && probe.reasoningEfforts === undefined && preset.reasoningEfforts !== undefined) {
    fields.push('reasoningEfforts')
  }
  if (wants('compat') && probe.compat === undefined && preset.compat !== undefined) fields.push('compat')
  return fields
}

/**
 * Return `target` with only its *empty* fields filled from `preset`.
 *
 * Thin wrapper over {@link presetFieldsToFill}: the decision lives there, this
 * only applies it to a `CatalogModel`-shaped record. The input object is not
 * mutated; a new object is returned when something was filled, otherwise
 * `target` itself.
 *
 * `compat` is the one shallow copy: it is a bag whose contents we do not
 * interpret, so a nested object inside it would still be shared with the table
 * entry. Nothing populates it today — see {@link ModelPreset.compat}.
 */
export function fillMissingModelFields<T extends FillableModelFields>(
  target: T,
  preset: ModelPreset,
): T {
  const fields = presetFieldsToFill(target, preset)
  if (fields.length === 0) return target
  const patch: FillableModelFields = {}
  for (const field of fields) {
    switch (field) {
      case 'name':
        if (preset.name !== undefined) patch.name = preset.name
        break
      case 'contextWindow':
        if (preset.contextWindow !== undefined) patch.contextWindow = preset.contextWindow
        break
      case 'maxTokens':
        if (preset.maxTokens !== undefined) patch.maxTokens = preset.maxTokens
        break
      case 'input':
        if (preset.input.length > 0) patch.input = [...preset.input]
        break
      case 'reasoningEfforts':
        if (preset.reasoningEfforts !== undefined) patch.reasoningEfforts = [...preset.reasoningEfforts]
        break
      case 'compat':
        if (preset.compat !== undefined) patch.compat = { ...preset.compat }
        break
    }
  }
  return { ...target, ...patch }
}
