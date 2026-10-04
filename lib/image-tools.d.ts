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
export declare const GENERATE_IMAGE_NAME = "generate_image";
export declare const DEFAULT_IMAGE_TOOL_TIMEOUT_MS = 180000;
export declare const DEFAULT_MAX_IMAGE_BYTES: number;
export interface ImageToolHost {
    config: () => Config;
    resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>;
}
export declare function registerImageTools(ctx: Context, host: ImageToolHost): void;
