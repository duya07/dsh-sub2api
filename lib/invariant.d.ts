/**
 * Load-time invariant checks for dsh-sub2api.
 *
 * The host half declares `inject: ['llm', 'settings', 'credentials']`; the
 * loader surfaces a missing provider as a waiting row, so a dedicated
 * invariant would only duplicate that signal. This module exists to keep the
 * package's export surface stable (lib/invariant.js) and to host any future
 * structural checks.
 *
 * @module dsh-sub2api/invariant
 */
export declare function invariant(condition: unknown, message: string): asserts condition;
export default invariant;
