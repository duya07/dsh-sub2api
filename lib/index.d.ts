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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { PI_AI_NS, ROUTE_PREFIX, syncPiAiProfiles, translateToPiAi, type PiAiModelProfile, type PiAiProviderProfile, type PiAiSettingsSection, } from './pi-a./pi-ai.jsort { applyPiAiMultiTurnPatch, type PiAiPatchResult } from './pi-a./pi-ai-patch.jsort declare const name = "llm-sub2api";
export declare const inject: string[];
/** Context capacity assumed for a model neither configuration nor discovery sizes. */
export declare const DEFAULT_CONTEXT_WINDOW = 128000;
/** Output capability assumed for a model neither configuration nor discovery sizes. */
export declare const DEFAULT_MAX_TOKENS = 8192;
/**
 * Reasoning effort levels exposed for reasoning-capable models. The gateway
 * speaks the OpenAI chat-completions protocol, so the ids are the OpenAI
 * `reasoning_effort` vocabulary and are sent through verbatim. Per-model
 * configuration (filled from models.dev `reasoning_options`) may expose
 * additional vocabulary such as `none`, `xhigh`, or `max`.
 */
export declare const REASONING_EFFORTS: readonly {
    id: string;
    name: string;
}[];
export type ProviderKey = 'openai' | 'claude' | 'grok';
export interface ProviderDef {
    key: ProviderKey;
    route: string;
    label: string;
    icon: string;
}
/** The provider routes this plugin owns, keyed by sub2api platform name. */
export declare const PROVIDERS: readonly ProviderDef[];
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
export type ThinkingMode = 'adaptive' | 'budget';
/**
 * Upper bound the host accepts for one stream-idle timeout, mirroring
 * `MAX_TIMER_DELAY_MS` of `@deepseek-ai/dsh-timeout`. llm-pi-ai rejects a
 * larger `streamIdleTimeoutMs` when the translated provider profile is loaded,
 * so the settings schema clamps it here instead of failing at runtime.
 */
export declare const MAX_STREAM_IDLE_TIMEOUT_MS: number;
/**
 * Default stream idle timeout used by the host when a model does not set one
 * (`DEFAULT_STREAM_IDLE_TIMEOUT_MS` in `@deepseek-ai/dsh-llm-pi-ai`: 300000 ms
 * = 5 minutes). Kept here only for documentation and tests.
 */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS: number;
export interface CatalogModel {
    /** Model id sent to the provider and accepted by {@link GenerateOptions.model}. */
    id: string;
    /** Display name for selectors; defaults to the id. */
    name?: string;
    /** Maximum combined request and response context in tokens. */
    contextWindow?: number;
    /** Maximum output tokens. */
    maxTokens?: number;
    /**
     * Accepted request modalities. Absent or empty: the adapter guesses from
     * the model id (multimodal families such as gpt/claude/gemini/grok/glm
     * declare `[text, image]`, everything else stays `[text]`). Non-empty:
     * exactly those modalities, e.g. `[text]` to pin a multimodal-looking
     * model to text only.
     */
    input?: Array<'text' | 'image'>;
    /**
     * Reasoning effort levels selectable for this model. Absent: every non-image
     * model on any route exposes low/medium/high (the gateway is OpenAI-compatible
     * on all routes). Empty array: reasoning effort is explicitly off for this
     * model. Non-empty: exposes exactly those levels verbatim (e.g. models.dev
     * vocabularies such as `xhigh`/`max`/`none`).
     */
    reasoningEfforts?: string[];
    /**
     * Reasoning level this model starts on when the user has not picked one.
     * Absent: no per-model preference — the picker keeps the host's own default,
     * and {@link resolveDefaultReasoningEffort} may still find a suggestion in the
     * built-in preset table (`src/model-presets.ts`). A level stored here wins
     * over that table.
     *
     * Must name one of this model's {@link reasoningEfforts}; the submission route
     * drops a value outside that set rather than rewriting it, because a rewritten
     * level would silently overrule the user. Never translated into a pi-ai
     * profile: `PiAiModelProfile` has no per-model default, so this field lives
     * only in this section and in the built-in table.
     */
    defaultReasoningEffort?: string;
    /**
     * Thinking dispatch this model's levels use on an `anthropic-messages` route.
     * Absent: `adaptive` (see {@link ThinkingMode}). Set `budget` only for a
     * gateway that still rejects adaptive thinking. Ignored on OpenAI-style
     * routes, which carry the level themselves.
     */
    thinkingMode?: ThinkingMode;
}
/**
 * Anything that may suggest a default reasoning level for one model: a stored
 * catalog entry, or a built-in preset (`src/model-presets.ts`).
 */
