import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { translateToPiAi, type PiAiModelProfile } from './pi-ai.ts'
import { API_PROTOCOLS, type ApiProtocol, type Config, type ProviderKey } from './index.ts'

export const PROBE_GAP_MS = 5000
// A control retry is only worth starting inside the task's own lifetime.
const PROBE_TASK_TTL_MS = 10 * 60 * 1000
export const PROBE_LEVELS = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ProbeLevel = typeof PROBE_LEVELS[number]
export type ProbeReason = 'queued' | 'accepted-parameter' | 'confirmed-rejection' | 'unconfirmed-rejection' | 'no-control' | 'parameter-not-exact' | 'budget-limited' | 'rate-limited' | 'auth-or-quota' | 'upstream-error' | 'ambiguous-error' | 'invalid-stream' | 'timeout' | 'cancelled' | 'sdk-unavailable'
export interface ProbeDraft {
  endpoint: { baseURL: string; platform: ProviderKey; api: ApiProtocol; apiKey: string; apiKeyEnv: string }
  model: { id: string; contextWindow?: number; maxTokens?: number }
  candidates: ProbeLevel[]
}
export interface ProbeLevelResult { level: ProbeLevel; state: 'accepted' | 'unsupported' | 'unknown'; reason: ProbeReason; maxTokens?: number; cap?: number; parameter?: string; value?: string }
export interface ProbeView {
  id: string
  phase: 'queued' | 'running' | 'completed' | 'aborted' | 'cancelled' | 'expired'
  /** Set only when the no-level control attempt ended the batch before any level was probed. */
  abortReason?: ProbeReason
  /** Set by the client when the batch never started. Aborted and unavailable are different outcomes. */
  unavailableReason?: string
  requests: number
  maxRequests: number
  minGapMs: number
  estimateMs: number
  levels: ProbeLevelResult[]
  suggestion: ProbeLevel[]
}
export interface AttemptResult { kind: 'accepted' | 'rejected' | 'unknown'; reason: ProbeReason; transmitted: boolean; retryAfterMs?: number; retryAfterUntil?: number; maxTokens?: number; cap?: number; parameter?: string; value?: string }
export interface ProbeAttempt { draft: ProbeDraft; key: string; level?: ProbeLevel; signal: AbortSignal; sent: () => void; now?: () => number; pauseUntil?: (until: number) => void }
export type ProbeTransport = (attempt: ProbeAttempt) => Promise<AttemptResult>

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function parseProbeDraft(value: unknown): ProbeDraft | undefined {
  const root = object(value), endpoint = object(root?.endpoint), model = object(root?.model)
  if (!endpoint || !model || !Array.isArray(root?.candidates)) return undefined
  const { baseURL, platform, api, apiKey = '', apiKeyEnv = '' } = endpoint
  if (typeof baseURL !== 'string' || baseURL.length > 2048 || !baseURL.trim()) return undefined
  try { const url = new URL(baseURL); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined } catch { return undefined }
  if (!['openai', 'claude', 'grok'].includes(String(platform)) || !API_PROTOCOLS.includes(api as ApiProtocol)) return undefined
  if (typeof apiKey !== 'string' || typeof apiKeyEnv !== 'string' || apiKey.length > 8192 || apiKeyEnv.length > 256 || (!apiKey.trim() && !apiKeyEnv.trim())) return undefined
  if (typeof model.id !== 'string' || !model.id.trim() || model.id.length > 256) return undefined
  for (const field of ['contextWindow', 'maxTokens']) if (model[field] !== undefined && (!Number.isSafeInteger(model[field]) || Number(model[field]) <= 0 || Number(model[field]) > 2000000)) return undefined
  const candidates = root.candidates
  if (!candidates.length || candidates.length > PROBE_LEVELS.length || candidates.some(level => !PROBE_LEVELS.includes(level as ProbeLevel)) || new Set(candidates).size !== candidates.length) return undefined
  return { endpoint: { baseURL: baseURL.trim(), platform: platform as ProviderKey, api: api as ApiProtocol, apiKey: apiKey.trim(), apiKeyEnv: apiKeyEnv.trim() }, model: { id: model.id.trim(), ...(model.contextWindow === undefined ? {} : {contextWindow: Number(model.contextWindow)}), ...(model.maxTokens === undefined ? {} : {maxTokens: Number(model.maxTokens)}) }, candidates: [...candidates] as ProbeLevel[] }
}

