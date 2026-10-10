/**
 * HTTP resilience for the requests this plugin issues itself.
 *
 * This plugin never proxies chat traffic: the host's `dsh-llm-pi-ai` adapter
 * owns protocol serialization, streaming and retries for the three
 * `sub2api-*` routes. Only a few request paths belong to this plugin —
 * `web-search.ts` (POST `/responses`), `image-tools.ts` (`gatewayFetch` and the
 * remote-image download) and the reasoning probe, which already carries its own
 * `Retry-After` handling and is deliberately left untouched.
 *
 * Those paths used to accept only the caller's `AbortSignal`: a gateway that
 * accepted the connection and then stopped sending data held the request until
 * the caller's *total* timeout, which cannot tell "still generating" from
 * "already dead"; and a `429` was reported to the user even when the gateway
 * had just said how long to wait. This module supplies the two primitives that
 * close that gap. Both are pure, host-independent functions so they can be
 * unit-tested on their own:
 *
 * - {@link idleWatchdog}: abort a request that produced no data for a while,
 *   while keeping "the gateway went quiet" distinguishable from "the caller
 *   cancelled".
 * - {@link retryAfterDelay} and {@link fetchWithResilience}: at most one extra
 *   attempt, and only for a `429` whose delay this module can actually parse.
 *
 * Every default here is bounded and observable. Retries never exceed
 * {@link RATE_LIMIT_RETRY_LIMIT}; an unparseable `Retry-After` means no retry
 * at all; and no code path retries a non-`429` status. Nothing in this module
 * invents an unbounded retry loop.
 *
 * @module dsh-sub2api/http-resilience
 */
/** What a failed gateway response means for the caller. */
export type HttpFailureKind = 'rate-limited' | 'auth' | 'quota' | 'transient' | 'permanent';
/** Classification of one failed response plus the wait it implies. */
export interface HttpFailure {
    kind: HttpFailureKind;
    /** Milliseconds the caller should wait before touching this route again. */
    cooldownMs: number;
}
export declare const RATE_LIMITED_COOLDOWN_MS: number;
export declare const AUTH_COOLDOWN_MS: number;
export declare const QUOTA_COOLDOWN_MS: number;
export declare const TRANSIENT_COOLDOWN_MS: number;
export declare const PERMANENT_COOLDOWN_MS: number;
/**
 * The wait a gateway asks for, in milliseconds, or `undefined` when it states
 * none this module can understand.
 *
 * `retry-after` wins over the vendor reset headers. Parsing never throws and
 * never returns a negative or non-finite number: a header format problem must
 * not become a request failure.
 */
export declare function retryAfterDelay(headers: Headers | undefined, now: number): number | undefined;
/**
 * Classify one failed response.
 *
 * `429` is rate limiting, `401`/`403` are authentication, `402` is an exhausted
 * quota, `>= 500` is transient, and any other 4xx is a permanent request error.
 * `cooldownMs` prefers the delay the gateway itself stated and otherwise uses
 * the bucket's conservative constant.
 */
export declare function classifyHttpFailure(status: number, headers?: Headers, now?: number): HttpFailure;
/** Raised when a request produced no data for the watchdog window. */
export declare class HttpIdleTimeoutError extends Error {
    /** The idle window that elapsed, in milliseconds. */
    readonly idleMs: number;
    constructor(idleMs: number, options?: {
        cause?: unknown;
    });
}
/** A composed abort signal that also fires when the request goes quiet. */
export interface IdleWatchdog {
    /** Signal to hand to `fetch`: aborts on inactivity or when the parent aborts. */
    readonly signal: AbortSignal;
    /** Report activity; restarts the idle window. */
    touch(): void;
    /** Stop watching: clears the timer, never aborts, detaches from the parent. */
    dispose(): void;
    /** True when the signal was aborted for inactivity, never for a parent abort. */
    wasIdle(): boolean;
}
/**
 * Watch one request for inactivity.
 *
 * The returned signal aborts when no `touch()` arrived within `idleMs`, or when
 * the parent signal aborts — {@link IdleWatchdog.wasIdle} tells the two apart,
 * which is what lets a caller report "the gateway went silent" instead of
 * "the caller cancelled". A non-positive or non-finite `idleMs` disables the
 * watchdog rather than aborting at once, so a misconfigured threshold cannot
 * fail a request by itself.
 */
export declare function idleWatchdog(parent: AbortSignal | undefined, idleMs: number): IdleWatchdog;
/**
 * Bounded retry policy for a `429` the gateway answered with a stated delay.
 *
 * Exported as the explicit switch for the behavior this module adds: pass
 * `{ enabled: false }` (or `maxRetries: 0`) to keep every plugin request
 * strictly single-shot. `maxRetries` is additionally capped by
 * {@link RATE_LIMIT_RETRY_LIMIT}, so no caller can widen this into an
 * unbounded loop.
 */
export interface RateLimitRetryPolicy {
    enabled: boolean;
    maxRetries: number;
}
/**
 * Plugin-wide default: one extra attempt, and only for a `429` that carries a
 * delay this module can parse. A `429` without a usable `Retry-After` is never
 * retried on a guess.
 */
