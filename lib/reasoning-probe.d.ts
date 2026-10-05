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
}
export interface ProbeView {
    id: string;
    phase: 'queued' | 'running' | 'completed' | 'aborted' | 'cancelled' | 'expired';
    /** Set only when the no-level control attempt ended the batch before any level was probed. */
    abortReason?: ProbeReason;
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
