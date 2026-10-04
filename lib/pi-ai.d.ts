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
import type { Context } from '@deepseek-ai/cordis';
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import type { Config, ProviderEndpoint, ProviderKey } from './index.ts';
/./index.jstings namespace owned by dsh-llm-pi-ai. */
export declare const PI_AI_NS = "llm-pi-ai";
/** Route prefix this plugin's groups own in the llm-pi-ai profile dict. */
export declare const ROUTE_PREFIX: string;
export type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai';
/** The llm-pi-ai settings section value this plugin writes. */
export interface PiAiSettingsSection {
    providers?: Record<string, PiAiProviderProfile>;
}
/** Display label for one platform, used when an endpoint carries no name. */
export declare function platformLabel(platform: ProviderKey): string;
/**
 * Route id for one endpoint.
 *
 * Compatibility is the whole point of this function: agent presets, the
 * default-model setting and the user's own notes all name routes, so an
 * unnamed endpoint that is the only one on its platform keeps the historical
 * `sub2api-<platform>` id. A name — or a sibling on the same platform —
 * switches it to `sub2api-<platform>-<slug>`.
 */
export declare function endpointRoute(endpoint: ProviderEndpoint, all: readonly ProviderEndpoint[]): string;
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
export declare function translateToPiAi(config: Config): Record<string, PiAiProviderProfile>;
/**
 * Write the translated profiles into the `llm-pi-ai` settings section. Routes
 * under this plugin's `sub2api-` prefix are replaced wholesale; any other
 * route the user configured (e.g. through the built-in Models page) is
 * preserved. The write goes through the settings service, so dsh-llm-pi-ai's
 * own validation (schema + `assertServiceable`) refuses an unserviceable
 * profile at the write site and the section keeps its last good value.
 */
export declare function syncPiAiProfiles(ctx: Context, config: Config): Promise<void>;
