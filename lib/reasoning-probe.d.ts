import { type PiAiModelProfile } from './pi-ai.js';
import { type ApiProtocol, type ProviderKey } from './index.js';
export declare const PROBE_GAP_MS = 5000;
export declare const PROBE_LEVELS: readonly ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
export type ProbeLevel = typeof PROBE_LEVELS[number];
export type ProbeReason = 'queued' | 'accepted-parameter' | 'confirmed-rejection' | 'unconfirmed-rejection' | 'no-control' | 'parameter-not-exact' | 'budget-limited' | 'rate-limited' | 'auth-or-quota' | 'upstream-error' | 'ambiguous-error' | 'invalid-stream' | 'timeout' | 'cancelled' | 'sdk-unavailable';
export interface ProbeDraft {
    endpoint: {
        baseURL: string;
        platform: ProviderKey;
        api: ApiProtocol;
        apiKey: string;
        apiKeyEnv: string;
    };
    model: {
        id: string;
        contextWindow?: number;
        maxTokens?: number;
    };
    candidates: ProbeLevel[];
}
export interface ProbeLevelResult {
    level: ProbeLevel;
    state: 'accepted' | 'unsupported' | 'unknown';
    reason: ProbeReason;
    maxTokens?: number;
    cap?: number;
    parameter?: string;
    value?: string;
}
export interface ProbeView {
    id: string;
    phase: 'queued' | 'running' | 'completed' | 'aborted' | 'cancelled' | 'expired';
    /** Set only when the no-level control attempt ended the batch before any level was probed. */
    abortReason?: ProbeReason;
    /** Set by the client when the batch never started. Aborted and unavailable are different outcomes. */
    unavailableReason?: string;
    requests: number;
    maxRequests: number;
    minGapMs: number;
    estimateMs: number;
    levels: ProbeLevelResult[];
    suggestion: ProbeLevel[];
}
export interface AttemptResult {
    kind: 'accepted' | 'rejected' | 'unknown';
    reason: ProbeReason;
    transmitted: boolean;
    retryAfterMs?: number;
    retryAfterUntil?: number;
    maxTokens?: number;
    cap?: number;
    parameter?: string;
    value?: string;
}
export interface ProbeAttempt {
    draft: ProbeDraft;
    key: string;
    level?: ProbeLevel;
    signal: AbortSignal;
    sent: () => void;
    now?: () => number;
    pauseUntil?: (until: number) => void;
}
export type ProbeTransport = (attempt: ProbeAttempt) => Promise<AttemptResult>;
export declare function parseProbeDraft(value: unknown): ProbeDraft | undefined;
export declare function retryAfterMs(value: string | null, now: number): number;
export declare class ProbeScheduler {
    private tail;
    private nextAt;
    private pausedUntil;
    private pending;
    private readonly now;
    private readonly wait;
    constructor(now?: () => number, wait?: (ms: number, signal: AbortSignal) => Promise<void>);
    estimate(): number;
    pauseUntil(until: number): void;
    run<T extends AttemptResult>(signal: AbortSignal, action: () => Promise<T>): Promise<T>;
}
/**
 * Verification, not generation.
 *
 * The probe's only product is a `ProbeView`: per-level evidence about the
 * levels the user already declared, plus a suggestion. It never writes a
 * configuration — not the catalog, not the endpoint, not the model row — and it
 * does not decide which levels a model supports. The static table and the
 * user's own declarations stay authoritative; a probe that cannot run, or that
 * ends without a confirmed rejection, leaves them exactly as they were and the
 * level is reported as unknown. The caller keeps the draft it handed in
 * (cloned below), so a failed probe cannot even mutate its input.
 */