export function retryAfterMs(value: string | null, now: number): number {
  if (value === null) return 60000
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) && delay <= Number.MAX_SAFE_INTEGER ? Math.max(0, delay) : 60000
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : 60000
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) await sleepChunk(Math.min(2147483647, until - Date.now()), signal)
}

function sleepChunk(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal.aborted) return reject(new Error('cancelled'))
    const cancel = () => { clearTimeout(timer); reject(new Error('cancelled')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolveSleep() }, ms)
    timer.unref()
    signal.addEventListener('abort', cancel, { once: true })
  })
}

export class ProbeScheduler {
  private tail: Promise<unknown> = Promise.resolve()
  private nextAt = 0
  private pausedUntil = 0
  private pending = 0
  private readonly now: () => number
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>
  constructor(now: () => number = Date.now, wait: (ms: number, signal: AbortSignal) => Promise<void> = sleep) {this.now = now; this.wait = wait}
  estimate(): number { return Math.max(0, this.nextAt - this.now(), this.pausedUntil - this.now()) + this.pending * PROBE_GAP_MS }
  pauseUntil(until: number): void {this.pausedUntil = Math.max(this.pausedUntil, until)}
  run<T extends AttemptResult>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    this.pending++
    const result = this.tail.catch(() => {}).then(async () => {
      this.pending--
      if (signal.aborted) throw new Error('cancelled')
      let delay = Math.max(this.nextAt, this.pausedUntil) - this.now()
      while (delay > 0) {await this.wait(delay, signal); delay = Math.max(this.nextAt, this.pausedUntil) - this.now()}
      if (signal.aborted) throw new Error('cancelled')
      try {
        const outcome = await action()
        if (outcome.retryAfterUntil !== undefined) this.pauseUntil(outcome.retryAfterUntil)
        else if (outcome.retryAfterMs !== undefined) this.pauseUntil(this.now() + outcome.retryAfterMs)
        return outcome
      } finally { this.nextAt = this.now() + PROBE_GAP_MS }
    })
    this.tail = result
    return result
  }
}

