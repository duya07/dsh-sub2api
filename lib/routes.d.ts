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
import type { Context } from '@deepseek-ai/cordis';
import { type ApiProtocol, type CatalogModel, type Config, type ImageToolsConfig, type ProviderEndpoint, type ProviderKey, type ProviderProfile } from './in./index.jsxport declare const ROUTES: {
    readonly get: "/plugins/dsh-sub2api/config";
    readonly set: "/plugins/dsh-sub2api/config";
    readonly discover: "/plugins/dsh-sub2api/discover";
    readonly usage: "/plugins/dsh-sub2api/usage";
    readonly status: "/plugins/dsh-sub2api/status";
    readonly attachment: "/plugins/dsh-sub2api/attachment";
    readonly reasoningStart: "/plugins/dsh-sub2api/reasoning/start";
    readonly reasoningStatus: "/plugins/dsh-sub2api/reasoning/status";
    readonly reasoningCancel: "/plugins/dsh-sub2api/reasoning/cancel";
};
/** One endpoint as the settings page sees it. Secrets are never echoed. */
export interface ConfigPayloadEndpoint {
    name: string;
    baseURL: string;
    platform: ProviderKey;
    /** Credential reference the page echoes back so a rename keeps its key. */
    apiKeyEnv?: string;
    keyConfigured: boolean;
    api?: ApiProtocol;
    models: CatalogModel[];
    /** Route id this endpoint currently resolves to. */
    route: string;
}
export interface ConfigPayload {
    baseURL: string;
    catalogFormat: 'structured-v1';
    providers: Record<string, {
        keyConfigured: boolean;
        models: CatalogModel[];
    }>;
    endpoints: ConfigPayloadEndpoint[];
    tools: ImageToolsConfig;
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
export declare function endpointCredentialRef(platform: ProviderKey, name: string, siblings: readonly ProviderEndpoint[]): string;
interface RouteContext {
    config: () => Config;
    setConfig: (config: Config) => void | Promise<void>;
    /** Preflight without mutation; the returned closure owns the settings commit. */
    prepareConfig?: (config: Config) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;
    listRegisteredRoutes: () => string[];
    /**
     * Resolve the stored credential for one provider route. Used by discovery
     * and usage probes when the settings form does not carry a freshly typed
     * key (keys are write-only and stay in the credential store).
     */
    resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>;
}
export type SettingsSaveOutcome = 'not-committed' | 'committed' | 'unknown';
/** An explicit attestation; a generic settings rejection is not a rollback receipt. */
export declare class ConfigSaveError extends Error {
    readonly outcome: SettingsSaveOutcome;
    constructor(outcome: SettingsSaveOutcome);
}
export declare function registerRoutes(ctx: Context, routes: RouteContext): void;
export {};
