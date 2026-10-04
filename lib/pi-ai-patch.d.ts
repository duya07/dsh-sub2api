/**
 * Best-effort defense guard for pi-ai's prefix-token estimation.
 *
 * Background: pi-ai's `AssistantMessage.usage` is required in its types and
 * `estimateContextTokens` dereferences `usage.totalTokens` on that contract.
 * The harness path is already safe — `dsh-llm-pi-ai` attaches a zero `Usage`
 * (`emptyPiUsage()`) to every reconstructed assistant message. The guard here
 * only defends against *other* callers that build pi-ai contexts without
 * `usage` (hand-rolled clients, future adapters), which would otherwise die
 * with a bare `Cannot read properties of undefined (reading 'totalTokens')`
 * deep inside estimation.
 *
 * This plugin cannot control the pi-ai version through npm — Node resolves
 * pi-ai from the dsh install, not from this package. So the guard is applied
 * as a precise idempotent edit to the bundled `estimate.js`:
 *
 * ```js
 *   assistant.stopReason !== "error" &&
 *   assistant.usage !== undefined &&
 *   calculateContextTokens(assistant.usage) > 0
 * ```
 *
 * It runs at plugin apply time — before any pi-ai request (pi-ai's API modules
 * are lazy-loaded, so `estimate.js` is only imported on the first stream). A
 * refusal to write (read-only install) only logs a warning; the harness path
 * works without the guard, and an upstream pi-ai guard makes this a no-op.
 *
 * @module dsh-sub2api/pi-ai-patch
 */
/** Outcome of one patch attempt. */
export type PiAiPatchResult = {
    kind: 'patched';
    file: string;
} | {
    kind: 'already';
    file: string;
} | {
    kind: 'skipped';
    reason: string;
};
/**
 * Apply the multi-turn guard to the dsh-bundled pi-ai `estimate.js` when it is
 * missing. Idempotent; only a byte-exact edit is ever made.
 */
export declare function applyPiAiMultiTurnPatch(): PiAiPatchResult;