// One scheduler per loaded server module, not per browser, route or endpoint.
const sharedScheduler = new ProbeScheduler()
interface ProbeTask { view: ProbeView; draft: ProbeDraft; key: string; controller: AbortController; timer: ReturnType<typeof setTimeout>; touched: number }
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
export class ReasoningProbeService {
  private readonly tasks = new Map<string, ProbeTask>()
  private disposed = false
  private readonly transport: ProbeTransport
  private readonly scheduler: ProbeScheduler
  private readonly now: () => number
  constructor(transport: ProbeTransport = createSdkProbeTransport(), scheduler: ProbeScheduler = sharedScheduler, now: () => number = Date.now) {this.transport = transport; this.scheduler = scheduler; this.now = now}
  start(draft: ProbeDraft, key: string): ProbeView | undefined {
    this.sweep()
    if (this.disposed || !key || [...this.tasks.values()].filter(task => ['queued', 'running'].includes(task.view.phase)).length >= 8 || this.tasks.size >= 64) return undefined
    const id = randomUUID(), controller = new AbortController()
    const view: ProbeView = { id, phase: 'queued', requests: 0, maxRequests: 1 + 3 * draft.candidates.length, minGapMs: PROBE_GAP_MS, estimateMs: this.scheduler.estimate() + (1 + 3 * draft.candidates.length) * PROBE_GAP_MS, levels: draft.candidates.map(level => ({level, state: 'unknown', reason: 'queued'})), suggestion: [...draft.candidates] }
    const timer = setTimeout(() => this.stop(id, 'expired'), PROBE_TASK_TTL_MS)
    timer.unref()
    const task: ProbeTask = {view, draft: structuredClone(draft), key, controller, timer, touched: this.now()}
    this.tasks.set(id, task)
    void this.execute(task)
    return this.copy(task)
  }
  status(id: string): ProbeView | undefined { this.sweep(); const task = this.tasks.get(id); return task ? this.copy(task) : undefined }
  cancel(id: string): ProbeView | undefined { this.stop(id, 'cancelled'); return this.status(id) }
  dispose(): void { this.disposed = true; for (const id of this.tasks.keys()) this.stop(id, 'cancelled') }
  private copy(task: ProbeTask): ProbeView {
    const view = structuredClone(task.view)
    if (['queued', 'running'].includes(view.phase)) view.estimateMs = this.scheduler.estimate() + Math.max(0, view.maxRequests - view.requests) * PROBE_GAP_MS
    return view
  }
  private sweep(): void { for (const [id, task] of this.tasks) if (!['queued', 'running'].includes(task.view.phase) && this.now() - task.touched > 15 * 60 * 1000) this.tasks.delete(id) }
  private stop(id: string, phase: 'cancelled' | 'expired'): void {
    const task = this.tasks.get(id)
    if (!task || !['queued', 'running'].includes(task.view.phase)) return
    task.view.phase = phase
    task.controller.abort()
    task.key = ''; task.draft.endpoint.apiKey = ''
    for (const level of task.view.levels) if (level.state === 'unknown') level.reason = phase === 'expired' ? 'timeout' : 'cancelled'
    clearTimeout(task.timer); task.touched = this.now()
  }
  private async attempt(task: ProbeTask, level?: ProbeLevel): Promise<AttemptResult> {
    return this.scheduler.run(task.controller.signal, async () => {
      task.view.phase = 'running'
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), 30000); timer.unref()
      try {
        const outcome = await this.transport({draft: task.draft, key: task.key, level, signal: AbortSignal.any([task.controller.signal, timeout.signal]), now: this.now, pauseUntil: until => this.scheduler.pauseUntil(until), sent: () => { if (!task.controller.signal.aborted) task.view.requests++ }})
        return timeout.signal.aborted ? {...outcome, kind: 'unknown', reason: 'timeout'} : outcome
      } catch {
        return {kind: 'unknown', reason: timeout.signal.aborted ? 'timeout' : task.controller.signal.aborted ? 'cancelled' : 'upstream-error', transmitted: false}
      } finally {clearTimeout(timer)}
    })
  }
  private abort(task: ProbeTask, reason: ProbeReason): void {
    task.view.phase = 'aborted'
    task.view.abortReason = reason
    for (const result of task.view.levels) result.reason = reason
  }
  private async execute(task: ProbeTask): Promise<void> {
    try {
      let initialControl = await this.attempt(task)
      if (task.controller.signal.aborted) return
      if (initialControl.reason === 'rate-limited') {
        // Exactly one retry: the transport already paused the shared scheduler until Retry-After,
        // so the retry cannot become a hidden burst. A window longer than the task's own lifetime
        // is not worth waiting out.
        const delay = initialControl.retryAfterUntil !== undefined ? initialControl.retryAfterUntil - this.now() : initialControl.retryAfterMs ?? 0
        if (delay <= PROBE_TASK_TTL_MS) {
          const retry = await this.attempt(task)
          if (task.controller.signal.aborted) return
          if (retry.kind !== 'accepted' || !retry.transmitted) {this.abort(task, retry.reason); return}
          initialControl = retry
        }
      }
      if (['auth-or-quota', 'sdk-unavailable', 'rate-limited'].includes(initialControl.reason)) {
        this.abort(task, initialControl.reason)
        return
      }
      for (const result of task.view.levels) {
        if (task.controller.signal.aborted) return
        const first = await this.attempt(task, result.level)
        if (task.controller.signal.aborted) return
        if (first.kind === 'accepted' && first.transmitted) { result.state = 'accepted'; result.reason = 'accepted-parameter'; continue }
        result.reason = first.reason
        if (first.maxTokens !== undefined) result.maxTokens = first.maxTokens
        if (first.cap !== undefined) result.cap = first.cap
        if (first.parameter !== undefined) result.parameter = first.parameter
        if (first.value !== undefined) result.value = first.value
        if (first.kind !== 'rejected' || !first.transmitted) continue
        const rejectedAt = this.now()
        // A fresh same-context control prevents an unrelated failure from removing a level.
        const control = await this.attempt(task)
        if (task.controller.signal.aborted) return
        if (control.kind !== 'accepted' || !control.transmitted) {result.reason = 'no-control'; continue}
        const repeated = await this.attempt(task, result.level)
        if (task.controller.signal.aborted) return
        if (repeated.kind === 'rejected' && repeated.transmitted && this.now() - rejectedAt >= PROBE_GAP_MS) {
          result.state = 'unsupported'; result.reason = 'confirmed-rejection'
        } else if (repeated.kind === 'accepted' && repeated.transmitted) {
          result.state = 'accepted'; result.reason = 'accepted-parameter'
        } else result.reason = 'unconfirmed-rejection'
      }
    } catch {
      if (!task.controller.signal.aborted) for (const result of task.view.levels) if (result.reason === 'queued') result.reason = 'upstream-error'
    } finally {
      if (!task.controller.signal.aborted && task.view.phase !== 'aborted') task.view.phase = 'completed'
      task.view.suggestion = task.view.levels.filter(level => level.state !== 'unsupported').map(level => level.level)
      task.view.estimateMs = 0
      task.key = ''; task.draft.endpoint.apiKey = ''
      clearTimeout(task.timer); task.touched = this.now()
    }
  }
}

