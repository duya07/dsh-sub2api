/**
 * Global image-generation tool.
 *
 * These call a configured Sub2API model independently of the current chat
 * route, so a text-only session can still create images. Results include a workspace path and an image attachment.
 *
 * @module dsh-sub2api/image-tools
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Config, type ProviderProfile } from './index.js';
import { type EndpointCooldownTracker, type RateLimitRetryPolicy } from './http-resilience.js';
export declare const GENERATE_IMAGE_NAME = "generate_image";
export declare const DEFAULT_IMAGE_TOOL_TIMEOUT_MS = 180000;
export declare const DEFAULT_MAX_IMAGE_BYTES: number;
/**
 * How long one image-path request may stay silent before the idle watchdog
 * aborts it.
 *
 * `DEFAULT_IMAGE_TOOL_TIMEOUT_MS` above is a *total* budget: it cannot tell an
 * endpoint that is still rendering from one whose connection died, so a dead
 * socket used to hold the tool for the whole three minutes. A generation
 * endpoint normally answers within 10–60 seconds and a remote image URL within
 * a few seconds, so two silent minutes only ever fires on a genuinely stalled
 * request, while the total budget still applies on top.
 */
export declare const IMAGE_TOOL_IDLE_TIMEOUT_MS: number;
/**
 * The bounded retry policy for the image paths: at most one extra attempt, and
 * only for a `429` that states a delay this plugin can parse. Exported so a
 * host or a test can pass `{ enabled: false }` and get strictly single-shot
 * requests.
 */
export declare const IMAGE_TOOL_RATE_LIMIT_RETRY_POLICY: RateLimitRetryPolicy;
export interface ImageToolHost {
    config: () => Config;
    resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>;
    /**
     * Override the idle window of one gateway request. Defaults to
     * {@link IMAGE_TOOL_IDLE_TIMEOUT_MS}; a non-positive value disables the
     * watchdog.
     */
    idleTimeoutMs?: number;
    /** Override the bounded `429` retry policy. Defaults to {@link IMAGE_TOOL_RATE_LIMIT_RETRY_POLICY}. */
    rateLimitRetry?: RateLimitRetryPolicy;
    /**
     * Override the endpoint cooldown registry. Defaults to the process-wide
     * {@link endpointCooldowns}, which the web-search path shares, so one dead
     * gateway is remembered across both.
     */
    endpointCooldowns?: EndpointCooldownTracker;
}
export declare function registerImageTools(ctx: Context, host: ImageToolHost): void;