export interface DefaultReasoningEffortSource {
    defaultReasoningEffort?: string;
}
/**
 * Resolve the default reasoning level for one model: a stored catalog entry
 * wins, the built-in preset table is the fallback, and nothing is invented.
 *
 * The order is fixed — `model.defaultReasoningEffort ??
 * preset.defaultReasoningEffort` — and never reversed: a level the user stored
 * is a decision, while a level the built-in table carries is only a suggestion.
 * That is the same contract {@link fillMissingModelFields} follows.
 *
 * The value is returned verbatim, including one outside the model's
 * `reasoningEfforts`: rewriting it here would decide for the user, and
 * membership is enforced once, on the submission path. Blank strings count as
 * unset, so an input the user emptied does not suppress the preset suggestion.
 */
export declare function resolveDefaultReasoningEffort(model: DefaultReasoningEffortSource, preset?: DefaultReasoningEffortSource): string | undefined;
export interface ProviderProfile {
    /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
    apiKeyEnv?: string;
    /**
     * Wire protocol spoken to the gateway for this platform group. Absent
     * selects the group's native protocol (openai → responses, claude →
     * messages, grok → chat/completions). Explicitly name a protocol to
     * force a different endpoint, e.g. a gateway that serves a group through
     * chat/completions after all.
     */
    api?: ApiProtocol;
    /** Advisory model catalog for this route. */
    models?: CatalogModel[];
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
    name?: string;
    /** This entry's own gateway host. Absent falls back to the section `baseURL`. */
    baseURL?: string;
    /** Sub2api platform group this key belongs to; decides the native protocol. */
    platform: ProviderKey;
    /** Credential reference holding this entry's key. */
    apiKeyEnv?: string;
    /** Wire-protocol override for this entry. */
    api?: ApiProtocol;
    /** Advisory model catalog for this entry. */
    models?: CatalogModel[];
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
    streamIdleTimeoutMs?: number;
}
/**
 * The levels a model may be asked for: its own declaration, or the schema's
 * default vocabulary when it declares none.
 *
 * `[]` stays `[]` — a model whose levels were emptied (an image model, a model
 * with no reasoning) must not be offered the default vocabulary. Shared by the
 * submission route's membership check and the host-side preset fill so the two
 * can never disagree about what a model offers.
 */
export declare function offeredReasoningLevels(declared: readonly string[] | undefined): readonly string[];
/**
 * Whether a model's declared levels are exactly the schema's default vocabulary.
 *
 * `catalogModel.reasoningEfforts` carries `.default(REASONING_EFFORTS ids)`, so
 * `Config({...})` materializes that vocabulary onto every model that declared
 * none — by the time the preset fill runs, "the user never chose" and "the user
 * chose exactly the default list" are the same three strings. The fill treats
 * the schema's own vocabulary as unset, so the built-in table's narrower list
 * can still apply (P0-F8 repair, F1).
 *
 * The trade-off is deliberate: a user who wants `low, medium, high` on a model
 * the table knows cannot be told apart from one who never chose, so the table
 * wins on this path. Editing any other level of that row is the way to keep a
 * list of your own — the settings page says so next to the table.
 */
export declare function isSchemaDefaultVocabulary(declared: readonly string[] | undefined): boolean;
/**
 * Fill one endpoint's models from the built-in capability table and resolve the
 * per-model default reasoning level (P0-F8).
 *
 * `llm-sub2api.endpoints[].models[]` is the authoritative catalog; everything
 * downstream — the settings page's echo, `syncPiAiProfiles`, and the pi-ai
 * profile the host actually requests with — is derived from what this returns.
 * Without this step a model the user never sized reaches pi-ai with no
 * `contextWindow`/`maxTokens`, and the host falls back to its own defaults
 * instead of the table's measured values.
 *
 * Two decisions, both "suggest, never overwrite":
 *   1. every *empty* field is filled from the preset
 *      ({@link fillMissingModelFields});
 *   2. a model carrying no default level of its own takes the preset's
 *      suggestion, but only when the model actually offers that level —
 *      {@link resolveDefaultReasoningEffort} decides the first half, the
 *      membership check the second. A suggestion outside the model's levels is
 *      dropped rather than stored: storing it would put a level in the catalog
 *      that the model cannot be asked for.
 *
 * Returns `endpoint` itself when nothing changed, so the caller keeps the
 * derived JSON byte-stable and the host's idempotence guard quiet.
 */