// `compat` is not decoration: pi-ai selects the anthropic thinking shape from
// the model alone, so a probe model built without it silently probes a wire
// shape the real route never sends.
interface WireModel { id: string; name: string; api: ApiProtocol; provider: string; baseUrl: string; reasoning: boolean; thinkingLevelMap: Record<string, string | null>; input: string[]; cost: {input: number; output: number; cacheRead: number; cacheWrite: number}; contextWindow: number; maxTokens: number; compat?: PiAiModelProfile['compat'] }
interface SdkStream { result: () => Promise<{stopReason?: string; content?: {type: string; text?: string}[]}> }
type SdkModule = {streamSimple: (model: WireModel, context: unknown, options: Record<string, unknown>) => SdkStream}
export type SdkLoader = (api: ApiProtocol) => Promise<SdkModule>

export async function loadPeerProbeSdk(api: ApiProtocol): Promise<SdkModule> {
  const peer = import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai')
  const requirePeer = createRequire(peer)
  for (const directory of requirePeer.resolve.paths('@earendil-works/pi-ai') ?? []) {
    const root = join(directory, '@earendil-works/pi-ai')
    try {
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
      if (manifest.name !== '@earendil-works/pi-ai') continue
      const entry = manifest.exports?.['./api/*']?.import
      if (typeof entry !== 'string') continue
      const path = resolve(root, entry.replace('*', api))
      if (!path.startsWith(`${resolve(root)}/`) && !path.startsWith(`${resolve(root)}\\`)) continue
      return await import(pathToFileURL(path).href) as SdkModule
    } catch { /* Try the next dependency resolution directory, never a gateway. */ }
  }
  throw new Error('sdk-unavailable')
}

export function probeWireModel(draft: ProbeDraft): WireModel {
  const profiles = translateToPiAi({baseURL: draft.endpoint.baseURL, providers: {openai: {}, claude: {}, grok: {}}, endpoints: [{name: 'reasoning-probe', platform: draft.endpoint.platform, baseURL: draft.endpoint.baseURL, apiKeyEnv: 'PROBE_ONLY', api: draft.endpoint.api, models: [{...draft.model, reasoningEfforts: draft.candidates}]}]} as Config)
  const [route, profile] = Object.entries(profiles)[0]!
  const model = profile.models![0]!
  const efforts = model.reasoningEfforts
  const map: Record<string, string | null> = {}
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const value = efforts && typeof efforts === 'object' ? efforts[level as keyof typeof efforts] : undefined
    if (value !== null) map[level] = value ?? null
  }
  // The translated profile already decided the wire shape (translateModel sets
  // `compat.forceAdaptiveThinking` for anthropic routes); this hand-built
  // literal is the last step before the SDK, so dropping the field here would
  // undo that decision and probe the fixed-budget shape instead.
  return {id: model.id, name: model.name ?? model.id, api: profile.api as ApiProtocol, provider: route, baseUrl: profile.baseURL!, input: model.input ?? ['text'], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: model.contextWindow ?? profile.defaultContextWindow!, maxTokens: model.maxTokens ?? profile.defaultMaxTokens!, reasoning: true, thinkingLevelMap: map, compat: model.compat}
}