export declare class ReasoningProbeService {
    private readonly tasks;
    private disposed;
    private readonly transport;
    private readonly scheduler;
    private readonly now;
    constructor(transport?: ProbeTransport, scheduler?: ProbeScheduler, now?: () => number);
    start(draft: ProbeDraft, key: string): ProbeView | undefined;
    status(id: string): ProbeView | undefined;
    cancel(id: string): ProbeView | undefined;
    dispose(): void;
    private copy;
    private sweep;
    private stop;
    private attempt;
    private abort;
    private execute;
}
interface WireModel {
    id: string;
    name: string;
    api: ApiProtocol;
    provider: string;
    baseUrl: string;
    reasoning: boolean;
    thinkingLevelMap: Record<string, string | null>;
    input: string[];
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    compat?: PiAiModelProfile['compat'];
}
interface SdkStream {
    result: () => Promise<{
        stopReason?: string;
        content?: {
            type: string;
            text?: string;
        }[];
    }>;
}
type SdkModule = {
    streamSimple: (model: WireModel, context: unknown, options: Record<string, unknown>) => SdkStream;
};
export type SdkLoader = (api: ApiProtocol) => Promise<SdkModule>;
export declare function loadPeerProbeSdk(api: ApiProtocol): Promise<SdkModule>;
export declare function probeWireModel(draft: ProbeDraft): WireModel;
/**
 * Hard ceiling for the output budget a probe may put on the wire.
 *
 * Two measured bounds fix this number; neither is decoration.
 *
 * Lower bound — it must be at least the deepest fixed thinking budget plus an
 * equal allowance for the answer itself. The budget-based anthropic shape adds
 * its thinking budget on top of the requested output budget, so a ceiling below
 * twice the deepest budget could never probe that shape exactly. Twice the
 * deepest budget is the smallest value that can.
 *
 * Upper bound — it must stay below the smallest output cap the upstreams behind
 * this catalog actually enforce. On the anthropic route the upstream validates
 * `max_tokens` per model and states its own cap in the 400 body (measured:
 * 64000 for claude-haiku-4-5 and claude-opus-4-5, 128000 for the opus-5 /
 * sonnet-5 / fable-5 families), so a probe that asked for more than the model's
 * cap would be rejected instead of probed. The openai route does not validate at
 * all (measured: 9999999 was answered, not rejected and not stalled), so there
 * the ceiling is what keeps a probe's declared budget honest.
 *
 * Both bounds are met by the same value, so this is the smallest ceiling that
 * works rather than a number chosen to make the code run.
 * Evidence: `sub2api-ref/cc-switch-port/09-ceiling-probe.md`.
 */
export declare const PROBE_MAX_TOKENS_CEILING: number;
/** The thinking budget pi-ai will add for this level, or undefined when it adds none. */
export declare function probeThinkingBudget(level: ProbeLevel | undefined): number | undefined;
export interface ProbeWireBudget {
    cap: number;
    maxTokens: number;
}
/**
 * The single place that decides how much output a probe asks for and how much
 * it will accept, so the request and the verdict cannot disagree.
 *
 * `cap` is the model's own output ceiling bounded by the probe ceiling, and it
 * is the number `inspectProbeWire` judges the payload against. `maxTokens` is
 * chosen so that what the SDK builds lands on that cap for either anthropic
 * thinking shape:
 *
 * - the adaptive shape and the openai protocols put the requested value on the
 *   wire unchanged, so the probe asks for the cap;
 * - the budget-based shape adds the thinking budget on top of it
 *   (`min(base + budget, model.maxTokens)`), so asking for the cap would put
 *   `cap + budget` on the wire and be judged budget-limited on every level,
 *   forever. Asking for `cap - budget` makes the sum land on the cap again.
 *
 * The budget is only subtracted for the shape that actually adds one, so a
 * small model cap is never spent on a budget that is not sent.
 */
export declare function probeWireBudget(model: WireModel, level: ProbeLevel | undefined): ProbeWireBudget;
interface ExactWire {
    exact: boolean;
    reason: ProbeReason;
    parameter?: string;
    value?: string;
}
export declare function inspectProbeWire(api: ApiProtocol, level: ProbeLevel | undefined, payload: Record<string, unknown>, cap: number): ExactWire;
export declare function classifyProbeError(status: number, value: unknown, exact: ExactWire): AttemptResult;
export declare function createSdkProbeTransport(options?: {
    fetch?: typeof fetch;
    loadSdk?: SdkLoader;
    now?: () => number;
}): ProbeTransport;
export {};
