/**
 * Tool names shared by this plugin's server half and its browser half.
 *
 * This module must stay dependency-free: the browser bundle inlines it, and
 * importing any server module (node:*, dsh-tools, dsh-llm, ...) from here would
 * drag the server half into the client build. Only plain constant exports
 * belong in this file.
 *
 * @module dsh-sub2api/shared/image-tool-names
 */
/**
 * The name this plugin registers by default.
 *
 * It is namespaced on purpose. `generate_image` is also registered by
 * dsh-image-gen, and the host refuses the second registrant of one name
 * (`tool "generate_image" is already registered ...`), so the plugin that
 * arrives last used to lose its tool entirely. A name no other plugin claims
 * lets both halves load in either order.
 */
export declare const STABLE_IMAGE_TOOL_NAME = "sub2api_generate_image";
/**
 * The upstream tool name, kept as an opt-in compatibility alias
 * (`tools.generate.compatToolName`) for callers that still say
 * `generate_image`. Registration is only attempted while the name is free, so
 * this plugin never displaces dsh-image-gen, and the alias needs a plugin
 * reload to appear or disappear.
 */
export declare const LEGACY_IMAGE_TOOL_NAME = "generate_image";
/** Name of the systemPrompt section that describes the image tool. */
export declare const IMAGE_TOOL_PROMPT_SECTION: string;