// The fixed thinking budgets pi-ai assigns per level (its `DEFAULT_THINKING_BUDGETS`),
// with xhigh/max folded onto `high` exactly as its `clampReasoning` folds them.
// A probe has to know them, because the budget-based anthropic shape adds the
// budget on top of the output budget it was asked for.
const PROBE_THINKING_BUDGETS: Readonly<Partial<Record<ProbeLevel, number>>> = {minimal: 1024, low: 2048, medium: 8192, high: 16384}
const PROBE_DEEPEST_THINKING_BUDGET = 16384
// Below this the payload is not worth judging: inspectProbeWire rejects it anyway.
const PROBE_MIN_MAX_TOKENS = 1024
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
export const PROBE_MAX_TOKENS_CEILING: number = PROBE_DEEPEST_THINKING_BUDGET * 2

/** The thinking budget pi-ai will add for this level, or undefined when it adds none. */
export function probeThinkingBudget(level: ProbeLevel | undefined): number | undefined {
  if (level === undefined || level === 'off' || level === 'none') return undefined
  return PROBE_THINKING_BUDGETS[level === 'xhigh' || level === 'max' ? 'high' : level]
}

export interface ProbeWireBudget { cap: number; maxTokens: number }
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
export function probeWireBudget(model: WireModel, level: ProbeLevel | undefined): ProbeWireBudget {
  const cap = Math.min(model.maxTokens, PROBE_MAX_TOKENS_CEILING)
  const budget = model.api === 'anthropic-messages' && model.compat?.forceAdaptiveThinking !== true ? probeThinkingBudget(level) : undefined
  const maxTokens = budget === undefined ? cap : Math.max(PROBE_MIN_MAX_TOKENS, Math.min(cap, cap - budget))
  return {cap, maxTokens}
}

interface ExactWire { exact: boolean; reason: ProbeReason; parameter?: string; value?: string }
// A parameter-not-exact verdict only says "the parameter did not survive the SDK".
// That is not actionable on its own, so whenever the wire payload was readable
// the verdict also carries the parameter name and the value that actually went
// out, and the settings page can state the difference instead of guessing.
function notExact(parameter?: string, value?: unknown): ExactWire {
  const sent = typeof value === 'string' ? value : value === undefined ? undefined : JSON.stringify(value) ?? String(value)
  return {
    exact: false,
    reason: 'parameter-not-exact',
    ...(parameter === undefined ? {} : { parameter }),
    ...(sent === undefined ? {} : { value: sent }),
  }
}
export function inspectProbeWire(api: ApiProtocol, level: ProbeLevel | undefined, payload: Record<string, unknown>, cap: number): ExactWire {
  if (level === undefined) return {exact: true, reason: 'accepted-parameter'}
  if (api === 'openai-responses' || api === 'openai-completions') {
    const parameter = api === 'openai-responses' ? 'reasoning.effort' : 'reasoning_effort'
    const value = api === 'openai-responses' ? object(payload.reasoning)?.effort : payload.reasoning_effort
    if (value !== level || level === 'off') return notExact(parameter, value)
    const tokens = api === 'openai-responses' ? payload.max_output_tokens : payload.max_completion_tokens ?? payload.max_tokens
    if (typeof tokens !== 'number' || tokens < 1024 || tokens > cap) return {exact: false, reason: 'budget-limited'}
    return {exact: true, reason: 'accepted-parameter', parameter, value: level}
  }
  const thinking = object(payload.thinking)
  if (level === 'off' || level === 'none') return {exact: false, reason: 'parameter-not-exact'}
  if (thinking?.type === 'adaptive') {
    if (typeof payload.max_tokens !== 'number' || payload.max_tokens < 1024 || payload.max_tokens > cap) return {exact: false, reason: 'budget-limited'}
    // Mid-conversation effort uses a system message while forcing wire effort to high.
    if (Array.isArray(payload.messages) && payload.messages.some(message => object(message)?.role === 'system')) return {exact: false, reason: 'parameter-not-exact'}
    const effort = object(payload.output_config)?.effort
    if (effort !== level) return notExact('output_config.effort', effort)
    return {exact: true, reason: 'accepted-parameter', parameter: 'output_config.effort', value: level}
  }
  // The same budget table the request was built from, so a level can never be
  // judged against a budget the probe did not ask for. xhigh and max fold onto
  // `high` here exactly as pi-ai folds them on the way out.
  const budget = probeThinkingBudget(level)
  if (!budget || thinking?.type !== 'enabled') return notExact('thinking.type', thinking?.type)
  if (thinking.budget_tokens !== budget || typeof payload.max_tokens !== 'number' || payload.max_tokens < budget + 1024 || payload.max_tokens > cap) return {exact: false, reason: 'budget-limited'}
  // Budgets encode the host's level but an error about numeric tokens cannot reject an effort enum.
  return {exact: true, reason: 'accepted-parameter'}
}