export declare const DEFAULT_RATE_LIMIT_RETRY_POLICY: RateLimitRetryPolicy;
/** Hard ceiling this module enforces regardless of the supplied policy. */
export declare const RATE_LIMIT_RETRY_LIMIT: number;
export interface ResilientFetchOptions {
    /** The caller's signal; the per-attempt watchdog composes with it. */
    signal?: AbortSignal;
    /** Idle window for one attempt, in milliseconds. Non-positive disables it. */
    idleMs: number;
    /** Retry policy; defaults to {@link DEFAULT_RATE_LIMIT_RETRY_POLICY}. */
    policy?: RateLimitRetryPolicy;
    /** Clock used to resolve a stated delay; defaults to `Date.now`. */
    now?: () => number;
    /** Sleep hook, injectable so tests never wait on real time. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export interface ResilientFetchResult {
    response: Response;
    /** Extra attempts made after the first one (0 or 1 with the default policy). */
    retries: number;
    /** True when the returned response followed a rate-limited retry. */
    rateLimited: boolean;
}
/**
 * Run one request under an idle watchdog, retrying a stated `429` at most once.
 *
 * The attempt receives the watchdog's composed signal, so an idle request is
 * aborted rather than left hanging. Only a `429` is retried, only when
 * {@link retryAfterDelay} produced a definite wait, and only while the caller's
 * own signal is still live — a caller who cancelled is never re-requested on.
 * Any other status, and any `429` without a usable delay, is returned to the
 * caller exactly as the gateway sent it.
 */
export declare function fetchWithResilience(attempt: (signal: AbortSignal) => Promise<Response>, options: ResilientFetchOptions): Promise<ResilientFetchResult>;
/** Consecutive failures before an endpoint is parked. */
export declare const ENDPOINT_FAILURE_THRESHOLD: number;
/** How long a failure keeps counting as "the previous failure". */
export declare const ENDPOINT_FAILURE_MEMORY_MS: number;
/** Hard ceiling for one endpoint cooldown, whatever the gateway states. */
export declare const MAX_ENDPOINT_COOLDOWN_MS: number;
/** Upper bound on remembered endpoints; the least recently touched is dropped. */
export declare const MAX_TRACKED_ENDPOINTS: number;
/** What is remembered about one endpoint. */
export interface EndpointFailureRecord {
    /** Kind of the most recent failure. */
    kind: HttpFailureKind;
    /** Consecutive failures inside the memory window. */
    count: number;
    /** When the cooldown ends; `0` while the endpoint is not parked. */
    until: number;
    /** When this record itself goes stale. */
    expiresAt: number;
}
/** A parked endpoint, as reported to the caller kept away from it. */
export interface EndpointCooldown {
    /** Kind of the failure that parked the endpoint. */
    kind: HttpFailureKind;
    /** Consecutive failures that produced the cooldown. */
    failures: number;
    /** Milliseconds left before the endpoint is tried again. */
    retryAfterMs: number;
    /** One-line, human-readable reason, suitable for an error message. */
    message: string;
}
export interface EndpointCooldownOptions {
    /** Clock; defaults to `Date.now`. Injectable so tests never wait. */
    now?: () => number;
    /** Consecutive failures required to park; defaults to the module constant. */
    threshold?: number;
    /** Memory window; defaults to the module constant. */
    memoryMs?: number;
    /** Cooldown ceiling; defaults to the module constant. */
    maxCooldownMs?: number;
    /** Endpoint cap; defaults to the module constant. */
    maxEndpoints?: number;
}
/**
 * Canonical key for one endpoint: case-folded scheme and authority, trailing
 * slashes removed. The path keeps its case because paths are case-sensitive.
 */
export declare function normalizeEndpointKey(baseURL: string): string;
/**
 * Bounded, in-process memory of endpoint failures.
 *
 * Every method takes the endpoint the way the caller knows it (a `baseURL`) and
 * normalizes it, so `https://GW.example/V1/` and `https://gw.example/V1` share
 * one record. An empty key is neither remembered nor parked: an endpoint that
 * cannot be identified must not be able to silence anything.
 */
export declare class EndpointCooldownTracker {
    private readonly records;
    private readonly now;
    private readonly threshold;
    private readonly memoryMs;
    private readonly maxCooldownMs;
    private readonly maxEndpoints;
    constructor(options?: EndpointCooldownOptions);
    /** How many endpoints are remembered right now (never above the cap). */
    size(): number;
    /**
     * The cooldown keeping callers away from this endpoint, or `undefined` when
     * the endpoint may be tried. Records whose cooldown deadline has passed are
     * reported as available, so a cooldown always ends by itself.
     */
    check(baseURL: string): EndpointCooldown | undefined;
    /**
     * Remember one failed attempt.
     *
     * Returns the cooldown when this failure *started* one, so the caller can
     * append the reason to the error it is about to throw; otherwise `undefined`.
     * A failure that claims no cooldown at all (`permanent`, or a gateway that
     * stated `0`) is not remembered either: parking an endpoint over a malformed
     * request would punish a healthy route.
     */
    recordFailure(baseURL: string, failure: HttpFailure): EndpointCooldown | undefined;
    /** Forget this endpoint: one success means it is healthy again. */
    recordSuccess(baseURL: string): void;
    /** Drop every record. */
    clear(): void;
    private describe;
    private purge;
    private evict;
}
/**
 * Process-wide tracker shared by every request path this plugin issues, so an
 * endpoint that is down for a search is known to be down for image edits too.
 */
export declare const endpointCooldowns: EndpointCooldownTracker;
/**
 * The failure a transport-level error implies. A connection that never
 * answered, or went silent past the idle window, says nothing about *why*; the
 * conservative reading is momentary overload, which is exactly the bucket whose
 * cooldown is shortest.
 */
export declare const TRANSIENT_HTTP_FAILURE: HttpFailure;
/**
 * Render a cooldown that a failure just started as a suffix for an error
 * message, or nothing at all when the endpoint is still considered healthy.
 */
export declare function cooldownNote(cooldown: EndpointCooldown | undefined): string;
