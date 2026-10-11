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
    id: string;
    /** Display name; omitted means "show the id". */
    name?: string;
    /** Maximum combined request + response context, in tokens. */
    contextWindow?: number;
    /** Maximum output tokens. */
    maxTokens?: number;
    /** Accepted request modalities. Never empty in this table. */
    input: Array<'text' | 'image'>;
    /**
     * Selectable reasoning levels. Omitted: this table has no evidence, so the
     * caller keeps whatever the schema default is. `[]`: reasoning is explicitly
     * off (image models).
     */
    reasoningEfforts?: string[];
    /**
     * The level this model should start on when the user has not picked one.
     * Omitted: this table has no evidence for a suggestion, so nothing is
     * invented. Set only where a source states a default (`08-our-presets.md` §6)
     * and only with a value that is one of `reasoningEfforts` above; a level stored
     * on the catalog entry always wins over it (`resolveDefaultReasoningEffort` in
     * `src/index.ts`).
     */
    defaultReasoningEffort?: string;
    /**
     * pi-ai compatibility bag, when a route needs one. No entry uses it today.
     *
     * If one ever does: {@link fillMissingModelFields} copies this bag *shallowly*
     * (`{ ...preset.compat }`), so a nested object would stay shared with the
     * table. Deep-copy it, or freeze the entry, before putting anything nested
     * here.
     */
    compat?: Record<string, unknown>;
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
export declare const BUILTIN_MODEL_PRESETS: readonly ModelPreset[];
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
export declare function normalizeModelId(id: string): string;
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
export declare function modelIdCandidates(id: string): string[];
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
export declare function endpointKey(baseURL: string): string | undefined;
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
export declare function lookupModelPreset(baseURL: string, modelId: string): ModelPreset | undefined;
/** The subset of a model record this module is allowed to fill. */
export interface FillableModelFields {
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: Array<'text' | 'image'>;
    reasoningEfforts?: string[];
    compat?: Record<string, unknown>;
}
/** One field the capability table may fill. */
export type PresetFillableField = 'name' | 'contextWindow' | 'maxTokens' | 'input' | 'reasoningEfforts' | 'compat';
/** Every fillable field, in the order {@link presetFieldsToFill} reports them. */
export declare const PRESET_FILLABLE_FIELDS: readonly PresetFillableField[];
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
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: readonly ('text' | 'image')[];
    reasoningEfforts?: readonly string[];
    compat?: Record<string, unknown>;
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
export declare function presetFieldsToFill(probe: PresetFillProbe, preset: ModelPreset, wanted?: readonly PresetFillableField[]): PresetFillableField[];
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
export declare function fillMissingModelFields<T extends FillableModelFields>(target: T, preset: ModelPreset): T;
