import z from "@deepseek-ai/schemastery";
import { LlmError, LlmError as LlmError$1, assertUsableApiKey, assertUsableApiKey as assertUsableApiKey$1, attributionHeaders } from "@deepseek-ai/dsh-llm";
import { credentialRef, credentialRef as credentialRef$1 } from "@deepseek-ai/dsh-credentials";
import { Config as PiAiSectionSchema } from "@deepseek-ai/dsh-llm-pi-ai";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, join as join$1, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

//#region src/pi-ai.ts
const PI_AI_NS = "llm-pi-ai";
const ROUTE_PREFIX = "sub2api-";
/** pi-ai thinking levels a profile may declare (catalog `THINKING_LEVELS`). */
const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**

* Request modalities a catalog model declares to the harness. An explicit

* `input` wins; absent/empty falls back to a family guess — frontier

* multimodal families accept images, everything else stays text-only (the

* official harness posture: a hand-entered model is text-only until it says

* otherwise).

*/
function catalogInputModalities(model) {
	if (model.input !== undefined && model.input.length > 0) return [...model.input];
	return /^(gpt|o[1-9]|claude|gemini|grok|glm|qwen|kimi|moonshot|minimax|mistral|llama|phi|command|jamba|codex|sora|veo|imagen|dall-e)/i.test(model.id) ? ["text", "image"] : ["text"];
}
/**

* Map this plugin's reasoning-effort ids (OpenAI vocabulary — `none`,

* `xhigh`, `max`, …) onto pi-ai's level keys. `none` is not a pi-ai level; it

* becomes `off` with wire spelling `none`, which pi-ai dispatches as

* `reasoning_effort: "none"` (chat/completions) or `reasoning:{effort:"none"}`

* (responses) — exactly what this plugin used to send. An empty list declares

* a non-reasoning model; unmappable ids are dropped.

*/
function translateReasoningEfforts(model) {
	const ids = model.reasoningEfforts;
	if (ids === undefined) {
		if (/image/i.test(model.id)) return false;
		return {
			low: "low",
			medium: "medium",
			high: "high"
		};
	}
	if (ids.length === 0) return false;
	const efforts = {};
	for (const id of ids) if (id === "none") efforts.off = "none";
else if (THINKING_LEVELS.includes(id)) efforts[id] = id;
	return Object.keys(efforts).length > 0 ? efforts : undefined;
}
/** One configured catalog model, translated onto pi-ai's per-model fields. */
function translateModel(model) {
	const reasoningEfforts = translateReasoningEfforts(model);
	return {
		id: model.id,
		...model.name !== undefined && model.name.length > 0 ? { name: model.name } : {},
		...model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {},
		...model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {},
		input: catalogInputModalities(model),
		...reasoningEfforts !== undefined ? { reasoningEfforts } : {}
	};
}
/**

* Translate one sub2api group into a hand-declared llm-pi-ai provider profile.

* `apiKeyEnv` passes through verbatim (the harness resolves it per request

* through `ctx.credentials`); routes without a key are skipped by the caller.

*

* The settings store the bare gateway host; the protocols join it differently.

* OpenAI-compatible SDKs append their endpoint to the `/v1` API root, while

* `@anthropic-ai/sdk` treats the given URL as the bare host and appends

* `/v1/messages` itself — so OpenAI-style routes get the `/v1`-rooted URL and

* the anthropic route gets the bare host.

*/
function translateProfile(key, profile, baseURL, label) {
	const api = apiProtocolForKey(key, profile);
	return {
		...profile.apiKeyEnv !== undefined ? { apiKeyEnv: profile.apiKeyEnv } : {},
		displayName: `Sub2API ${label}`,
		api,
		baseURL: api === "anthropic-messages" ? gatewayAnthropicRoot(baseURL) : gatewayApiRoot(baseURL),
		models: (profile.models ?? []).map(translateModel),
		defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
		defaultMaxTokens: DEFAULT_MAX_TOKENS,
		defaultInput: ["text"],
		retryPolicy: {
			mode: "normal",
			maxRetries: 5,
			retryableCodes: [
				"RATE_LIMIT",
				"SERVER",
				"TIMEOUT",
				"TRANSPORT",
				"EMPTY_RESPONSE"
			],
			backoff: {
				initialDelayMs: 1e3,
				maxDelayMs: 12e4,
				jitterRatio: .2
			}
		}
	};
}
function platformLabel(platform) {
	return PROVIDERS.find((def) => def.key === platform)?.label ?? platform;
}
function endpointRoute(endpoint, all) {
	const siblings = all.filter((entry) => entry.platform === endpoint.platform);
	const slug = routeSlug(endpoint.name ?? "");
	if (slug.length > 0) return `${ROUTE_PREFIX}${endpoint.platform}-${slug}`;
	if (siblings.length <= 1) return `${ROUTE_PREFIX}${endpoint.platform}`;
	return `${ROUTE_PREFIX}${endpoint.platform}-${siblings.indexOf(endpoint) + 1}`;
}
/**

* Normalize a user-supplied endpoint name into a route id fragment. Route ids

* travel through profile dict keys and through model ids (`<route>/<model>`),

* so only letters (any script), digits and single dashes survive.

*/
function routeSlug(value) {
	return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
function translateToPiAi(config) {
	const fallback = (config.baseURL ?? "").trim().replace(/\/+$/, "");
	const endpoints = config.endpoints ?? [];
	if (endpoints.length > 0) return translateEndpoints(endpoints, fallback);
	if (fallback.length === 0) return {};
	const profiles = {};
	for (const def of PROVIDERS) {
		const profile = config.providers[def.key];
		if (profile.apiKeyEnv === undefined) continue;
		const models = (profile.models ?? []).filter((model) => model.id.length > 0);
		if (models.length === 0) continue;
		profiles[def.route] = translateProfile(def.key, {
			...profile,
			models
		}, fallback, def.label);
	}
	return profiles;
}
function translateEndpoints(endpoints, fallback) {
	const profiles = {};
	for (const endpoint of endpoints) {
		if (endpoint.apiKeyEnv === undefined) continue;
		const host = (endpoint.baseURL ?? "").trim().replace(/\/+$/, "") || fallback;
		if (host.length === 0) continue;
		const models = (endpoint.models ?? []).filter((model) => model.id.length > 0);
		if (models.length === 0) continue;
		const label = (endpoint.name ?? "").trim() || platformLabel(endpoint.platform);
		profiles[endpointRoute(endpoint, endpoints)] = translateProfile(endpoint.platform, endpoint, host, label);
	}
	return profiles;
}
/**

* Read the stored `llm-pi-ai` section.

*

* DSH 0.2 removed `Settings.get()`. The only public read path left is

* `describe()`, which reports each loader entry's resolved config projected

* through that entry's own schema. The projection is faithful for this section:

* pi-ai declares `providers` as a `z.dict(...)`, which serializes as a `dict`

* node rather than an `object`, and `projectForm` passes every non-object node

* through untouched — so the dynamic provider keys (including routes the user

* declared by hand on the Models page) survive the round trip. Values come back

* with schema defaults filled in, which is what a later read sees as well, so

* the idempotence check in the caller still matches.

*

* `describe()` re-stamps the entry revision and emits

* `settings/document-updated` as a side effect; that is unavoidable on the only

* read path, and this bridge only reads when it is about to write anyway.

*/
function readPiAiSection(settings) {
	const described = settings.describe().find((entry) => entry.ns === PI_AI_NS);
	const value = described?.value;
	if (value === undefined || value === null || typeof value !== "object") return undefined;
	return value;
}
/**

* Put a provider map through pi-ai's own schema, so that comparing it against a

* read-back compares like with like.

*

* Storing a section runs it through that schema, which fills every defaulted

* field — `defaultContextWindow`, `defaultInput`, `streamIdleTimeoutMs`, the

* request-image budgets, and so on. A value read back therefore never equals the

* bare literal this module builds, and comparing the two raw makes every boot

* look like a change. Every boot would then write, and a write is a loader-level

* edit that re-registers pi-ai's providers: the plugin and the loader would keep

* handing the work back to each other instead of finishing startup.

*/
function normalizeProviders(providers) {
	const resolved = PiAiSectionSchema({ providers }).providers;
	if (resolved !== null && typeof resolved === "object" && typeof resolved.get === "function") return resolved.get();
	return resolved;
}
async function syncPiAiProfiles(ctx, config) {
	const settings = ctx.get("settings");
	if (settings === undefined) return;
	const current = readPiAiSection(settings);
	const providers = { ...current?.providers ?? {} };
	for (const route of Object.keys(providers)) if (route.startsWith(ROUTE_PREFIX)) delete providers[route];
	Object.assign(providers, translateToPiAi(config));
	const normalized = normalizeProviders(providers);
	const before = JSON.stringify(current?.providers ?? {});
	if (JSON.stringify(normalized) === before) return;
	const next = { providers: normalized };
	await settings.replace(PI_AI_NS, next);
}

//#endregion
//#region src/reasoning-probe.ts
const PROBE_GAP_MS = 5e3;
const PROBE_LEVELS = [
	"off",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function object(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function parseProbeDraft(value) {
	const root = object(value), endpoint = object(root?.endpoint), model = object(root?.model);
	if (!endpoint || !model || !Array.isArray(root?.candidates)) return undefined;
	const { baseURL, platform, api, apiKey = "", apiKeyEnv = "" } = endpoint;
	if (typeof baseURL !== "string" || baseURL.length > 2048 || !baseURL.trim()) return undefined;
	try {
		const url = new URL(baseURL);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
	} catch {
		return undefined;
	}
	if (![
		"openai",
		"claude",
		"grok"
	].includes(String(platform)) || !API_PROTOCOLS.includes(api)) return undefined;
	if (typeof apiKey !== "string" || typeof apiKeyEnv !== "string" || apiKey.length > 8192 || apiKeyEnv.length > 256 || !apiKey.trim() && !apiKeyEnv.trim()) return undefined;
	if (typeof model.id !== "string" || !model.id.trim() || model.id.length > 256) return undefined;
	for (const field of ["contextWindow", "maxTokens"]) if (model[field] !== undefined && (!Number.isSafeInteger(model[field]) || Number(model[field]) <= 0 || Number(model[field]) > 2e6)) return undefined;
	const candidates = root.candidates;
	if (!candidates.length || candidates.length > PROBE_LEVELS.length || candidates.some((level) => !PROBE_LEVELS.includes(level)) || new Set(candidates).size !== candidates.length) return undefined;
	return {
		endpoint: {
			baseURL: baseURL.trim(),
			platform,
			api,
			apiKey: apiKey.trim(),
			apiKeyEnv: apiKeyEnv.trim()
		},
		model: {
			id: model.id.trim(),
			...model.contextWindow === undefined ? {} : { contextWindow: Number(model.contextWindow) },
			...model.maxTokens === undefined ? {} : { maxTokens: Number(model.maxTokens) }
		},
		candidates: [...candidates]
	};
}
function retryAfterMs(value, now) {
	if (value === null) return 6e4;
	if (/^\d+(\.\d+)?$/.test(value.trim())) {
		const delay = Number(value) * 1e3;
		return Number.isFinite(delay) && delay <= Number.MAX_SAFE_INTEGER ? Math.max(0, delay) : 6e4;
	}
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.max(0, date - now) : 6e4;
}
async function sleep(ms, signal) {
	const until = Date.now() + ms;
	while (Date.now() < until) await sleepChunk(Math.min(2147483647, until - Date.now()), signal);
}
function sleepChunk(ms, signal) {
	return new Promise((resolveSleep, reject) => {
		if (signal.aborted) return reject(new Error("cancelled"));
		const cancel = () => {
			clearTimeout(timer);
			reject(new Error("cancelled"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", cancel);
			resolveSleep();
		}, ms);
		timer.unref();
		signal.addEventListener("abort", cancel, { once: true });
	});
}
var ProbeScheduler = class {
	tail = Promise.resolve();
	nextAt = 0;
	pausedUntil = 0;
	pending = 0;
	now;
	wait;
	constructor(now = Date.now, wait = sleep) {
		this.now = now;
		this.wait = wait;
	}
	estimate() {
		return Math.max(0, this.nextAt - this.now(), this.pausedUntil - this.now()) + this.pending * PROBE_GAP_MS;
	}
	pauseUntil(until) {
		this.pausedUntil = Math.max(this.pausedUntil, until);
	}
	run(signal, action) {
		this.pending++;
		const result = this.tail.catch(() => {}).then(async () => {
			this.pending--;
			if (signal.aborted) throw new Error("cancelled");
			let delay = Math.max(this.nextAt, this.pausedUntil) - this.now();
			while (delay > 0) {
				await this.wait(delay, signal);
				delay = Math.max(this.nextAt, this.pausedUntil) - this.now();
			}
			if (signal.aborted) throw new Error("cancelled");
			try {
				const outcome = await action();
				if (outcome.retryAfterUntil !== undefined) this.pauseUntil(outcome.retryAfterUntil);
else if (outcome.retryAfterMs !== undefined) this.pauseUntil(this.now() + outcome.retryAfterMs);
				return outcome;
			} finally {
				this.nextAt = this.now() + PROBE_GAP_MS;
			}
		});
		this.tail = result;
		return result;
	}
};
const sharedScheduler = new ProbeScheduler();
var ReasoningProbeService = class {
	tasks = new Map();
	disposed = false;
	transport;
	scheduler;
	now;
	constructor(transport = createSdkProbeTransport(), scheduler = sharedScheduler, now = Date.now) {
		this.transport = transport;
		this.scheduler = scheduler;
		this.now = now;
	}
	start(draft, key) {
		this.sweep();
		if (this.disposed || !key || [...this.tasks.values()].filter((task$1) => ["queued", "running"].includes(task$1.view.phase)).length >= 8 || this.tasks.size >= 64) return undefined;
		const id = randomUUID(), controller = new AbortController();
		const view = {
			id,
			phase: "queued",
			requests: 0,
			maxRequests: 1 + 3 * draft.candidates.length,
			minGapMs: PROBE_GAP_MS,
			estimateMs: this.scheduler.estimate() + (1 + 3 * draft.candidates.length) * PROBE_GAP_MS,
			levels: draft.candidates.map((level) => ({
				level,
				state: "unknown",
				reason: "queued"
			})),
			suggestion: [...draft.candidates]
		};
		const timer = setTimeout(() => this.stop(id, "expired"), 6e5);
		timer.unref();
		const task = {
			view,
			draft: structuredClone(draft),
			key,
			controller,
			timer,
			touched: this.now()
		};
		this.tasks.set(id, task);
		void this.execute(task);
		return this.copy(task);
	}
	status(id) {
		this.sweep();
		const task = this.tasks.get(id);
		return task ? this.copy(task) : undefined;
	}
	cancel(id) {
		this.stop(id, "cancelled");
		return this.status(id);
	}
	dispose() {
		this.disposed = true;
		for (const id of this.tasks.keys()) this.stop(id, "cancelled");
	}
	copy(task) {
		const view = structuredClone(task.view);
		if (["queued", "running"].includes(view.phase)) view.estimateMs = this.scheduler.estimate() + Math.max(0, view.maxRequests - view.requests) * PROBE_GAP_MS;
		return view;
	}
	sweep() {
		for (const [id, task] of this.tasks) if (!["queued", "running"].includes(task.view.phase) && this.now() - task.touched > 9e5) this.tasks.delete(id);
	}
	stop(id, phase) {
		const task = this.tasks.get(id);
		if (!task || !["queued", "running"].includes(task.view.phase)) return;
		task.view.phase = phase;
		task.controller.abort();
		task.key = "";
		task.draft.endpoint.apiKey = "";
		for (const level of task.view.levels) if (level.state === "unknown") level.reason = phase === "expired" ? "timeout" : "cancelled";
		clearTimeout(task.timer);
		task.touched = this.now();
	}
	async attempt(task, level) {
		return this.scheduler.run(task.controller.signal, async () => {
			task.view.phase = "running";
			const timeout = new AbortController();
			const timer = setTimeout(() => timeout.abort(), 3e4);
			timer.unref();
			try {
				const outcome = await this.transport({
					draft: task.draft,
					key: task.key,
					level,
					signal: AbortSignal.any([task.controller.signal, timeout.signal]),
					now: this.now,
					pauseUntil: (until) => this.scheduler.pauseUntil(until),
					sent: () => {
						if (!task.controller.signal.aborted) task.view.requests++;
					}
				});
				return timeout.signal.aborted ? {
					...outcome,
					kind: "unknown",
					reason: "timeout"
				} : outcome;
			} catch {
				return {
					kind: "unknown",
					reason: timeout.signal.aborted ? "timeout" : task.controller.signal.aborted ? "cancelled" : "upstream-error",
					transmitted: false
				};
			} finally {
				clearTimeout(timer);
			}
		});
	}
	async execute(task) {
		try {
			const initialControl = await this.attempt(task);
			if (task.controller.signal.aborted) return;
			if ([
				"auth-or-quota",
				"sdk-unavailable",
				"rate-limited"
			].includes(initialControl.reason)) {
				for (const result of task.view.levels) result.reason = initialControl.reason;
				return;
			}
			for (const result of task.view.levels) {
				if (task.controller.signal.aborted) return;
				const first = await this.attempt(task, result.level);
				if (task.controller.signal.aborted) return;
				if (first.kind === "accepted" && first.transmitted) {
					result.state = "accepted";
					result.reason = "accepted-parameter";
					continue;
				}
				result.reason = first.reason;
				if (first.kind !== "rejected" || !first.transmitted) continue;
				const rejectedAt = this.now();
				const control = await this.attempt(task);
				if (task.controller.signal.aborted) return;
				if (control.kind !== "accepted" || !control.transmitted) {
					result.reason = "no-control";
					continue;
				}
				const repeated = await this.attempt(task, result.level);
				if (task.controller.signal.aborted) return;
				if (repeated.kind === "rejected" && repeated.transmitted && this.now() - rejectedAt >= PROBE_GAP_MS) {
					result.state = "unsupported";
					result.reason = "confirmed-rejection";
				} else if (repeated.kind === "accepted" && repeated.transmitted) {
					result.state = "accepted";
					result.reason = "accepted-parameter";
				} else result.reason = "unconfirmed-rejection";
			}
		} catch {
			if (!task.controller.signal.aborted) {
				for (const result of task.view.levels) if (result.reason === "queued") result.reason = "upstream-error";
			}
		} finally {
			if (!task.controller.signal.aborted) task.view.phase = "completed";
			task.view.suggestion = task.view.levels.filter((level) => level.state !== "unsupported").map((level) => level.level);
			task.view.estimateMs = 0;
			task.key = "";
			task.draft.endpoint.apiKey = "";
			clearTimeout(task.timer);
			task.touched = this.now();
		}
	}
};
async function loadPeerProbeSdk(api) {
	const peer = import.meta.resolve("@deepseek-ai/dsh-llm-pi-ai");
	const requirePeer = createRequire(peer);
	for (const directory of requirePeer.resolve.paths("@earendil-works/pi-ai") ?? []) {
		const root = join$1(directory, "@earendil-works/pi-ai");
		try {
			const manifest = JSON.parse(await readFile(join$1(root, "package.json"), "utf8"));
			if (manifest.name !== "@earendil-works/pi-ai") continue;
			const entry = manifest.exports?.["./api/*"]?.import;
			if (typeof entry !== "string") continue;
			const path = resolve(root, entry.replace("*", api));
			if (!path.startsWith(`${resolve(root)}/`) && !path.startsWith(`${resolve(root)}\\`)) continue;
			return await import(pathToFileURL(path).href);
		} catch {}
	}
	throw new Error("sdk-unavailable");
}
function probeWireModel(draft) {
	const profiles = translateToPiAi({
		baseURL: draft.endpoint.baseURL,
		providers: {
			openai: {},
			claude: {},
			grok: {}
		},
		endpoints: [{
			name: "reasoning-probe",
			platform: draft.endpoint.platform,
			baseURL: draft.endpoint.baseURL,
			apiKeyEnv: "PROBE_ONLY",
			api: draft.endpoint.api,
			models: [{
				...draft.model,
				reasoningEfforts: draft.candidates
			}]
		}]
	});
	const [route, profile] = Object.entries(profiles)[0];
	const model = profile.models[0];
	const efforts = model.reasoningEfforts;
	const map = {};
	for (const level of [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	]) {
		const value = efforts && typeof efforts === "object" ? efforts[level] : undefined;
		if (value !== null) map[level] = value ?? null;
	}
	return {
		id: model.id,
		name: model.name ?? model.id,
		api: profile.api,
		provider: route,
		baseUrl: profile.baseURL,
		input: model.input ?? ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		contextWindow: model.contextWindow ?? profile.defaultContextWindow,
		maxTokens: model.maxTokens ?? profile.defaultMaxTokens,
		reasoning: true,
		thinkingLevelMap: map
	};
}
function inspectProbeWire(api, level, payload, cap) {
	if (level === undefined) return {
		exact: true,
		reason: "accepted-parameter"
	};
	if (api === "openai-responses" || api === "openai-completions") {
		const parameter = api === "openai-responses" ? "reasoning.effort" : "reasoning_effort";
		const value = api === "openai-responses" ? object(payload.reasoning)?.effort : payload.reasoning_effort;
		if (value !== level || level === "off") return {
			exact: false,
			reason: "parameter-not-exact"
		};
		const tokens = api === "openai-responses" ? payload.max_output_tokens : payload.max_completion_tokens ?? payload.max_tokens;
		if (typeof tokens !== "number" || tokens < 1024 || tokens > cap) return {
			exact: false,
			reason: "budget-limited"
		};
		return {
			exact: true,
			reason: "accepted-parameter",
			parameter,
			value: level
		};
	}
	const thinking = object(payload.thinking);
	if (level === "off" || level === "none") return {
		exact: false,
		reason: "parameter-not-exact"
	};
	if (thinking?.type === "adaptive") {
		if (typeof payload.max_tokens !== "number" || payload.max_tokens < 1024 || payload.max_tokens > cap) return {
			exact: false,
			reason: "budget-limited"
		};
		if (Array.isArray(payload.messages) && payload.messages.some((message) => object(message)?.role === "system")) return {
			exact: false,
			reason: "parameter-not-exact"
		};
		const effort = object(payload.output_config)?.effort;
		if (effort !== level) return {
			exact: false,
			reason: "parameter-not-exact"
		};
		return {
			exact: true,
			reason: "accepted-parameter",
			parameter: "output_config.effort",
			value: level
		};
	}
	const budgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384
	};
	const budget = budgets[level];
	if (!budget || thinking?.type !== "enabled") return {
		exact: false,
		reason: "parameter-not-exact"
	};
	if (thinking.budget_tokens !== budget || typeof payload.max_tokens !== "number" || payload.max_tokens < budget + 1024 || payload.max_tokens > cap) return {
		exact: false,
		reason: "budget-limited"
	};
	return {
		exact: true,
		reason: "accepted-parameter"
	};
}
function classifyProbeError(status, value, exact) {
	if (status === 429) return {
		kind: "unknown",
		reason: "rate-limited",
		transmitted: true
	};
	if (status === 401 || status === 403) return {
		kind: "unknown",
		reason: "auth-or-quota",
		transmitted: true
	};
	if (status >= 500) return {
		kind: "unknown",
		reason: "upstream-error",
		transmitted: true
	};
	const error = object(object(value)?.error);
	if ((status === 400 || status === 422) && exact.exact && exact.parameter && exact.value && error?.param === exact.parameter && typeof error.message === "string") {
		const escaped = exact.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const quoted = `["'\x60]${escaped}["'\x60]`;
		const message = error.message.trim().replace(/\s+/g, " ");
		const rejection = new RegExp(`^(?:(?:unsupported|invalid)\\s+(?:(?:reasoning[ _-]?effort|effort|value|enum)(?:\\s+value)?)\\s*:?\\s*${quoted}|${quoted}\\s+(?:is\\s+)?(?:unsupported|not supported|invalid|not allowed))(?=$|[.;,:])`, "i").exec(message);
		const positiveClause = new RegExp(`${quoted}\\s+(?:is\\s+)?(?:supported|valid|allowed)`, "i").test(message);
		const allowedLists = message.match(/\b(?:supported|allowed|valid)\s+values?[^.;]*/gi) ?? [];
		const inAllowedList = allowedLists.some((list) => new RegExp(quoted, "i").test(list));
		const ambiguousAssertion = /\b(?:not|never|false|incorrect|example|quoted?|quotation)\b/i.test(message.slice(rejection?.[0].length ?? 0));
		const ambiguousBudget = /\b(?:tokens?|budget|context|quota|capacity|timeout|rate[ -]?limit)\b|insufficient|too (?:small|large)/i.test(error.message);
		const code = error.code;
		if (rejection && !positiveClause && !inAllowedList && !ambiguousAssertion && !ambiguousBudget && (code === undefined || [
			"unsupported_value",
			"invalid_value",
			"invalid_enum_value",
			"unsupported_parameter_value"
		].includes(String(code)))) return {
			kind: "rejected",
			reason: "unconfirmed-rejection",
			transmitted: true
		};
	}
	return {
		kind: "unknown",
		reason: "ambiguous-error",
		transmitted: true
	};
}
function observeSse(api, model, data, evidence, event) {
	if (/(?:^|\.)(?:error|failed|incomplete)$/.test(event)) evidence.error = true;
	if (data === "[DONE]") {
		if (api === "openai-completions") evidence.terminal = true;
		return;
	}
	let value;
	try {
		const parsed = object(JSON.parse(data));
		if (!parsed) {
			evidence.error = true;
			return;
		}
		value = parsed;
	} catch {
		evidence.error = true;
		return;
	}
	const response = object(value.response), message = object(value.message);
	const id = response?.model ?? message?.model ?? value.model;
	if (id !== undefined) if (id !== model) evidence.error = true;
else evidence.model = true;
	if (value.error || value.type === "error" || String(value.type).includes("failed") || String(value.type).includes("incomplete")) evidence.error = true;
	if (api === "openai-responses") {
		if (value.type === "response.output_text.delta" && typeof value.delta === "string" && value.delta.trim()) evidence.text = true;
		if (value.type === "response.completed") {
			evidence.terminal = true;
			evidence.stopped = response?.status === "completed";
		}
	} else if (api === "openai-completions") for (const choice of Array.isArray(value.choices) ? value.choices : []) {
		const item = object(choice), delta = object(item?.delta);
		if (typeof delta?.content === "string" && delta.content.trim()) evidence.text = true;
		if (item?.finish_reason === "stop") evidence.stopped = true;
else if (item?.finish_reason != null) evidence.error = true;
	}
else {
		if (value.type === "content_block_delta" && object(value.delta)?.type === "text_delta" && String(object(value.delta)?.text ?? "").trim()) evidence.text = true;
		if (value.type === "message_delta") evidence.stopped = object(value.delta)?.stop_reason === "end_turn";
		if (value.type === "message_stop") evidence.terminal = true;
	}
}
function observedBody(response, api, model, evidence) {
	if (!response.body) {
		evidence.error = true;
		return response;
	}
	const decoder = new TextDecoder(), encoder = new TextEncoder();
	let pending = "", bytes = 0;
	const read = (text) => {
		pending = (pending + text).replace(/\r\n/g, "\n");
		const blocks = [];
		let split;
		while ((split = pending.indexOf("\n\n")) >= 0) {
			const block = pending.slice(0, split);
			pending = pending.slice(split + 2);
			const lines = block.split("\n");
			const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
			const event = lines.filter((line) => line === "event" || line.startsWith("event:")).at(-1)?.slice(6).trimStart() ?? "";
			if (data || event) observeSse(api, model, data, evidence, event);
			blocks.push(`${block}\n\n`);
		}
		return blocks;
	};
	const body = response.body.pipeThrough(new TransformStream({
		transform(chunk, controller) {
			bytes += chunk.byteLength;
			if (bytes > 1048576) {
				evidence.error = true;
				throw new Error("invalid-stream");
			}
			const blocks = read(decoder.decode(chunk, { stream: true }));
			if (evidence.error) throw new Error("invalid-stream");
			for (const block of blocks) controller.enqueue(encoder.encode(block));
		},
		flush(controller) {
			const blocks = read(decoder.decode());
			if (pending.trim() || evidence.error) {
				evidence.error = true;
				throw new Error("invalid-stream");
			}
			for (const block of blocks) controller.enqueue(encoder.encode(block));
		}
	}));
	return new Response(body, {
		status: response.status,
		headers: response.headers
	});
}
async function boundedError(response, signal) {
	const reader = response.body?.getReader();
	if (!reader) return undefined;
	let size = 0, text = "";
	const decoder = new TextDecoder();
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		if (signal.aborted) return undefined;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 65536) return undefined;
			text += decoder.decode(value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} catch {
		return undefined;
	} finally {
		signal.removeEventListener("abort", abort);
		void reader.cancel().catch(() => {});
	}
}
function createSdkProbeTransport(options = {}) {
	return async ({ draft, key, level, signal, sent, now = options.now ?? Date.now, pauseUntil }) => {
		let sdk;
		try {
			sdk = await (options.loadSdk ?? loadPeerProbeSdk)(draft.endpoint.api);
		} catch {
			return {
				kind: "unknown",
				reason: "sdk-unavailable",
				transmitted: false
			};
		}
		const model = probeWireModel(draft), cap = Math.min(model.maxTokens, 32768);
		if (level !== undefined && model.maxTokens > cap) return {
			kind: "unknown",
			reason: "budget-limited",
			transmitted: false
		};
		let outcome, transmitted = false, calls = 0;
		let pause = {};
		const evidence = {
			terminal: false,
			stopped: false,
			model: false,
			error: false,
			text: false
		};
		const independentFetch = async (input, init) => {
			if (signal.aborted || calls++) throw new Error("cancelled");
			let payload;
			try {
				payload = object(JSON.parse(String(init?.body ?? "")));
			} catch {}
			const exact = payload ? inspectProbeWire(model.api, level, payload, cap) : {
				exact: false,
				reason: "parameter-not-exact"
			};
			if (!exact.exact || payload?.model !== model.id) {
				outcome = {
					kind: "unknown",
					reason: exact.reason,
					transmitted: false
				};
				throw new Error("parameter-not-exact");
			}
			transmitted = true;
			sent();
			const response = await (options.fetch ?? fetch)(input, {
				...init,
				signal: AbortSignal.any([signal, ...init?.signal ? [init.signal] : []])
			});
			if (!response.ok) {
				if (response.status === 429) {
					const receivedAt = now(), retry = retryAfterMs(response.headers.get("retry-after"), receivedAt);
					pause = {
						retryAfterMs: retry,
						retryAfterUntil: receivedAt + retry
					};
					pauseUntil?.(pause.retryAfterUntil);
				}
				outcome = {
					...classifyProbeError(response.status, undefined, exact),
					...pause
				};
				outcome = {
					...classifyProbeError(response.status, await boundedError(response.clone(), signal), exact),
					...pause
				};
				void response.body?.cancel().catch(() => {});
				return new Response(JSON.stringify({ error: {
					message: "probe-upstream-error",
					type: "invalid_request_error"
				} }), {
					status: response.status,
					headers: { "content-type": "application/json" }
				});
			}
			return observedBody(response, model.api, model.id, evidence);
		};
		try {
			const stream = sdk.streamSimple(model, { messages: [{
				role: "user",
				content: "Reply exactly OK.",
				timestamp: 0
			}] }, {
				apiKey: key,
				...draft.model.maxTokens === undefined ? {} : { maxTokens: cap },
				maxRetries: 0,
				signal,
				fetch: independentFetch,
				...level === undefined || level === "off" || level === "none" ? {} : { reasoning: level }
			});
			const result = await stream.result();
			if (signal.aborted) return {
				kind: "unknown",
				reason: "cancelled",
				transmitted,
				...pause
			};
			if (outcome) return outcome;
			if (transmitted && evidence.terminal && evidence.stopped && evidence.model && evidence.text && !evidence.error && result.stopReason === "stop" && result.content?.some((item) => item.type === "text" && item.text?.trim())) return {
				kind: "accepted",
				reason: "accepted-parameter",
				transmitted: true
			};
			return {
				kind: "unknown",
				reason: "invalid-stream",
				transmitted
			};
		} catch {
			return signal.aborted ? {
				kind: "unknown",
				reason: "cancelled",
				transmitted,
				...pause
			} : outcome ?? {
				kind: "unknown",
				reason: "upstream-error",
				transmitted,
				...pause
			};
		}
	};
}

//#endregion
//#region src/routes.ts
const ROUTES = {
	get: "/plugins/dsh-sub2api/config",
	set: "/plugins/dsh-sub2api/config",
	discover: "/plugins/dsh-sub2api/discover",
	usage: "/plugins/dsh-sub2api/usage",
	status: "/plugins/dsh-sub2api/status",
	attachment: "/plugins/dsh-sub2api/attachment",
	reasoningStart: "/plugins/dsh-sub2api/reasoning/start",
	reasoningStatus: "/plugins/dsh-sub2api/reasoning/status",
	reasoningCancel: "/plugins/dsh-sub2api/reasoning/cancel"
};
function trustedRequest(req) {
	const remote = req.socket.remoteAddress;
	if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const host = req.headers.host;
	if (host === undefined) return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === new URL(`http://${host}`).host;
	} catch {
		return false;
	}
}
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text.length === 0) return {};
	const value = JSON.parse(text);
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function json(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(value));
}
function safeMessage(error) {
	if (error instanceof Error) return error.message;
	try {
		const text = String(error);
		return text.length > 0 ? text : "unknown error";
	} catch {
		return "unknown error";
	}
}
function readProviderConfig(config) {
	const providers = {};
	for (const def of PROVIDERS) {
		const profile = config.providers[def.key];
		providers[def.key] = {
			keyConfigured: profile.apiKeyEnv !== undefined,
			models: profile.models?.map((model) => ({ ...model })) ?? []
		};
	}
	const list = config.endpoints ?? [];
	const endpoints = list.map((endpoint) => ({
		name: endpoint.name ?? "",
		baseURL: endpoint.baseURL ?? "",
		platform: endpoint.platform,
		...endpoint.apiKeyEnv !== undefined ? { apiKeyEnv: endpoint.apiKeyEnv } : {},
		keyConfigured: endpoint.apiKeyEnv !== undefined,
		...endpoint.api !== undefined ? { api: endpoint.api } : {},
		models: endpoint.models?.map((model) => ({ ...model })) ?? [],
		route: endpointRoute(endpoint, list)
	}));
	return {
		baseURL: config.baseURL,
		catalogFormat: "structured-v1",
		providers,
		endpoints,
		tools: { ...config.tools?.generate !== undefined ? { generate: { ...config.tools.generate } } : {} }
	};
}
function legacyCatalogModel(value) {
	const [rawId = "", rawName = "", rawContextWindow = ""] = value.split("|");
	const id = rawId.trim();
	if (id.length === 0) return undefined;
	const name$1 = rawName.trim();
	const parsedContextWindow = Number(rawContextWindow.trim());
	const contextWindow = Number.isSafeInteger(parsedContextWindow) && parsedContextWindow > 0 ? parsedContextWindow : undefined;
	return {
		id,
		...name$1.length > 0 ? { name: name$1 } : {},
		...contextWindow !== undefined ? { contextWindow } : {}
	};
}
function structuredCatalogModel(value) {
	if (typeof value === "string") return legacyCatalogModel(value);
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const raw = value;
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (id.length === 0) return undefined;
	const name$1 = typeof raw.name === "string" ? raw.name.trim() : "";
	const contextWindow = typeof raw.contextWindow === "number" && Number.isSafeInteger(raw.contextWindow) && raw.contextWindow > 0 ? raw.contextWindow : undefined;
	const maxTokens = typeof raw.maxTokens === "number" && Number.isSafeInteger(raw.maxTokens) && raw.maxTokens > 0 ? raw.maxTokens : undefined;
	const reasoningEfforts = Array.isArray(raw.reasoningEfforts) ? raw.reasoningEfforts.filter((effort) => typeof effort === "string" && effort.length > 0) : undefined;
	const input = Array.isArray(raw.input) ? raw.input.filter((modality) => modality === "text" || modality === "image") : undefined;
	return {
		id,
		...name$1.length > 0 ? { name: name$1 } : {},
		...contextWindow !== undefined ? { contextWindow } : {},
		...maxTokens !== undefined ? { maxTokens } : {},
		...reasoningEfforts !== undefined ? { reasoningEfforts } : {},
		...input !== undefined && input.length > 0 ? { input } : {}
	};
}
function readCatalogModels(value, fallback) {
	if (Array.isArray(value)) return value.map(structuredCatalogModel).filter((model) => model !== undefined);
	if (typeof value === "string") return value.split(/[\n,]/).map(legacyCatalogModel).filter((model) => model !== undefined);
	return fallback;
}
function providerCredentialRef(platform) {
	return credentialRef$1(`SUB2API_${platform.toUpperCase()}_API_KEY`);
}
function endpointCredentialRef(platform, name$1, siblings) {
	const upper = platform.toUpperCase();
	const stub = `SUB2API_${upper}_API_KEY`;
	if (siblings.length === 0) return stub;
	const slug = name$1.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	const taken = new Set(siblings.map((entry) => entry.apiKeyEnv).filter((ref$1) => ref$1 !== undefined));
	const candidate = slug.length > 0 ? `SUB2API_${upper}_${slug}_API_KEY` : `${stub}_${siblings.length + 1}`;
	let ref = candidate;
	let suffix = siblings.length + 1;
	while (taken.has(ref)) ref = `${candidate}_${suffix++}`;
	return ref;
}
function isProviderKey$1(value) {
	return PROVIDERS.some((def) => def.key === value);
}
function readToolModelRef(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const raw = value;
	const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
	const model = typeof raw.model === "string" ? raw.model.trim() : "";
	if (!isProviderKey$1(provider) || model.length === 0) return undefined;
	return {
		provider,
		model
	};
}
function readImageTools(value, fallback) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
	const raw = value;
	const generate = readToolModelRef(raw.generate);
	if (generate === undefined) return undefined;
	return { ...generate !== undefined ? { generate } : {} };
}
var ConfigSaveError = class extends Error {
	outcome;
	constructor(outcome) {
		super("settings save failed");
		this.outcome = outcome;
	}
};
function validConfigRef(value) {
	return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
function validConfigURL(value) {
	try {
		const url = new URL(value);
		return /^https?:\/\//.test(value) && (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
	} catch {
		return false;
	}
}
function validSavedProfile(profile) {
	return (profile.apiKeyEnv === undefined || validConfigRef(profile.apiKeyEnv)) && (profile.api === undefined || API_PROTOCOLS.includes(profile.api));
}
/**

* One-shot probe key for discovery/usage: a freshly typed key wins (it is the

* one under test); otherwise fall back to the credential already stored for

* that provider, so the settings page does not force the user to re-type the

* key every time.

*/
async function resolveProbeKey(ctx, routes, provider, typedKey, storedRef) {
	if (typedKey.length > 0) return typedKey;
	if (typeof storedRef === "string" && storedRef.length > 0) try {
		return await routes.resolveApiKey(storedRef, { apiKeyEnv: storedRef });
	} catch (error) {
		throw new Error(`无法使用该端点已保存的 key（${storedRef}）：${safeMessage(error)}`);
	}
	if (!isProviderKey$1(provider)) throw new Error("provider 无效，应为 openai / claude / grok");
	const def = PROVIDERS.find((entry) => entry.key === provider);
	const profile = routes.config().providers[provider];
	if (profile?.apiKeyEnv === undefined) throw new Error(`${def?.label ?? provider} 未配置 API key：请先填写 key 并保存配置，再获取模型/查看用量`);
	try {
		return await routes.resolveApiKey(`sub2api-${provider}`, profile);
	} catch (error) {
		throw new Error(`无法使用已保存的 ${def?.label ?? provider} key：${safeMessage(error)}`);
	}
}
function registerRoutes(ctx, routes) {
	let configSaveTail = Promise.resolve();
	ctx.inject(["webServer"], (webCtx) => {
		const probes = new ReasoningProbeService();
		webCtx.effect(() => () => probes.dispose());
		const register = (path, handler) => {
			webCtx.webServer.register({
				kind: "exact",
				path,
				handler
			});
		};
		for (const [path, action] of [
			[ROUTES.reasoningStart, "start"],
			[ROUTES.reasoningStatus, "status"],
			[ROUTES.reasoningCancel, "cancel"]
		]) register(path, async (req, res) => {
			if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
			if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
			try {
				const chunks = [];
				let size = 0;
				for await (const chunk of req) {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					size += buffer.length;
					if (size > 32768) return json(res, 413, { error: "probe request too large" });
					chunks.push(buffer);
				}
				const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (action === "start") {
					const draft = parseProbeDraft(body);
					if (!draft) return json(res, 400, { error: "invalid probe draft" });
					const key = await resolveProbeKey(ctx, routes, draft.endpoint.platform, draft.endpoint.apiKey, draft.endpoint.apiKeyEnv);
					const task$1 = probes.start(draft, key);
					return task$1 ? json(res, 202, task$1) : json(res, 429, { error: "probe task limit" });
				}
				const id = body !== null && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id : "";
				const task = action === "cancel" ? probes.cancel(id) : probes.status(id);
				return task ? json(res, 200, task) : json(res, 404, { error: "probe task not found" });
			} catch {
				return json(res, 400, { error: "probe request unavailable" });
			}
		});
		register(ROUTES.get, async (req, res) => {
			if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method not allowed" });
			if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
			if (req.method === "GET") {
				json(res, 200, readProviderConfig(routes.config()));
				return;
			}
			try {
				const body = await readJson(req);
				const save = configSaveTail.then(async () => {
					const credentials = ctx.get("credentials");
					const snapshots = new Map();
					const attempted = [];
					let settingsOutcome = "not-committed";
					try {
						const baseURL = typeof body.baseURL === "string" ? body.baseURL.trim().replace(/\/+$/, "") : "";
						const rawEndpoints = Array.isArray(body.endpoints) ? body.endpoints : undefined;
						const hasEndpoints = rawEndpoints !== undefined && rawEndpoints.length > 0;
						if (!hasEndpoints && baseURL.length === 0) return json(res, 400, { error: "baseURL is required" });
						if (baseURL.length > 0 && !validConfigURL(baseURL)) return json(res, 400, { error: "invalid baseURL" });
						const current = routes.config();
						const next = {
							baseURL,
							providers: {
								openai: { ...current.providers.openai },
								claude: { ...current.providers.claude },
								grok: { ...current.providers.grok }
							},
							...current.endpoints !== undefined ? { endpoints: current.endpoints } : {},
							...current.tools !== undefined ? { tools: { ...current.tools } } : {}
						};
						const rawProviders = typeof body.providers === "object" && body.providers !== null ? body.providers : {};
						const writes = new Map();
						const addKey = (ref, apiKey) => {
							if (!validConfigRef(ref)) return false;
							let value;
							try {
								value = assertUsableApiKey$1(apiKey, "llm-sub2api", ref);
							} catch {
								return false;
							}
							if (writes.has(ref) && writes.get(ref) !== value) return false;
							writes.set(ref, value);
							return true;
						};
						for (const def of PROVIDERS) {
							const raw = rawProviders[def.key];
							const profile = next.providers[def.key];
							const apiKey = typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "";
							if (apiKey.length > 0) {
								const ref = profile.apiKeyEnv ?? providerCredentialRef(def.key);
								if (!addKey(ref, apiKey)) return json(res, 400, { error: "invalid Key or conflicting credential reference" });
								profile.apiKeyEnv = ref;
							}
							const api = typeof raw?.api === "string" ? raw.api.trim() : undefined;
							if (api !== undefined) if (api.length === 0) delete profile.api;
else if (API_PROTOCOLS.includes(api)) profile.api = api;
else return json(res, 400, { error: "invalid provider protocol" });
							profile.models = readCatalogModels(raw?.models, profile.models ?? []);
						}
						const reserved = [
							...current.endpoints ?? [],
							...PROVIDERS.flatMap((def) => {
								const ref = next.providers[def.key].apiKeyEnv;
								return ref === undefined ? [] : [{
									platform: def.key,
									apiKeyEnv: ref
								}];
							}),
							...(rawEndpoints ?? []).flatMap((entry) => {
								if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
								const ref = entry.apiKeyEnv;
								return typeof ref === "string" && ref.trim().length > 0 ? [{
									platform: "openai",
									apiKeyEnv: ref.trim()
								}] : [];
							})
						];
						if (rawEndpoints !== undefined) {
							const parsed = [];
							for (const entry of rawEndpoints) {
								if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return json(res, 400, { error: "invalid endpoint" });
								const raw = entry;
								const platform = typeof raw.platform === "string" && isProviderKey$1(raw.platform) ? raw.platform : undefined;
								const name$1 = typeof raw.name === "string" ? raw.name.trim() : "";
								if (platform === undefined) return json(res, 400, { error: "invalid endpoint platform" });
								const host = typeof raw.baseURL === "string" ? raw.baseURL.trim().replace(/\/+$/, "") : "";
								if (!validConfigURL(host || baseURL)) return json(res, 400, { error: "invalid endpoint URL" });
								let api;
								const rawApi = typeof raw.api === "string" ? raw.api.trim() : undefined;
								if (rawApi !== undefined) {
									if (API_PROTOCOLS.includes(rawApi)) api = rawApi;
else if (rawApi.length > 0) return json(res, 400, { error: "invalid endpoint protocol" });
								}
								const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
								let apiKeyEnv = typeof raw.apiKeyEnv === "string" ? raw.apiKeyEnv.trim() : "";
								if (apiKey.length > 0) {
									if (apiKeyEnv.length === 0) apiKeyEnv = endpointCredentialRef(platform, name$1, [...reserved, ...parsed]);
									if (!addKey(apiKeyEnv, apiKey)) return json(res, 400, { error: "invalid Key or conflicting credential reference" });
								}
								const previous = current.endpoints?.[parsed.length];
								parsed.push({
									...name$1.length > 0 ? { name: name$1 } : {},
									...host.length > 0 ? { baseURL: host } : {},
									platform,
									...apiKeyEnv.length > 0 ? { apiKeyEnv } : {},
									...api !== undefined ? { api } : {},
									models: readCatalogModels(raw.models, previous?.models ?? [])
								});
							}
							next.endpoints = parsed;
						}
						const tools = readImageTools(body.tools, current.tools);
						if (tools !== undefined) next.tools = tools;
else delete next.tools;
						if (!PROVIDERS.every((def) => validSavedProfile(next.providers[def.key]))) return json(res, 400, { error: "invalid retained provider configuration" });
						for (const entry of next.endpoints ?? []) if (!isProviderKey$1(entry.platform) || !validSavedProfile(entry) || !validConfigURL(entry.baseURL || baseURL)) return json(res, 400, { error: "invalid retained endpoint configuration" });
						const commit = routes.prepareConfig === undefined ? () => routes.setConfig(next) : await routes.prepareConfig(next);
						if (writes.size > 0) {
							if (credentials === undefined || [
								"describe",
								"resolve",
								"set",
								"unset"
							].some((method) => typeof Reflect.get(credentials, method) !== "function")) return json(res, 503, { error: "credential save service unavailable" });
							for (const ref of writes.keys()) {
								const state = await credentials.describe(ref);
								const hit = await credentials.resolve(ref);
								if (state.writable !== true || state.source === "env" || hit?.source === "env") return json(res, 400, { error: "credential reference is not writable" });
								if (typeof state.configured !== "boolean" || state.configured !== (hit !== undefined) || state.source !== hit?.source || hit !== undefined && (typeof hit.value !== "string" || hit.value.length === 0)) throw new ConfigSaveError("not-committed");
								snapshots.set(ref, hit?.source === "file" ? hit.value : undefined);
							}
							for (const [ref, value] of writes) {
								attempted.push(ref);
								await credentials.set(ref, value);
							}
						}
						settingsOutcome = "unknown";
						await commit();
						settingsOutcome = "committed";
						json(res, 200, {
							ok: true,
							...readProviderConfig(next),
							routes: routes.listRegisteredRoutes()
						});
					} catch (error) {
						if (settingsOutcome !== "committed" && error instanceof ConfigSaveError) settingsOutcome = error.outcome;
						let credentialOutcome = attempted.length === 0 ? "unchanged" : "preserved";
						if (settingsOutcome === "not-committed" && attempted.length > 0) {
							credentialOutcome = "restored";
							for (const ref of attempted.reverse()) try {
								const value = snapshots.get(ref);
								if (value === undefined) await credentials.unset(ref);
else await credentials.set(ref, value);
							} catch {
								credentialOutcome = "restore-incomplete";
							}
						}
						const message = settingsOutcome === "unknown" ? "保存结果无法确认，Key 可能已写入且未回滚；请重新加载配置后再重试。" : settingsOutcome === "committed" ? "配置已提交，但保存结果未能完整返回；Key 已保留，请重新加载确认。" : credentialOutcome === "restore-incomplete" ? "配置未提交，但部分 Key 未能恢复；请重新加载并检查后再重试。" : "配置未提交，Key 已恢复或未写入；请检查配置后再重试。";
						json(res, 500, {
							error: message,
							settingsOutcome,
							credentialOutcome
						});
					}
				});
				configSaveTail = save.then(() => undefined, () => undefined);
				await save;
			} catch {
				json(res, 500, { error: "configuration save unavailable" });
			}
		});
		register(ROUTES.discover, async (req, res) => {
			if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
			if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
			try {
				const body = await readJson(req);
				const baseURL = typeof body.baseURL === "string" ? body.baseURL.trim().replace(/\/+$/, "") : "";
				const provider = typeof body.provider === "string" ? body.provider.trim() : "";
				if (baseURL.length === 0) return json(res, 400, { error: "baseURL is required" });
				let apiKey;
				try {
					apiKey = await resolveProbeKey(ctx, routes, provider, typeof body.apiKey === "string" ? body.apiKey.trim() : "", typeof body.apiKeyEnv === "string" ? body.apiKeyEnv.trim() : undefined);
				} catch (error) {
					return json(res, 400, { error: safeMessage(error) });
				}
				const response = await fetch(`${gatewayApiRoot(baseURL)}/models`, {
					method: "GET",
					headers: { authorization: `Bearer ${apiKey}` },
					signal: AbortSignal.timeout(3e4)
				});
				if (!response.ok) {
					const text = await response.text().catch(() => "");
					return json(res, response.status, { error: `HTTP ${response.status}: ${text.slice(0, 300)}` });
				}
				const payload = await response.json();
				const models = Array.isArray(payload.data) ? payload.data.map((m) => ({
					id: typeof m.id === "string" ? m.id : "",
					name: typeof m.display_name === "string" ? m.display_name : typeof m.name === "string" ? m.name : undefined
				})).filter((m) => m.id.length > 0) : [];
				json(res, 200, {
					ok: true,
					models
				});
			} catch (error) {
				json(res, 500, { error: safeMessage(error) });
			}
		});
		register(ROUTES.usage, async (req, res) => {
			if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
			if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
			try {
				const body = await readJson(req);
				const baseURL = typeof body.baseURL === "string" ? body.baseURL.trim().replace(/\/+$/, "") : "";
				const provider = typeof body.provider === "string" ? body.provider.trim() : "";
				if (baseURL.length === 0) return json(res, 400, { error: "baseURL is required" });
				let apiKey;
				try {
					apiKey = await resolveProbeKey(ctx, routes, provider, typeof body.apiKey === "string" ? body.apiKey.trim() : "", typeof body.apiKeyEnv === "string" ? body.apiKeyEnv.trim() : undefined);
				} catch (error) {
					return json(res, 400, { error: safeMessage(error) });
				}
				const response = await fetch(`${gatewayApiRoot(baseURL)}/usage`, {
					method: "GET",
					headers: { authorization: `Bearer ${apiKey}` },
					signal: AbortSignal.timeout(3e4)
				});
				if (!response.ok) {
					const text = await response.text().catch(() => "");
					return json(res, response.status, { error: `HTTP ${response.status}: ${text.slice(0, 300)}` });
				}
				const payload = await response.json();
				const parts = [];
				const quota = payload.quota;
				if (quota !== undefined && typeof quota.limit === "number") parts.push(`配额 ${String(quota.used ?? 0)}/${quota.limit}${typeof quota.unit === "string" ? ` ${quota.unit}` : ""}（剩余 ${String(quota.remaining ?? 0)}）`);
else if (typeof payload.balance === "number") parts.push(`余额 $${payload.balance}`);
else if (typeof payload.remaining === "number") parts.push(`剩余 ${payload.remaining}${typeof payload.unit === "string" ? ` ${payload.unit}` : " USD"}`);
				if (typeof payload.planName === "string") parts.push(`分组: ${payload.planName}`);
				if (typeof payload.mode === "string") parts.push(`模式: ${payload.mode}`);
				if (typeof payload.status === "string") parts.push(`状态: ${payload.status}`);
				if (Array.isArray(payload.rate_limits)) parts.push(`限流: ${payload.rate_limits.map((r) => `${String(r.window ?? "")} ${String(r.used ?? 0)}/${String(r.limit ?? 0)}`).join(", ")}`);
				const sub = payload.subscription;
				if (sub !== undefined) parts.push(`订阅日/周/月: ${[
					sub.daily_usage_usd,
					sub.weekly_usage_usd,
					sub.monthly_usage_usd
				].map((v) => typeof v === "number" ? `$${v}` : "-").join(" / ")}`);
				json(res, 200, {
					ok: true,
					summary: parts.length > 0 ? parts.join("；") : "该 key 无配额/余额信息（unrestricted 模式）"
				});
			} catch (error) {
				json(res, 500, { error: safeMessage(error) });
			}
		});
		register(ROUTES.status, async (req, res) => {
			if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
			if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
			const config = routes.config();
			const models = {};
			const list = config.endpoints ?? [];
			if (list.length > 0) for (const endpoint of list) {
				if (endpoint.apiKeyEnv === undefined) continue;
				models[endpointRoute(endpoint, list)] = endpoint.models?.map((m) => m.id) ?? [];
			}
else for (const def of PROVIDERS) if (config.providers[def.key].apiKeyEnv !== undefined) models[def.route] = config.providers[def.key].models?.map((m) => m.id) ?? [];
			json(res, 200, {
				routes: routes.listRegisteredRoutes(),
				models
			});
		});
		webCtx.webServer.register({
			kind: "prefix",
			path: ROUTES.attachment,
			handler: async (req, res) => {
				if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
				if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
				let ref;
				try {
					const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
					const raw = url.searchParams.get("ref") ?? "";
					if (raw.length === 0) return json(res, 400, { error: "ref is required" });
					const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
					if (typeof parsed !== "object" || parsed === null) throw new Error("ref must be an object");
					const candidate = parsed;
					if (typeof candidate.attachmentId !== "string" || typeof candidate.mediaType !== "string") throw new Error("ref is incomplete");
					ref = candidate;
				} catch {
					return json(res, 400, { error: "invalid ref" });
				}
				const attachments = ctx.get("attachments");
				if (attachments === undefined) return json(res, 503, { error: "attachment service unavailable" });
				try {
					const stored = await attachments.readImage(ref);
					res.writeHead(200, {
						"content-type": stored.ref.mediaType,
						"cache-control": "private, max-age=86400",
						"x-content-type-options": "nosniff"
					});
					res.end(Buffer.from(stored.data));
				} catch {
					json(res, 404, { error: "attachment not found" });
				}
			}
		});
	});
}

//#endregion
//#region src/image-tools.ts
function getFs(ctx) {
	return ctx.get("fs");
}
const GENERATE_IMAGE_NAME = "generate_image";
const DEFAULT_IMAGE_TOOL_TIMEOUT_MS = 18e4;
const DEFAULT_MAX_IMAGE_BYTES = 20971520;
const GENERATE_SIZES = [
	"auto",
	"256x256",
	"512x512",
	"1024x1024",
	"1024x1536",
	"1536x1024",
	"1024x1792",
	"1792x1024"
];
const GENERATE_QUALITIES = [
	"auto",
	"low",
	"medium",
	"high",
	"standard",
	"hd"
];
const PROVIDER_LABELS = {
	openai: "OpenAI",
	claude: "Claude",
	grok: "Grok"
};
function isProviderKey(value) {
	return value === "openai" || value === "claude" || value === "grok";
}
function mediaTypeFromBytes(data) {
	if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) return "image/png";
	if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
	if (data.length >= 6 && data[0] === 71 && data[1] === 73 && data[2] === 70) return "image/gif";
	if (data.length >= 12 && data[0] === 82 && data[1] === 73 && data[2] === 70 && data[3] === 70 && data[8] === 87 && data[9] === 69 && data[10] === 66 && data[11] === 80) return "image/webp";
	return "image/png";
}
function extensionForMediaType(mediaType) {
	switch (mediaType) {
		case "image/jpeg": return ".jpg";
		case "image/webp": return ".webp";
		case "image/gif": return ".gif";
		default: return ".png";
	}
}
function decodeDataUrl(value) {
	const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
	if (match === null) return undefined;
	const declared = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
	const mediaType = declared;
	return {
		mediaType,
		data: Buffer.from(match[2], "base64")
	};
}
function sessionCwd(exec) {
	return exec.agent?.session.header.cwd;
}
function resolveToolModel(config, kind) {
	const ref = config.tools?.[kind];
	const label = "生图";
	const provider = typeof ref?.provider === "string" ? ref.provider.trim() : "";
	const model = typeof ref?.model === "string" ? ref.model.trim() : "";
	if (provider.length === 0 || model.length === 0) throw new Error(`sub2api: 未配置${label}模型。打开设置 → Sub2API 模型，为「全局图像工具」指定一个模型后再试`);
	const endpoints = config.endpoints ?? [];
	const endpoint = endpoints.find((entry) => endpointRoute(entry, endpoints) === provider);
	if (endpoint !== undefined) {
		const host = (endpoint.baseURL ?? "").trim().replace(/\/+$/, "") || config.baseURL.trim().replace(/\/+$/, "");
		if (host.length === 0) throw new Error("sub2api: baseURL is not configured");
		if (endpoint.apiKeyEnv === undefined) throw new Error(`sub2api: ${label}模型所在的端点未配置 API key，无法调用${label}模型`);
		const api$1 = endpoint.api ?? apiProtocolForKey(endpoint.platform, endpoint);
		const endpointRoot$1 = api$1 === "anthropic-messages" ? gatewayAnthropicRoot(host) : gatewayApiRoot(host);
		const endpointModel = endpoint.models?.find((entry) => entry.id === model);
		return {
			route: provider,
			label: endpoint.name?.trim() || PROVIDER_LABELS[endpoint.platform],
			profile: endpoint,
			model,
			baseURL: endpointRoot$1,
			api: api$1,
			maxTokens: endpointModel?.maxTokens ?? DEFAULT_MAX_TOKENS
		};
	}
	if (!isProviderKey(provider)) throw new Error(`sub2api: ${label}模型的平台 "${provider}" 无效，应为 openai / claude / grok`);
	const baseURL = config.baseURL.trim().replace(/\/+$/, "");
	if (baseURL.length === 0) throw new Error("sub2api: baseURL is not configured");
	const profile = config.providers[provider];
	if (profile.apiKeyEnv === undefined) throw new Error(`sub2api: ${PROVIDER_LABELS[provider]} 未配置 API key，无法调用${label}模型`);
	const catalogModel$1 = profile.models?.find((entry) => entry.id === model);
	const api = apiProtocolForKey(provider, profile);
	const endpointRoot = api === "anthropic-messages" ? gatewayAnthropicRoot(baseURL) : gatewayApiRoot(baseURL);
	return {
		route: `sub2api-${provider}`,
		label: PROVIDER_LABELS[provider],
		profile,
		model,
		baseURL: endpointRoot,
		api,
		maxTokens: catalogModel$1?.maxTokens ?? DEFAULT_MAX_TOKENS
	};
}
async function readErrorDetail(response) {
	try {
		const parsed = await response.json();
		const message = parsed.error?.message;
		if (typeof message === "string" && message.length > 0) return message;
	} catch {}
	return `HTTP ${response.status}`;
}
async function gatewayFetch(host, resolved, path, body, signal, accept) {
	const apiKey = await host.resolveApiKey(resolved.route, resolved.profile);
	let response;
	try {
		response = await fetch(`${resolved.baseURL}${path}`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
				accept,
				...attributionHeaders()
			},
			body: JSON.stringify(body),
			signal
		});
	} catch (error) {
		if (signal?.aborted) throw new LlmError$1("sub2api: request aborted", "ABORTED", { cause: error });
		throw new LlmError$1(`sub2api: API request to ${resolved.baseURL}${path} failed`, "TRANSPORT", { cause: error });
	}
	if (!response.ok) throw new Error(`sub2api ${path}: ${await readErrorDetail(response)}`);
	return response;
}
async function collectSseText(response) {
	if (response.body === null) throw new Error("sub2api: API returned no response body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			while (true) {
				const idx = buffer.indexOf("\n\n");
				if (idx === -1) break;
				const raw = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const dataLines = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
				if (dataLines.length === 0) continue;
				const joined = dataLines.join("\n");
				if (joined === "[DONE]") return text;
				for (const line of dataLines) {
					if (line === "[DONE]") return text;
					let chunk;
					try {
						chunk = JSON.parse(line);
					} catch {
						continue;
					}
					for (const choice of chunk.choices ?? []) {
						const delta = choice.delta?.content ?? choice.message?.content;
						if (typeof delta === "string") text += delta;
					}
				}
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {}
	}
	return text;
}
function flattenMessageContent(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (typeof part === "string") return part;
		if (typeof part !== "object" || part === null) return "";
		const record = part;
		if (typeof record.text === "string") return record.text;
		return "";
	}).join("");
}
async function collectChatText(response) {
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("text/event-stream")) {
		const text$1 = (await collectSseText(response)).trim();
		if (text$1.length === 0) throw new Error("sub2api: image model returned no text");
		return text$1;
	}
	const payload = await response.json();
	const text = flattenMessageContent(payload.choices?.[0]?.message?.content).trim();
	if (text.length === 0) throw new Error("sub2api: image model returned no text");
	return text;
}
async function loadRemoteImage(url, signal, maxBytes) {
	const encoded = decodeDataUrl(url);
	if (encoded !== undefined) return encoded;
	let response;
	try {
		response = await fetch(url, {
			method: "GET",
			signal,
			redirect: "follow"
		});
	} catch (error) {
		if (signal?.aborted) throw new LlmError$1("sub2api: request aborted", "ABORTED", { cause: error });
		throw new Error(`sub2api: failed to download image URL: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!response.ok) throw new Error(`sub2api: image URL returned HTTP ${response.status}`);
	const buffer = new Uint8Array(await response.arrayBuffer());
	if (buffer.byteLength > maxBytes) throw new Error(`sub2api: image URL exceeds ${maxBytes} bytes`);
	const headerType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
	const mediaType = headerType === "image/png" || headerType === "image/jpeg" || headerType === "image/webp" || headerType === "image/gif" ? headerType : mediaTypeFromBytes(buffer);
	return {
		mediaType,
		data: buffer
	};
}
function extractGeneratedImage(payload) {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload;
	const items = Array.isArray(record.data) ? record.data : [];
	for (const item of items) {
		if (typeof item !== "object" || item === null) continue;
		const row = item;
		const revised = typeof row.revised_prompt === "string" ? row.revised_prompt : undefined;
		if (typeof row.b64_json === "string" && row.b64_json.length > 0) {
			const data = Buffer.from(row.b64_json, "base64");
			return {
				data,
				mediaType: mediaTypeFromBytes(data),
				...revised !== undefined ? { revisedPrompt: revised } : {}
			};
		}
		if (typeof row.url === "string" && row.url.length > 0) {
			if (row.url.startsWith("data:")) {
				const decoded = decodeDataUrl(row.url);
				if (decoded !== undefined) return {
					...decoded,
					...revised !== undefined ? { revisedPrompt: revised } : {}
				};
			}
			return {
				url: row.url,
				...revised !== undefined ? { revisedPrompt: revised } : {}
			};
		}
	}
	return undefined;
}
function extractImageFromText(text) {
	const dataMatch = /data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+/i.exec(text);
	if (dataMatch !== null) {
		const decoded = decodeDataUrl(dataMatch[0]);
		if (decoded !== undefined) return {
			kind: "data",
			...decoded
		};
	}
	const urlMatch = /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/i.exec(text);
	if (urlMatch !== null) return {
		kind: "url",
		url: urlMatch[0].replace(/[),.;]+$/, "")
	};
	const markdown = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i.exec(text);
	if (markdown !== null) return {
		kind: "url",
		url: markdown[1]
	};
	return undefined;
}
function defaultOutputName(mediaType) {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
	return `generated-${stamp}${extensionForMediaType(mediaType)}`;
}
async function writeGeneratedFile(ctx, exec, requestedPath, data, mediaType) {
	const fs = getFs(ctx);
	if (fs === undefined) throw new Error("cannot write generated image: filesystem service is not mounted");
	const cwd = sessionCwd(exec);
	const rawPath = requestedPath !== undefined && requestedPath.trim().length > 0 ? requestedPath.trim() : defaultOutputName(mediaType);
	const withExt = extname(rawPath).length === 0 ? `${rawPath}${extensionForMediaType(mediaType)}` : rawPath;
	const target = await fs.resolve(withExt, {
		...cwd !== undefined ? { cwd } : {},
		signal: exec.signal
	});
	if (cwd !== undefined) {
		const root = await fs.resolve(".", {
			cwd,
			signal: exec.signal
		});
		if (!fs.contains(root, target)) throw new Error(`generate_image can only write inside the session workspace; refused "${target.displayPath}"`);
	}
	const abs = fs.processPath(target);
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, data);
	return target.displayPath;
}
async function generateViaImagesApi(host, resolved, args, signal, maxBytes) {
	const response = await gatewayFetch(host, resolved, "/images/generations", {
		model: resolved.model,
		prompt: args.prompt,
		n: 1,
		response_format: "b64_json",
		...args.size !== undefined && args.size !== "auto" ? { size: args.size } : {},
		...args.quality !== undefined && args.quality !== "auto" ? { quality: args.quality } : {}
	}, signal, "application/json");
	const payload = await response.json();
	const image = extractGeneratedImage(payload);
	if (image === undefined) throw new Error("sub2api: image API returned no image data");
	if (image.data !== undefined && image.mediaType !== undefined) return {
		data: image.data,
		mediaType: image.mediaType,
		...image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}
	};
	if (image.url !== undefined) {
		const downloaded = await loadRemoteImage(image.url, signal, maxBytes);
		return {
			...downloaded,
			...image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}
		};
	}
	throw new Error("sub2api: image API returned no image data");
}
async function generateViaChat(host, resolved, prompt, signal, maxBytes) {
	const response = await gatewayFetch(host, resolved, "/chat/completions", {
		model: resolved.model,
		messages: [{
			role: "user",
			content: `Generate an image for this prompt and return the image itself (as a data URL or a direct image URL), not a description:\n\n${prompt}`
		}],
		stream: true,
		stream_options: { include_usage: true }
	}, signal, "text/event-stream");
	const text = await collectChatText(response);
	const extracted = extractImageFromText(text);
	if (extracted === undefined) throw new Error(`sub2api: chat image model did not return image data. Response preview: ${text.slice(0, 240)}`);
	if (extracted.kind === "data") return {
		data: extracted.data,
		mediaType: extracted.mediaType
	};
	return await loadRemoteImage(extracted.url, signal, maxBytes);
}
function registerImageTools(ctx, host) {
	ctx.inject(["tools", "systemPrompt"], (toolCtx) => {
		toolCtx.systemPrompt.section({
			name: "tool:generate_image",
			order: 119,
			text: "Use the generate_image tool to create an image with the configured image model and write it to the workspace. Call it when the current chat model cannot generate images. The tool returns the saved file path, not the image bytes."
		});
		toolCtx.tools.register(defineTool({
			name: GENERATE_IMAGE_NAME,
			description: "Generate an image with the configured image model and write it to the workspace. Use this when the current chat model cannot generate images. Returns the saved file path.",
			parameters: {
				prompt: {
					type: "string",
					required: true,
					description: "Image generation prompt."
				},
				file_path: {
					type: "string",
					description: "Workspace path to write. Defaults to generated-<timestamp>.png in the session cwd."
				},
				size: {
					type: "string",
					enum: [...GENERATE_SIZES],
					description: "Requested size when the image API supports it."
				},
				quality: {
					type: "string",
					enum: [...GENERATE_QUALITIES],
					description: "Requested quality when the image API supports it."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						path: {
							type: "string",
							required: true
						},
						model: {
							type: "string",
							required: true
						},
						mediaType: {
							type: "string",
							required: true
						},
						bytes: {
							type: "integer",
							required: true
						},
						revisedPrompt: { type: "string" },
						attachment: {
							type: "object",
							additionalProperties: false,
							properties: {
								attachmentId: {
									type: "string",
									required: true
								},
								mediaType: {
									type: "string",
									required: true
								},
								bytes: {
									type: "integer",
									required: true
								},
								width: {
									type: "integer",
									required: true
								},
								height: {
									type: "integer",
									required: true
								},
								name: { type: "string" }
							}
						}
					}
				},
				render: (_args, value) => {
					const blocks = [];
					const attachment = value.attachment;
					if (attachment !== undefined && typeof attachment === "object" && attachment !== null) blocks.push({
						type: "image",
						attachment
					});
					blocks.push({
						type: "text",
						text: [
							`<path>${value.path}</path>`,
							"<type>image</type>",
							"<content>",
							`${value.mediaType}, ${value.bytes} bytes, model ${value.model}`,
							value.revisedPrompt !== undefined ? `revised prompt: ${value.revisedPrompt}` : "",
							"</content>"
						].filter((line) => line.length > 0).join("\n")
					});
					return blocks;
				}
			},
			timeoutMs: DEFAULT_IMAGE_TOOL_TIMEOUT_MS,
			async execute(args, exec) {
				const prompt = args.prompt.trim();
				if (prompt.length === 0) throw new Error("prompt must be a non-empty string");
				const resolved = resolveToolModel(host.config(), "generate");
				const maxBytes = ctx.get("attachments")?.imageLimits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
				let image;
				try {
					image = await generateViaImagesApi(host, resolved, {
						prompt,
						...args.size !== undefined ? { size: args.size } : {},
						...args.quality !== undefined ? { quality: args.quality } : {}
					}, exec.signal, maxBytes);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!/HTTP 404|HTTP 405|HTTP 501|not found|unknown endpoint|does not exist|not implemented/i.test(message)) throw error;
					image = await generateViaChat(host, resolved, prompt, exec.signal, maxBytes);
				}
				const path = await writeGeneratedFile(ctx, exec, args.file_path, image.data, image.mediaType);
				let attachment;
				const attachmentStore = ctx.get("attachments");
				if (attachmentStore !== undefined) try {
					attachment = await attachmentStore.saveImage({
						data: image.data,
						mediaType: image.mediaType,
						...path.length > 0 ? { name: basename(path) } : {}
					});
				} catch {
					attachment = undefined;
				}
				return {
					path,
					model: `${resolved.route}/${resolved.model}`,
					mediaType: image.mediaType,
					bytes: image.data.byteLength,
					...image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {},
					...attachment !== undefined ? { attachment } : {}
				};
			},
			presentCall(args) {
				return {
					card: "generic",
					title: `Generate image${args.file_path !== undefined ? ` ${args.file_path}` : ""}`,
					...args.file_path !== undefined ? { locations: [{ path: args.file_path }] } : {}
				};
			},
			presentResult(_args, result) {
				const imageBlock = result.content.find((b) => b.type === "image");
				if (imageBlock !== undefined) return {
					card: "generic",
					content: [imageBlock]
				};
				const textBlock = result.content.find((b) => b.type === "text");
				if (textBlock !== undefined && textBlock.type === "text") {
					const pathLine = textBlock.text.match(/<path>(.*?)<\/path>/)?.[1];
					if (pathLine !== undefined) return {
						card: "generic",
						content: [{
							type: "text",
							text: pathLine
						}]
					};
				}
				return undefined;
			}
		}));
	});
}

//#endregion
//#region src/pi-ai-patch.ts
/** Guard marker; its presence means the patch is already applied. */
const MARKER = "assistant.usage !== undefined";
/** The exact upstream expression this patch guards. */
const TARGET = "calculateContextTokens(assistant.usage) > 0";
/** Candidate locations of the pi-ai estimate module inside a dsh install. */
function candidateEstimatePaths() {
	const roots = new Set();
	const global = spawnSync("npm", ["root", "-g"], {
		encoding: "utf8",
		windowsHide: true
	});
	if (global.status === 0 && global.stdout.trim().length > 0) roots.add(global.stdout.trim());
	if (process.env.npm_config_prefix !== undefined) roots.add(join(process.env.npm_config_prefix, "lib", "node_modules"));
	roots.add(join(homedir(), ".npm-global", "lib", "node_modules"));
	const dshHome = process.env.DSH_HOME !== undefined ? process.env.DSH_HOME : join(homedir(), ".dsh");
	const paths = [];
	for (const root of roots) {
		paths.push(join(root, "@deepseek-ai", "dsh", "node_modules", "@earendil-works", "pi-ai", "dist", "utils", "estimate.js"));
		paths.push(join(root, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "node_modules", "@earendil-works", "pi-ai", "dist", "utils", "estimate.js"));
	}
	paths.push(join(dshHome, "profiles", "web", "node_modules", "@deepseek-ai", "dsh-llm-pi-ai", "node_modules", "@earendil-works", "pi-ai", "dist", "utils", "estimate.js"));
	return paths;
}
function applyPiAiMultiTurnPatch() {
	const file = candidateEstimatePaths().find((candidate) => existsSync(candidate));
	if (file === undefined) return {
		kind: "skipped",
		reason: "pi-ai estimate.js not found under the dsh install"
	};
	let source;
	try {
		source = readFileSync(file, "utf8");
	} catch (error) {
		return {
			kind: "skipped",
			reason: `cannot read ${file}: ${String(error)}`
		};
	}
	if (source.includes(MARKER)) return {
		kind: "already",
		file
	};
	const index = source.indexOf(TARGET);
	if (index === -1) return {
		kind: "skipped",
		reason: `target pattern not found in ${file} (pi-ai layout changed?)`
	};
	const lineStart = source.lastIndexOf("\n", index) + 1;
	const indent = source.slice(lineStart, index).match(/^[ \t]*/)?.[0] ?? "";
	const replacement = `${MARKER} &&\n${indent}${TARGET}`;
	const next = source.slice(0, index) + replacement + source.slice(index + TARGET.length);
	try {
		writeFileSync(file, next);
	} catch (error) {
		return {
			kind: "skipped",
			reason: `cannot write ${file}: ${String(error)}`
		};
	}
	return {
		kind: "patched",
		file
	};
}

//#endregion
//#region src/index.ts
const name = "llm-sub2api";
const inject = [
	"llm",
	"settings",
	"credentials"
];
const NS = "llm-sub2api";
const DEFAULT_CONTEXT_WINDOW = 128e3;
const DEFAULT_MAX_TOKENS = 8192;
const REASONING_EFFORTS = [
	{
		id: "low",
		name: "Low"
	},
	{
		id: "medium",
		name: "Medium"
	},
	{
		id: "high",
		name: "High"
	}
];
const PROVIDERS = [
	{
		key: "openai",
		route: "sub2api-openai",
		label: "OpenAI",
		icon: "openai"
	},
	{
		key: "claude",
		route: "sub2api-claude",
		label: "Claude",
		icon: "claude"
	},
	{
		key: "grok",
		route: "sub2api-grok",
		label: "Grok",
		icon: "grok"
	}
];
/** Runtime brand cosmokit's `createVolatile` stamps onto a live cell. */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
function readVolatile(value) {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "object" && VOLATILE_WRITE in value) return value.get();
	return value;
}
const catalogModel = z.object({
	id: z.string().required(),
	name: z.string(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1),
	input: z.array(z.union([z.const("text"), z.const("image")])).default([]),
	reasoningEfforts: z.array(z.string()).default(REASONING_EFFORTS.map((effort) => effort.id))
});
const apiProtocol = z.union([
	z.const("openai-completions"),
	z.const("openai-responses"),
	z.const("anthropic-messages")
]);
const providerProfile = z.object({
	apiKeyEnv: z.string().role("credential-ref"),
	api: apiProtocol,
	models: z.array(catalogModel)
});
/**

* One endpoint entry. `platform` is required: the wire protocol cannot be

* guessed from a host, and a wrong guess sends an Anthropic key to an OpenAI

* endpoint. `name` and `baseURL` stay optional so an unnamed entry on the

* section's default host still resolves to the legacy route id.

*/
const providerEndpoint = z.object({
	name: z.string(),
	baseURL: z.string(),
	platform: z.union([
		z.const("openai"),
		z.const("claude"),
		z.const("grok")
	]),
	apiKeyEnv: z.string().role("credential-ref"),
	api: apiProtocol,
	models: z.array(catalogModel)
});
const imageToolModelRef = z.object({
	provider: z.string(),
	model: z.string()
});
const Config = z.object({
	baseURL: z.string().volatile(),
	providers: z.object({
		openai: providerProfile,
		claude: providerProfile,
		grok: providerProfile
	}).volatile(),
	endpoints: z.array(providerEndpoint).volatile(),
	tools: z.object({ generate: imageToolModelRef }).volatile()
});
const API_PROTOCOLS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages"
];
/**

* The wire protocol each sub2api platform group speaks natively at the

* gateway. Openai groups are served upstream through the Responses API and

* Claude groups through the Messages API; grok groups are

* chat-completions. Speaking the native protocol avoids the gateway's

* chat/completions ↔ native conversion, which drops/misaligns tool-call

* names and ids for parallel calls. A provider profile may override.

*/
const DEFAULT_PROTOCOL = {
	openai: "openai-responses",
	claude: "anthropic-messages",
	grok: "openai-completions"
};
function apiProtocolForKey(key, profile) {
	return profile.api ?? DEFAULT_PROTOCOL[key];
}
function gatewayApiRoot(baseURL) {
	const cleaned = (baseURL ?? "").trim().replace(/\/+$/, "");
	if (cleaned.length === 0) return "";
	return /\/v1$/i.test(cleaned) ? cleaned : `${cleaned}/v1`;
}
function gatewayAnthropicRoot(baseURL) {
	return gatewayApiRoot(baseURL).replace(/\/v1$/i, "");
}
function resolveAdapterOptions(config) {
	const baseURL = (config.baseURL ?? "").trim().replace(/\/+$/, "");
	if (baseURL.length > 0 && !/^https?:\/\//.test(baseURL)) throw new Error("llm-sub2api: baseURL must start with http(s)://");
	return { baseURL };
}
const EMPTY_PROVIDER = {};
/** Provider map used until settings (or setConfig) provide real values. */
function defaultProviders() {
	return {
		openai: EMPTY_PROVIDER,
		claude: EMPTY_PROVIDER,
		grok: EMPTY_PROVIDER
	};
}
async function prepareConfigSave(ctx, next) {
	const settings = ctx.get("settings");
	if (settings === undefined || typeof settings.describe !== "function" || typeof settings.replace !== "function") throw new ConfigSaveError("not-committed");
	const original = Symbol.for("cordis.original");
	const settingsIdentity = Reflect.get(settings, original) ?? settings;
	const preflight = () => {
		const entries = settings.describe({ redactSecrets: true }).filter((entry$1) => entry$1.ns === NS);
		if (entries.length !== 1) throw new ConfigSaveError("not-committed");
		const entry = entries[0];
		if (entry.applies !== "live" || !Number.isSafeInteger(entry.revision) || entry.revision < 0) throw new ConfigSaveError("not-committed");
		if (typeof entry.schema !== "object" || entry.schema === null || Array.isArray(entry.schema)) throw new ConfigSaveError("not-committed");
		const form = new z(entry.schema);
		if (form.type !== "object" || Object.keys(next).some((key) => form.dict?.[key] === undefined)) throw new ConfigSaveError("not-committed");
		form(next);
		return entry.revision;
	};
	let revision;
	try {
		revision = preflight();
	} catch {
		throw new ConfigSaveError("not-committed");
	}
	return async () => {
		try {
			const currentSettings = ctx.get("settings");
			const currentIdentity = currentSettings === undefined ? undefined : Reflect.get(currentSettings, original) ?? currentSettings;
			if (currentIdentity !== settingsIdentity || preflight() !== revision) throw new ConfigSaveError("not-committed");
		} catch {
			throw new ConfigSaveError("not-committed");
		}
		try {
			await settings.replace(NS, next, revision);
		} catch {
			throw new ConfigSaveError("unknown");
		}
	};
}
function apply(ctx, config) {
	const current = () => {
		const raw = {
			baseURL: readVolatile(config?.baseURL),
			providers: readVolatile(config?.providers),
			endpoints: readVolatile(config?.endpoints),
			tools: readVolatile(config?.tools)
		};
		const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints : [];
		return {
			baseURL: raw.baseURL ?? "",
			providers: {
				...defaultProviders(),
				...raw.providers ?? {}
			},
			...endpoints.length > 0 ? { endpoints } : {},
			...raw.tools !== undefined ? { tools: raw.tools } : {}
		};
	};
	const options = () => {
		const raw = current();
		return {
			...raw,
			...resolveAdapterOptions(raw)
		};
	};
	options();
	const patchResult = applyPiAiMultiTurnPatch();
	if (patchResult.kind === "patched") ctx.logger.info(`llm-sub2api: applied pi-ai multi-turn guard to ${patchResult.file}`);
else if (patchResult.kind === "skipped") ctx.logger.warn(`llm-sub2api: pi-ai multi-turn guard not applied — ${patchResult.reason}`);
	const resolveApiKey = async (route, profile) => {
		if (profile.apiKeyEnv === undefined) throw new LlmError(`sub2api: no API key configured for route "${route}"`, "MISSING_CREDENTIAL");
		const ref = credentialRef(profile.apiKeyEnv);
		const credentials = ctx.get("credentials");
		const hit = credentials !== undefined ? await credentials.resolve(ref) : undefined;
		if (hit !== undefined && hit.value.length > 0) return assertUsableApiKey(hit.value, "llm-sub2api", ref);
		throw new LlmError(`sub2api: no credential for provider route "${route}"; its profile resolves ${profile.apiKeyEnv}, which is not set — store it through the credentials service (the web Models page writes it) or export it`, "MISSING_CREDENTIAL");
	};
	const syncPiAi = () => {
		syncPiAiProfiles(ctx, current()).catch((error) => {
			ctx.logger.error("llm-sub2api: refused to update llm-pi-ai profiles; keeping the previously registered routes");
			ctx.logger.error(error);
		});
	};
	const prepareConfig = async (next) => {
		const commit = await prepareConfigSave(ctx, next);
		return async () => {
			await commit();
			try {
				syncPiAi();
			} catch {
				throw new ConfigSaveError("committed");
			}
		};
	};
	registerRoutes(ctx, {
		config: () => current(),
		prepareConfig,
		setConfig: async (next) => {
			const commit = await prepareConfig(next);
			await commit();
		},
		listRegisteredRoutes: () => ctx.llm.listProviders().map((info) => info.id).filter((route) => route.startsWith("sub2api-")),
		resolveApiKey
	});
	registerImageTools(ctx, {
		config: () => current(),
		resolveApiKey
	});
	ctx.effect(() => ctx.settings.configure({ auto: false }));
	ctx.on("loader/volatile-update", () => {
		try {
			syncPiAi();
		} catch (error) {
			ctx.logger.error("llm-sub2api: keeping the previous llm-pi-ai profiles after a refused update");
			ctx.logger.error(error);
		}
	});
	ctx.effect(() => {
		const timer = setTimeout(() => syncPiAi(), 0);
		return () => clearTimeout(timer);
	});
}

//#endregion
export { API_PROTOCOLS, Config, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, PI_AI_NS, PROVIDERS, REASONING_EFFORTS, ROUTE_PREFIX, apiProtocolForKey, apply, applyPiAiMultiTurnPatch, gatewayAnthropicRoot, gatewayApiRoot, inject, name, prepareConfigSave, readVolatile, syncPiAiProfiles, translateToPiAi };