export function classifyProbeError(status: number, value: unknown, exact: ExactWire): AttemptResult {
  if (status === 429) return {kind: 'unknown', reason: 'rate-limited', transmitted: true}
  if (status === 401 || status === 403) return {kind: 'unknown', reason: 'auth-or-quota', transmitted: true}
  if (status >= 500) return {kind: 'unknown', reason: 'upstream-error', transmitted: true}
  const error = object(object(value)?.error)
  if ((status === 400 || status === 422) && exact.exact && exact.parameter && exact.value && error?.param === exact.parameter && typeof error.message === 'string') {
    const escaped = exact.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const quoted = `["'\x60]${escaped}["'\x60]`
    const message = error.message.trim().replace(/\s+/g, ' ')
    // Only a direct leading assertion is evidence; quotes and negated mentions are not.
    const rejection = new RegExp(`^(?:(?:unsupported|invalid)\\s+(?:(?:reasoning[ _-]?effort|effort|value|enum)(?:\\s+value)?)\\s*:?\\s*${quoted}|${quoted}\\s+(?:is\\s+)?(?:unsupported|not supported|invalid|not allowed))(?=$|[.;,:])`, 'i').exec(message)
    const positiveClause = new RegExp(`${quoted}\\s+(?:is\\s+)?(?:supported|valid|allowed)`, 'i').test(message)
    const allowedLists = message.match(/\b(?:supported|allowed|valid)\s+values?[^.;]*/gi) ?? []
    const inAllowedList = allowedLists.some(list => new RegExp(quoted, 'i').test(list))
    const ambiguousAssertion = /\b(?:not|never|false|incorrect|example|quoted?|quotation)\b/i.test(message.slice(rejection?.[0].length ?? 0))
    const ambiguousBudget = /\b(?:tokens?|budget|context|quota|capacity|timeout|rate[ -]?limit)\b|insufficient|too (?:small|large)/i.test(error.message)
    const code = error.code
    if (rejection && !positiveClause && !inAllowedList && !ambiguousAssertion && !ambiguousBudget && (code === undefined || ['unsupported_value', 'invalid_value', 'invalid_enum_value', 'unsupported_parameter_value'].includes(String(code)))) return {kind: 'rejected', reason: 'unconfirmed-rejection', transmitted: true}
  }
  return {kind: 'unknown', reason: 'ambiguous-error', transmitted: true}
}

