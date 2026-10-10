/**
 * Global `web_search` provider served by this gateway.
 *
 * The reference plugins either bind the host's search tool to a subscription
 * account (private codex endpoints) or re-implement the tool themselves. Both
 * are wrong for a gateway-shaped plugin, so this module registers a *candidate*
 * into the host's `ctx.web` seam instead: the host keeps owning the tool, the
 * result shape and provider selection, while this plugin only answers one
 * `search()` call by asking the configured gateway endpoint to run its own
 * native `web_search` tool over the Responses API.
 *
 * Two properties matter for coexistence with the official provider:
 *
 * 1. `available()` returns false unless the user explicitly enabled this route
 *    in the settings section. The host throws `WEB_PROVIDER_AMBIGUOUS` when two
 *    *available* providers exist and no explicit `searchProvider` is
 *    configured, so an always-available candidate would break the search setup
 *    that already works today.
 * 2. One search is one bounded exchange: a coded error preserves the host's
 *    `WEB_*` error contract, and the only retry this path performs is a single
 *    extra attempt for a `429` that states a parseable `Retry-After`
 *    ({@link WEB_SEARCH_RATE_LIMIT_RETRY_POLICY}). Every other status is
 *    reported as it arrived, and an unparseable delay is never guessed at.
 *
 * The host's `@deepseek-ai/dsh-web` package ships no declaration file and is
 * deliberately absent from this plugin's dependencies, so this module defines
 * its own `HarnessError` subclass carrying the same stable `code` field the
 * seam documents.
 *
 * @module dsh-sub2api/web-search
 */
import type { Context } from '@deepseek-ai/cordis';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { type ApiProtocol, type Config, type ProviderProfile } from './index.js';
import { type EndpointCooldownTracker, type RateLimitRetryPolicy } from './http-resilience.js';
/** Stable id this provider registers under with the host's `ctx.web` seam. */
export declare const SUB2API_WEB_SEARCH_PROVIDER_ID: string;
/** Upper bound on a gateway search response body this plugin is willing to buffer. */
export declare const MAX_SEARCH_RESPONSE_BYTES: number;
/**
 * How long one `/responses` attempt may stay silent before the idle watchdog
 * aborts it.
 *
 * This gateway does **not** forward streaming search results: it runs its own
 * `web_search` tool and only answers once it is done, so the response headers
 * themselves have been observed to arrive 6–23 seconds in. The idle window must
 * therefore sit far above a normal first byte, not at the "a few seconds" a
 * streaming client would use — 90 seconds is roughly four times the slowest
 * observed header arrival, so it only fires on a genuinely dead connection.
 * The caller's own signal still cancels immediately.
 */
export declare const WEB_SEARCH_IDLE_TIMEOUT_MS: number;
/**
 * The bounded retry policy for this path: at most one extra attempt, and only
 * for a `429` that states a delay this plugin can parse. Exported so a host or
 * a test can pass `{ enabled: false }` and get strictly single-shot requests.
 */
export declare const WEB_SEARCH_RATE_LIMIT_RETRY_POLICY: RateLimitRetryPolicy;
/** One source the host renders from a search result. */
export interface WebSearchSource {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}
/**
 * The normalized result shape the host's `ctx.web` seam consumes. `content` is
 * an extension the host's tool layer already understands: when present it is
 * surfaced as the search answer, and `sources` stays the citation list.
 */
export interface WebSearchResult {
    sources: WebSearchSource[];
    truncated: boolean;
    content?: string;
}
/** The request shape the host's `ctx.web.search()` seam passes down. */
export interface WebSearchRequest {
    query: string;
    maxResults?: number;
}
/** The subset of the plugin host this provider needs. */
export interface WebSearchHost {
    config: () => Config;
    resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>;
    /**
     * Override the idle window of one `/responses` attempt. Defaults to
     * {@link WEB_SEARCH_IDLE_TIMEOUT_MS}; a non-positive value disables the
     * watchdog.
     */
    idleTimeoutMs?: number;
    /** Override the bounded `429` retry policy. Defaults to {@link WEB_SEARCH_RATE_LIMIT_RETRY_POLICY}. */
    rateLimitRetry?: RateLimitRetryPolicy;
    /**
     * Endpoint failure memory. Defaults to the process-wide
     * {@link endpointCooldowns}, so a search shares one view of a broken endpoint
     * with the image tools; tests inject their own tracker to stay isolated.
     */
    endpointCooldowns?: EndpointCooldownTracker;
}
/**
 * A search failure the host can route by `code`. Shaped like the host's own
 * `WebError` (`HarnessError` with a stable `code`), which cannot be imported
 * here because `@deepseek-ai/dsh-web` is not a dependency of this plugin.
 */
export declare class Sub2ApiWebError extends HarnessError {
}
/** A gateway endpoint able to answer a Responses-API search. */
export interface ResolvedWebSearch {
    /** Route id the request is billed to; also what the settings section stores. */
    route: string;
    /** Human label used in diagnostics. */
    label: string;
    profile: ProviderProfile;
    /** Model id sent as `model` on the Responses request. */
    model: string;
    /** Gateway root that already carries the protocol's version segment. */
    baseURL: string;
    api: ApiProtocol;
}
/**
 * Resolve the configured search route, or `undefined` when the feature is off,
 * under-specified, or bound to an endpoint that cannot serve a Responses
 * request. Callers treat `undefined` as "this provider is not available", which
 * is exactly what keeps provider selection unambiguous.
 */
export declare function resolveWebSearchTarget(config: Config): ResolvedWebSearch | undefined;
/**
 * Normalize a Responses-API body into the host's search result: model text from
 * `message.content[].output_text` plus `url_citation` annotations. A response
 * carrying neither is reported as an error instead of an empty result, because
 * an empty answer would silently look like "nothing found".
 */
export declare function parseResponsesSearch(body: string): WebSearchResult;
/**
 * One gateway-backed search candidate for the host's `ctx.web` seam.
 */
export declare class Sub2ApiWebSearchProvider {
    /** Seam id; fixed so the host's `web.searchProvider` can select it by name. */
    readonly id: string;
    private readonly host;
    constructor(host: WebSearchHost);
    /**
     * Only an explicitly enabled and fully resolved route is available. Anything
     * else keeps this candidate invisible to provider selection.
     */
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
/**
 * Register the candidate into the host's web seam. Registration is an effect,
 * so disabling or unloading the plugin withdraws the provider with it.
 */
export declare function registerWebSearchProvider(ctx: Context, host: WebSearchHost): void;