export declare function withPresetDefaults(endpoint: ProviderEndpoint, fallbackBaseURL: string): ProviderEndpoint;
/** One dedicated model used by a global image tool, independent of the chat route. */
export interface ImageToolModelRef {
    /** Sub2API platform that owns the key and catalog (`openai` / `claude` / `grok`). */
    provider: string;
    /** Model id sent to the gateway. */
    model: string;
    /**
     * Opt-in compatibility switch: also register the legacy `generate_image`
     * name, but only while that name is still free. Off by default, so this
     * plugin never competes with another image plugin for the plain name.
     * Toggling it changes what the next plugin load registers — it is not a hot
     * switch.
     */
    compatToolName?: boolean;
}
export interface ImageToolsConfig {
    /** Image-generation model used by the global `sub2api_generate_image` tool. */
    generate?: ImageToolModelRef;
    /** Gateway-backed candidate for the host's global `web_search` tool. */
    webSearch?: WebSearchToolConfig;
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
    enabled?: boolean;
    /** Route id of the endpoint that serves the search request. */
    provider?: string;
    /** Model id sent with the search request. */
    model?: string;
}
export interface Config {
    /** OpenAI-compatible gateway base URL, e.g. http://localhost:8080/v1. */
    baseURL: string;
    /** Per-platform provider profiles keyed by sub2api platform name. */
    providers: Record<ProviderKey, ProviderProfile>;
    /**
     * Independently-keyed endpoints. A non-empty list is the sole source of chat
     * routes; {@link providers} then stays untouched as the legacy shape, so a
     * section written by an older build keeps working. Absent or empty keeps the
     * original one-slot-per-platform behaviour.
     */
    endpoints?: ProviderEndpoint[];
    /** Dedicated models for the global image-generation tools. */
    tools?: ImageToolsConfig;
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
    get(): T;
}
/**
 * The configuration `apply` receives. Every field declared volatile in
 * {@link Config} arrives as a {@link Volatile} cell; fields are optional
 * because a section that never stored a value still resolves — an unset
 * `baseURL` is a live cell holding `undefined`.
 */
export interface ConfigInput {
    baseURL?: Volatile<string | undefined>;
    providers?: Volatile<Record<ProviderKey, ProviderProfile>>;
    endpoints?: Volatile<ProviderEndpoint[]>;
    tools?: Volatile<ImageToolsConfig>;
}
/**
 * Read one configuration cell. The loader always supplies a volatile
 * reference for a volatile schema field, but test fixtures call `apply` with
 * plain literals, so both shapes are accepted.
 */
export declare function readVolatile<T>(value: Volatile<T> | T | undefined): T | undefined;
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
export declare const Config: z<ConfigInput>;
/**
 * Wire protocol the adapter speaks to the gateway for one route. Each value
 * names a real endpoint: `openai-completions` → `/chat/completions`,
 * `openai-responses` → `/responses`, `anthropic-messages` → `/messages`.
 */
export type ApiProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export declare const API_PROTOCOLS: readonly ApiProtocol[];
/** Resolve the wire protocol for one provider key; shared by chat routes and the global image tools. */
export declare function apiProtocolForKey(key: ProviderKey, profile: ProviderProfile): ApiProtocol;
/**
 * The OpenAI-style API root for a gateway base URL. The Sub2API settings page
 * stores the bare host (e.g. `https://gateway.example:6443`); OpenAI-compatible
 * endpoints (`/responses`, `/chat/completions`, `/models`, `/usage`) live under
 * the `/v1` root, so it is appended here when missing. A URL already carrying
 * `/v1` passes through unchanged.
 */
export declare function gatewayApiRoot(baseURL: string): string;
/**
 * The bare-host form the Anthropic SDK expects: `@anthropic-ai/sdk` treats the
 * configured URL as the host and always appends `/v1/messages` itself, so a
 * `/v1`-rooted URL would hit `/v1/v1/messages` (404). Strips a trailing `/v1`
 * when present.
 */
export declare function gatewayAnthropicRoot(baseURL: string): string;
/** Validate the host's editable form without attempting a profile write. */
export declare function prepareConfigSave(ctx: Context, next: Config): Promise<() => Promise<void>>;
export declare function apply(ctx: Context, config: ConfigInput): void;