interface StreamEvidence { terminal: boolean; stopped: boolean; model: boolean; error: boolean; text: boolean }
function observeSse(api: ApiProtocol, model: string, data: string, evidence: StreamEvidence, event: string): void {
  if (/(?:^|\.)(?:error|failed|incomplete)$/.test(event)) evidence.error = true
  if (data === '[DONE]') {if (api === 'openai-completions') evidence.terminal = true; return}
  let value: Record<string, unknown>
  try { const parsed = object(JSON.parse(data)); if (!parsed) {evidence.error = true; return}; value = parsed } catch {evidence.error = true; return}
  const response = object(value.response), message = object(value.message)
  const id = response?.model ?? message?.model ?? value.model
  if (id !== undefined) {if (id !== model) evidence.error = true; else evidence.model = true}
  if (value.error || value.type === 'error' || String(value.type).includes('failed') || String(value.type).includes('incomplete')) evidence.error = true
  if (api === 'openai-responses') {
    if (value.type === 'response.output_text.delta' && typeof value.delta === 'string' && value.delta.trim()) evidence.text = true
    if (value.type === 'response.completed') {evidence.terminal = true; evidence.stopped = response?.status === 'completed'}
  } else if (api === 'openai-completions') {
    for (const choice of Array.isArray(value.choices) ? value.choices : []) {
      const item = object(choice), delta = object(item?.delta)
      if (typeof delta?.content === 'string' && delta.content.trim()) evidence.text = true
      if (item?.finish_reason === 'stop') evidence.stopped = true
      else if (item?.finish_reason != null) evidence.error = true
    }
  } else {
    if (value.type === 'content_block_delta' && object(value.delta)?.type === 'text_delta' && String(object(value.delta)?.text ?? '').trim()) evidence.text = true
    if (value.type === 'message_delta') evidence.stopped = object(value.delta)?.stop_reason === 'end_turn'
    if (value.type === 'message_stop') evidence.terminal = true
  }
}

function observedBody(response: Response, api: ApiProtocol, model: string, evidence: StreamEvidence): Response {
  if (!response.body) {evidence.error = true; return response}
  const decoder = new TextDecoder(), encoder = new TextEncoder()
  let pending = '', bytes = 0
  const read = (text: string) => {
    pending = (pending + text).replace(/\r\n/g, '\n')
    const blocks: string[] = []
    let split
    while ((split = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, split); pending = pending.slice(split + 2)
      const lines = block.split('\n')
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      const event = lines.filter(line => line === 'event' || line.startsWith('event:')).at(-1)?.slice(6).trimStart() ?? ''
      if (data || event) observeSse(api, model, data, evidence, event)
      blocks.push(`${block}\n\n`)
    }
    return blocks
  }
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength
      if (bytes > 1024 * 1024) {evidence.error = true; throw new Error('invalid-stream')}
      const blocks = read(decoder.decode(chunk, {stream: true}))
      if (evidence.error) throw new Error('invalid-stream')
      for (const block of blocks) controller.enqueue(encoder.encode(block))
    }, flush(controller) {
      const blocks = read(decoder.decode())
      if (pending.trim() || evidence.error) {evidence.error = true; throw new Error('invalid-stream')}
      for (const block of blocks) controller.enqueue(encoder.encode(block))
    },
  }))
  return new Response(body, {status: response.status, headers: response.headers})
}

async function boundedError(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  let size = 0, text = ''
  const decoder = new TextDecoder()
  const abort = () => {void reader.cancel().catch(() => {})}
  signal.addEventListener('abort', abort, {once: true})
  try {
    if (signal.aborted) return undefined
    for (;;) {const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 65536) return undefined; text += decoder.decode(value, {stream: true})}
    return JSON.parse(text + decoder.decode()) as unknown
  } catch {return undefined} finally {signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {})}
}

export function createSdkProbeTransport(options: {fetch?: typeof fetch; loadSdk?: SdkLoader; now?: () => number} = {}): ProbeTransport {
  return async ({draft, key, level, signal, sent, now = options.now ?? Date.now, pauseUntil}) => {
    let sdk: SdkModule
    try {sdk = await (options.loadSdk ?? loadPeerProbeSdk)(draft.endpoint.api)} catch {return {kind: 'unknown', reason: 'sdk-unavailable', transmitted: false}}
    const model = probeWireModel(draft), wire = probeWireBudget(model, level)
    // Predicting a budget conclusion from the model's own maxTokens was wrong
    // for every protocol, so nothing is short-circuited here any more. The
    // probe asks for `wire.maxTokens`, and what reaches the wire is the SDK's
    // own arithmetic on top of that: the budget-based anthropic shape adds its
    // thinking budget and clamps the result to the model's own cap, while the
    // adaptive shape and the openai-family protocols write the requested value
    // out unchanged. maxTokens > cap therefore implies nothing about the
    // payload, and guessing "budget-limited" from it stranded all five levels
    // before a single request went out. inspectProbeWire judges the payload the
    // SDK actually built, against the same cap this request was built from.
    let outcome: AttemptResult | undefined, transmitted = false, calls = 0
    let pause: Pick<AttemptResult, 'retryAfterMs' | 'retryAfterUntil'> = {}
    const evidence: StreamEvidence = {terminal: false, stopped: false, model: false, error: false, text: false}
    const independentFetch: typeof fetch = async (input, init) => {
      if (signal.aborted || calls++) throw new Error('cancelled')
      let payload: Record<string, unknown> | undefined
      try {payload = object(JSON.parse(String(init?.body ?? '')))} catch { /* Missing JSON is not verifiable. */ }
      const exact = payload ? inspectProbeWire(model.api, level, payload, wire.cap) : {exact: false, reason: 'parameter-not-exact' as const}
      // Carry the two numbers the verdict was computed from, so the UI can state
      // why a level never went out instead of only naming the reason.
      const budget = exact.reason === 'budget-limited' ? {maxTokens: model.maxTokens, cap: wire.cap} : {}
      // A not-exact verdict carries the wire parameter and the value that went
      // out, so the level can be rendered with the difference it observed.
      const mismatch = exact.reason === 'parameter-not-exact' ? {parameter: exact.parameter, value: exact.value} : {}
      if (!exact.exact || payload?.model !== model.id) {outcome = {kind: 'unknown', reason: exact.reason, transmitted: false, ...budget, ...mismatch}; throw new Error('parameter-not-exact')}
      transmitted = true; sent()
      const response = await (options.fetch ?? fetch)(input, {...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])])})
      if (!response.ok) {
        if (response.status === 429) {
          const receivedAt = now(), retry = retryAfterMs(response.headers.get('retry-after'), receivedAt)
          pause = {retryAfterMs: retry, retryAfterUntil: receivedAt + retry}
          // The header already establishes a global deadline even if reading the body stalls or aborts.
          pauseUntil?.(pause.retryAfterUntil!)
        }
        outcome = {...classifyProbeError(response.status, undefined, exact), ...pause}
        outcome = {...classifyProbeError(response.status, await boundedError(response.clone(), signal), exact), ...pause}
        void response.body?.cancel().catch(() => {})
        return new Response(JSON.stringify({error: {message: 'probe-upstream-error', type: 'invalid_request_error'}}), {status: response.status, headers: {'content-type': 'application/json'}})
      }
      return observedBody(response, model.api, model.id, evidence)
    }
    try {
      // The cap is always stated, even when the catalog omits an output size:
      // the number judged and the number requested have to be the same one, and
      // an implicit value is whatever the profile default happens to be.
      const stream = sdk.streamSimple(model, {messages: [{role: 'user', content: 'Reply exactly OK.', timestamp: 0}]}, {apiKey: key, maxTokens: wire.maxTokens, maxRetries: 0, signal, fetch: independentFetch, ...(level === undefined || level === 'off' || level === 'none' ? {} : {reasoning: level})})
      const result = await stream.result()
      if (signal.aborted) return {kind: 'unknown', reason: 'cancelled', transmitted, ...pause}
      if (outcome) return outcome
      if (transmitted && evidence.terminal && evidence.stopped && evidence.model && evidence.text && !evidence.error && result.stopReason === 'stop' && result.content?.some(item => item.type === 'text' && item.text?.trim())) return {kind: 'accepted', reason: 'accepted-parameter', transmitted: true}
      return {kind: 'unknown', reason: 'invalid-stream', transmitted}
    } catch {
      return signal.aborted ? {kind: 'unknown', reason: 'cancelled', transmitted, ...pause} : outcome ?? {kind: 'unknown', reason: 'upstream-error', transmitted, ...pause}
    }
  }
}
