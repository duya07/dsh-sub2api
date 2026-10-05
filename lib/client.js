window.__ModuleLoader__.load({
	id: "@godd6366/dsh-sub2api",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react = __toESM(require("react"));
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));

//#region src/client/icons.tsx
const paths = {
	openai: "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z",
	claude: "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z",
	grok: "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"
};
function ProviderIcon({ name: name$1, size = 18, style }) {
	return (0, react_jsx_runtime.jsx)("svg", {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "currentColor",
		style: {
			flex: "none",
			lineHeight: 1,
			...style
		},
		"aria-hidden": "true",
		children: (0, react_jsx_runtime.jsx)("path", {
			d: paths[name$1],
			fillRule: "evenodd"
		})
	});
}

//#endregion
//#region src/client/settings.tsx
const BASE = "/plugins/dsh-sub2api";
const MODELS_DEV_API = "https://models.dev/api.json";
/** Model-row controls matching the official Models page. */
function IconTrash() {
	return (0, react_jsx_runtime.jsx)("svg", {
		width: "18",
		height: "18",
		viewBox: "0 0 20 20",
		fill: "none",
		"aria-hidden": true,
		children: (0, react_jsx_runtime.jsx)("path", {
			d: "M3.5 5.25h13M8 5.25V3.5h4v1.75M5.25 5.25l.8 10.1c.05.65.6 1.15 1.25 1.15h5.4c.65 0 1.2-.5 1.25-1.15l.8-10.1M8.25 8v5.75M11.75 8v5.75",
			stroke: "currentColor",
			strokeWidth: "1.5",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})
	});
}
function IconChevron({ expanded }) {
	return (0, react_jsx_runtime.jsx)("svg", {
		width: "20",
		height: "20",
		viewBox: "0 0 20 20",
		fill: "none",
		"aria-hidden": true,
		style: {
			transform: expanded ? "rotate(90deg)" : undefined,
			transition: "transform 120ms ease"
		},
		children: (0, react_jsx_runtime.jsx)("path", {
			d: "m7.5 4.75 5.25 5.25-5.25 5.25",
			stroke: "currentColor",
			strokeWidth: "1.6",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})
	});
}
const PROVIDERS = [
	{
		key: "openai",
		label: "OpenAI",
		icon: "openai",
		placeholder: "sk-…",
		modelsDevProvider: "openai"
	},
	{
		key: "claude",
		label: "Claude",
		icon: "claude",
		placeholder: "sk-ant-…",
		modelsDevProvider: "anthropic"
	},
	{
		key: "grok",
		label: "Grok",
		icon: "grok",
		placeholder: "xai-…",
		modelsDevProvider: "xai"
	}
];
function providerDefinition(key) {
	return PROVIDERS.find((def) => def.key === key) ?? PROVIDERS[0];
}
const CSS_ID = "dsh-sub2api/settings.css";
const css = `
.s2a_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.s2a_title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.s2a_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.s2a_notice{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}
.s2a_field{min-width:0;flex-direction:column;gap:5px;display:flex}
.s2a_fieldLabel{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}
.s2a_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;line-height:22px}
.s2a_input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.s2a_input::placeholder{color:var(--dsw-alias-label-dimmed)}
.s2a_rows{flex-direction:column;gap:10px;margin:4px 0 0;padding:0;list-style:none;display:flex}
.s2a_rowCard{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}
.s2a_rowHead{align-items:center;gap:10px;display:flex}
.s2a_rowIdentity{flex:1;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:inline-flex}
.s2a_rowName{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.s2a_rowTag{box-sizing:border-box;max-width:100%;min-width:0;white-space:normal;overflow-wrap:anywhere;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:0 1 auto;padding:1px 6px;font-size:11px;line-height:16px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.s2a_editor{background:var(--dsw-alias-bg-module-platform);border-radius:8px;flex-direction:column;gap:12px;padding:12px 14px;display:flex}
.s2a_rowActions,.s2a_modelActions{align-items:center;gap:4px;margin-left:auto;display:inline-flex}
.s2a_btn,.s2a_primary{box-sizing:border-box;height:32px;font:inherit;cursor:pointer;border:none;justify-content:center;align-items:center;gap:4px;font-size:13px;line-height:20px;display:inline-flex}
.s2a_btn,.s2a_primary{border-radius:16px;padding:0 14px}
.s2a_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.s2a_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.s2a_btn{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent}
.s2a_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.s2a_btn:disabled,.s2a_primary:disabled{opacity:.4;cursor:default}
.s2a_btn:focus-visible,.s2a_primary:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}
/* Square, label-free icon affordance matching the official Models page: the
   row's inputs carry the meaning, the trash glyph announces deletion. */
.s2a_iconBtn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}
.s2a_iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.s2a_iconBtn:disabled{opacity:.4;cursor:default}
.s2a_iconBtn:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}
.s2a_endpointToggle{flex:none;width:32px;height:32px}
.s2a_trash:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.s2a_models{flex-direction:column;gap:10px;display:flex}
.s2a_modelItem{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.s2a_modelSummary{grid-template-columns:minmax(0,1fr) minmax(0,.72fr) 44px 32px;align-items:center;gap:10px;padding:9px 10px 9px 12px;display:grid}
.s2a_modelSummary .s2a_input{height:38px;border-radius:7px;padding:0 12px;font-size:14px}
.s2a_expandBtn{width:44px;height:38px;border-radius:7px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.s2a_modelDetails{border-top:1px solid var(--dsw-alias-border-l2);grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 12px;padding:10px 12px 12px;display:grid}
.s2a_modelDetails .s2a_fieldLabel{font-size:12px;font-weight:400}
.s2a_reasoningField{grid-column:1/-1}
.s2a_modelEmpty{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-tertiary);margin:0;padding:16px 10px;text-align:center;font-size:12px;line-height:18px}
.s2a_modelFooter{align-items:center;justify-content:space-between;gap:8px;display:flex}
.s2a_modelSource{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.s2a_modelSource a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.s2a_actions{position:sticky;bottom:0;z-index:5;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px;padding:12px 0;background:var(--dsw-alias-bg-layer-1,#fff);border-top:1px solid var(--dsw-alias-border-l2,#ddd);display:flex}
.s2a_actions::after{content:"";position:absolute;top:100%;left:0;right:0;height:var(--s2a-footer-inset,24px);background:inherit}
.s2a_toast{position:fixed;top:24px;right:24px;z-index:10000;display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;max-width:min(480px,calc(100vw - 32px));max-height:40vh;overflow:auto;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 6px 24px #0002}.s2a_toast .s2a_status{overflow-wrap:anywhere;flex:1}.s2a_toast button{flex-shrink:0}
.s2a_status{margin:0;font-size:12px;line-height:18px;white-space:pre-wrap;color:var(--dsw-alias-label-secondary)}
.s2a_statusOk{color:var(--dsw-alias-state-success-primary)}
.s2a_statusErr{color:var(--dsw-alias-state-error-primary)}
.s2a_probeToggle{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.s2a_probe{border-top:1px solid var(--dsw-alias-border-l2);padding:8px 12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.s2a_probeStatus{flex:1;min-width:0}.s2a_probeLevels{flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px}.s2a_probe .s2a_btn{height:28px;border-radius:6px;padding:0 8px;font-size:12px}
.s2a_probeEntry{display:flex;justify-content:flex-end;padding:0 12px 8px}.s2a_probeEntry .s2a_btn{height:28px;border-radius:6px;padding:0 8px;font-size:12px}
@media(max-width:620px){
  .s2a_section,.s2a_rowIdentity{min-width:0}.s2a_rowCard{padding:10px 8px}.s2a_editor{padding:8px 0}
  .s2a_rowHead{align-items:flex-start;flex-wrap:wrap}.s2a_rowIdentity{flex-wrap:wrap}.s2a_rowTag{width:100%;flex:1 1 100%}.s2a_rowActions{width:100%;margin-left:0;flex-wrap:wrap}.s2a_rowActions .s2a_btn{flex:1;padding:0 8px}
  .s2a_modelSummary{grid-template-columns:minmax(0,1fr) 44px 32px;gap:8px;padding:8px}.s2a_modelSummary>div:nth-child(2){grid-column:1/2;grid-row:2}.s2a_modelSummary>.s2a_expandBtn{grid-column:2;grid-row:1/3}.s2a_modelSummary>.s2a_trash{grid-column:3;grid-row:1/3}
  .s2a_modelDetails{grid-template-columns:minmax(0,1fr)}.s2a_reasoningField{grid-column:auto}
  .s2a_modelFooter{align-items:stretch;flex-direction:column}.s2a_modelActions{width:100%;margin-left:0;align-items:stretch;flex-direction:column}.s2a_modelActions .s2a_btn{width:100%;padding:0 8px}
}
`;
function ensureCss() {
	if (typeof document === "undefined") return;
	if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`)) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-sub2api";
	tag.dataset.pluginCss = CSS_ID;
	tag.textContent = css;
	document.head.appendChild(tag);
}
/** 宿主 `MAX_TIMER_DELAY_MS`（@deepseek-ai/dsh-timeout）的上限。 */
const MAX_STREAM_IDLE_TIMEOUT_MS = 2147483647;
const PROBE_REASONS = {
	"accepted-parameter": "参数已接受，不证明思考生效",
	"confirmed-rejection": "重复明确拒绝，且对照成功",
	"unconfirmed-rejection": "拒绝未重复确认",
	"no-control": "无成功对照",
	"parameter-not-exact": "参数被转换或未发送",
	"budget-limited": "预算或输出上限不足",
	"rate-limited": "限流暂停",
	"auth-or-quota": "认证或额度问题",
	"upstream-error": "上游失败",
	"ambiguous-error": "原因不明确",
	"invalid-stream": "响应未完整确认",
	"timeout": "超时",
	"cancelled": "已取消",
	"sdk-unavailable": "SDK 不可用",
	"queued": "待探测"
};
function hasThinkingSuggestion(suggestion) {
	return suggestion.some((level) => level !== "off" && level !== "none");
}
function probeCandidates(row) {
	if (row.reasoning === "off") return [];
	return row.reasoning === "on" && row.effortLevels.trim() ? [...new Set(row.effortLevels.split(/[,，\s]+/).filter(Boolean))] : [...DEFAULT_REASONING_LEVELS];
}
function probeSignature(endpoint, row, baseURL) {
	return JSON.stringify([
		endpoint.baseURL.trim() || baseURL.trim(),
		endpoint.apiKey,
		endpoint.apiKeyEnv,
		endpoint.platform,
		endpoint.api,
		endpoint.autoProbeReasoning,
		endpoint.streamIdleTimeoutMs,
		row.id,
		row.contextWindow,
		row.maxTokens,
		row.input,
		row.reasoning,
		row.effortLevels,
		row.reasoningEdited,
		row.fromSaved,
		row.thinkingMode
	]);
}
const DEFAULT_REASONING_LEVELS = [
	"low",
	"medium",
	"high"
];
let nextRowId = 1;
let modelsDevRequest;
function modelRow(model = { id: "" }) {
	if (typeof model === "string") {
		const [id = "", name$1 = "", contextWindow = ""] = model.split("|");
		return {
			rowId: nextRowId++,
			id: id.trim(),
			name: name$1.trim(),
			contextWindow: contextWindow.trim(),
			maxTokens: "",
			input: "",
			reasoning: "",
			effortLevels: "",
			thinkingMode: ""
		};
	}
	const reasoningEfforts = model.reasoningEfforts;
	return {
		rowId: nextRowId++,
		id: model.id,
		name: model.name ?? "",
		contextWindow: model.contextWindow !== undefined ? String(model.contextWindow) : "",
		maxTokens: model.maxTokens !== undefined ? String(model.maxTokens) : "",
		input: model.input === undefined || model.input.length === 0 ? "" : model.input.includes("image") ? "text-image" : "text",
		reasoning: reasoningEfforts === undefined ? "" : reasoningEfforts.length === 0 ? "off" : "on",
		effortLevels: reasoningEfforts !== undefined && reasoningEfforts.length > 0 ? reasoningEfforts.join(", ") : "",
		thinkingMode: model.thinkingMode === "budget" ? "budget" : ""
	};
}
function loadModelsDev() {
	modelsDevRequest ??= fetch(MODELS_DEV_API).then(async (response) => {
		if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`);
		return await response.json();
	}).catch((error) => {
		modelsDevRequest = undefined;
		throw error;
	});
	return modelsDevRequest;
}
function canonicalModelsDevProvider(id) {
	const normalized = id.toLowerCase();
	if (/^(gpt|o[134]|codex)/.test(normalized)) return "openai";
	if (normalized.startsWith("claude")) return "anthropic";
	if (normalized.startsWith("grok")) return "xai";
	if (normalized.startsWith("gemini")) return "google";
	if (normalized.startsWith("deepseek")) return "deepseek";
	return undefined;
}
function officialModel(catalog, def, id) {
	const preferredProviders = [canonicalModelsDevProvider(id), def.modelsDevProvider].filter((provider, index, all) => provider !== undefined && all.indexOf(provider) === index);
	for (const provider of preferredProviders) {
		const models = catalog[provider]?.models;
		const match = models?.[id] ?? (models !== undefined ? Object.values(models).find((model) => model.id === id) : undefined);
		if (match !== undefined) return match;
	}
	for (const provider of Object.values(catalog)) {
		const models = provider.models;
		const match = models?.[id] ?? (models !== undefined ? Object.values(models).find((model) => model.id === id) : undefined);
		if (match !== undefined) return match;
	}
	return undefined;
}
/** The concrete reasoning-effort levels a model advertises, or undefined. */
function officialEffortValues(official) {
	const effort = official.reasoning_options?.find((option) => option.type === "effort");
	const values = effort?.values;
	if (values === undefined || values.length === 0) return undefined;
	return values.filter((value) => typeof value === "string" && value.length > 0);
}
/**

* Image-input modality derived from models.dev: an explicit modality list

* wins, then the `attachment` flag. Absent means the entry says nothing, and

* the row keeps "auto" (the adapter infers from the model id).

*/
function officialInput(official) {
	const input = official.modalities?.input;
	if (Array.isArray(input) && input.includes("image")) return "text-image";
	if (typeof official.attachment === "boolean") return official.attachment ? "text-image" : "text";
	return undefined;
}
function applyOfficialDefaults(rows, def, catalog) {
	let filled = 0;
	const next = rows.map((row) => {
		const official = officialModel(catalog, def, row.id.trim());
		if (official === undefined) return row;
		const name$1 = row.name.trim().length === 0 && typeof official.name === "string" ? official.name : row.name;
		const officialContext = official.limit?.context;
		const contextWindow = row.contextWindow.length === 0 && Number.isSafeInteger(officialContext) && (officialContext ?? 0) > 0 ? String(officialContext) : row.contextWindow;
		const officialOutput = official.limit?.output;
		const maxTokens = row.maxTokens.length === 0 && Number.isSafeInteger(officialOutput) && (officialOutput ?? 0) > 0 ? String(officialOutput) : row.maxTokens;
		const input = !row.inputEdited && row.input.length === 0 && officialInput(official) !== undefined ? officialInput(official) : row.input;
		const officialEfforts = officialEffortValues(official);
		let reasoning = row.reasoning;
		let effortLevels = row.effortLevels;
		if (!row.reasoningEdited && reasoning.length === 0) {
			if (officialEfforts !== undefined && officialEfforts.length > 0) {
				reasoning = "on";
				effortLevels = officialEfforts.join(", ");
			} else if (typeof official.reasoning === "boolean") {
				reasoning = official.reasoning ? "on" : "off";
				effortLevels = official.reasoning ? DEFAULT_REASONING_LEVELS.join(", ") : "";
			}
		}
		if (name$1 !== row.name || contextWindow !== row.contextWindow || maxTokens !== row.maxTokens || input !== row.input || reasoning !== row.reasoning || effortLevels !== row.effortLevels) filled++;
		return {
			...row,
			name: name$1,
			contextWindow,
			maxTokens,
			input,
			reasoning,
			effortLevels
		};
	});
	return {
		rows: next,
		filled
	};
}
var ProbeCapacityError = class extends Error {};
async function api(path, init, capacityWait = false) {
	const response = await fetch(path, {
		...init,
		headers: {
			"content-type": "application/json",
			...init?.headers
		}
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok) {
		if (capacityWait && response.status === 429) throw new ProbeCapacityError("probe task limit");
		const message = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
		throw new Error(message);
	}
	return payload;
}
function endpointRow(platform = "openai") {
	return {
		rowId: nextRowId++,
		name: "",
		baseURL: "",
		platform,
		apiKey: "",
		apiKeyEnv: "",
		keyConfigured: false,
		api: "",
		models: [],
		route: "",
		streamIdleTimeoutMs: "",
		autoProbeReasoning: false
	};
}
function endpointRowFrom(value) {
	const platform = PROVIDERS.some((def) => def.key === value.platform) ? value.platform : "openai";
	return {
		rowId: nextRowId++,
		name: typeof value.name === "string" ? value.name : "",
		baseURL: typeof value.baseURL === "string" ? value.baseURL : "",
		platform,
		apiKey: "",
		apiKeyEnv: typeof value.apiKeyEnv === "string" ? value.apiKeyEnv : "",
		keyConfigured: value.keyConfigured === true,
		api: typeof value.api === "string" ? value.api : "",
		models: (value.models ?? []).map((model) => ({
			...modelRow(model),
			fromSaved: true
		})),
		route: typeof value.route === "string" ? value.route : "",
		streamIdleTimeoutMs: value.streamIdleTimeoutMs !== undefined ? String(value.streamIdleTimeoutMs) : "",
		autoProbeReasoning: false
	};
}
function emptyToolRef() {
	return {
		provider: "",
		model: ""
	};
}
function emptyTools() {
	return {
		generate: emptyToolRef(),
		webSearch: {
			enabled: false,
			provider: "",
			model: ""
		}
	};
}
/**

* The stored ref names either an endpoint's route id (`sub2api-openai-gw2`) or,

* for sections written before endpoints existed, a bare platform key.

*/
function toolRefFromConfig(value) {
	const provider = typeof value?.provider === "string" ? value.provider : "";
	const model = typeof value?.model === "string" ? value.model : "";
	const known = PROVIDERS.some((def) => def.key === provider) || provider.startsWith("sub2api-");
	return known ? {
		provider,
		model
	} : {
		provider: "",
		model: ""
	};
}
function toolOptions(endpoints) {
	const options = [];
	for (const endpoint of endpoints) {
		if (endpoint.route.length === 0) continue;
		const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : providerDefinition(endpoint.platform).label;
		for (const row of endpoint.models) {
			const id = row.id.trim();
			if (id.length === 0) continue;
			const name$1 = row.name.trim();
			options.push({
				value: `${endpoint.route}:${id}`,
				label: `${title} / ${name$1.length > 0 ? `${name$1} (${id})` : id}`,
				provider: endpoint.route,
				model: id
			});
		}
	}
	return options;
}
function serializeToolRef(ref) {
	const provider = ref.provider.trim();
	const model = ref.model.trim();
	if (provider.length === 0 || model.length === 0) return undefined;
	return {
		provider,
		model
	};
}
/**

* Validate one row's model catalog and drop everything the section schema would

* not accept. `title` is the row's display name, so an error names the row it

* came from instead of a platform the user cannot see on screen any more.

*/
/**

* Validate one endpoint's route-level stream idle timeout. An empty field keeps

* the key out of the payload so the host default (300000 ms) applies; anything

* else must be a positive integer the host accepts, or the save is refused

* instead of storing a value llm-pi-ai would reject while loading the profile.

*/
function serializeStreamIdleTimeout(value, title) {
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	const parsed = Number(trimmed);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${title} 的流空闲超时必须是正整数（毫秒）`);
	if (parsed > MAX_STREAM_IDLE_TIMEOUT_MS) throw new Error(`${title} 的流空闲超时不能超过 ${MAX_STREAM_IDLE_TIMEOUT_MS} 毫秒`);
	return parsed;
}
function serializeModels(rows, title) {
	const nonEmptyRows = rows.filter((row) => row.id.trim().length > 0 || row.name.trim().length > 0 || row.contextWindow.length > 0 || row.maxTokens.length > 0 || row.reasoning.length > 0);
	const seen = new Set();
	return nonEmptyRows.map((row) => {
		const id = row.id.trim();
		if (id.length === 0) throw new Error(`${title} 存在未填写 ID 的模型`);
		if (seen.has(id)) throw new Error(`${title} 模型 ID 重复：${id}`);
		seen.add(id);
		const name$1 = row.name.trim();
		const contextWindow = row.contextWindow.length > 0 ? Number(row.contextWindow) : undefined;
		if (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow < 1)) throw new Error(`${title} ${id} 的 Context Window 必须是正整数`);
		const maxTokens = row.maxTokens.trim().length > 0 ? Number(row.maxTokens) : undefined;
		if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) throw new Error(`${title} ${id} 的 Max Tokens 必须是正整数`);
		const reasoningEfforts = row.reasoning === "off" ? [] : row.reasoning === "on" ? [...new Set(row.effortLevels.split(/[,，/\s]+/).filter(Boolean))] : undefined;
		if (row.reasoning === "on" && !reasoningEfforts?.length) throw new Error(`${title} ${id} 请填写至少一个思考强度`);
		if (reasoningEfforts?.some((level) => ![
			"none",
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max"
		].includes(level))) throw new Error(`${title} ${id} 思考强度支持 none、off、minimal、low、medium、high、xhigh、max`);
		const input = row.input === "text-image" ? ["text", "image"] : row.input === "text" ? ["text"] : undefined;
		return {
			id,
			...name$1.length > 0 ? { name: name$1 } : {},
			...contextWindow !== undefined ? { contextWindow } : {},
			...maxTokens !== undefined ? { maxTokens } : {},
			...input !== undefined ? { input } : {},
			...reasoningEfforts !== undefined ? { reasoningEfforts } : {},
			...row.thinkingMode === "budget" ? { thinkingMode: "budget" } : {}
		};
	});
}
function Sub2ApiSettings() {
	const sectionRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		const section = sectionRef.current;
		if (!section) return;
		let scroller = section.parentElement;
		while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
		if (!scroller) return;
		const update = () => section.style.setProperty("--s2a-footer-inset", getComputedStyle(scroller).paddingBottom);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(scroller);
		return () => observer.disconnect();
	}, []);
	const [baseURL, setBaseURL] = (0, react.useState)("");
	const [endpoints, setEndpointState] = (0, react.useState)([]);
	const endpointsRef = (0, react.useRef)([]);
	const setEndpoints = (0, react.useCallback)((next) => {
		const value = typeof next === "function" ? next(endpointsRef.current) : next;
		endpointsRef.current = value;
		setEndpointState(value);
	}, []);
	const [probes, setProbes] = (0, react.useState)({});
	const liveProbes = (0, react.useRef)(new Map());
	const pendingProbes = (0, react.useRef)([]);
	const submittedProbes = (0, react.useRef)(new Set());
	const revisions = (0, react.useRef)(new Map());
	const mounted = (0, react.useRef)(true);
	const baseRef = (0, react.useRef)(baseURL);
	baseRef.current = baseURL;
	const current = (run) => {
		const entry = endpointsRef.current.find((item) => item.rowId === run.endpoint);
		const model = entry?.models.find((item) => item.rowId === run.row);
		return mounted.current && !run.cancelled && liveProbes.current.get(run.row) === run && entry !== undefined && model !== undefined && probeSignature(entry, model, baseRef.current) === run.signature;
	};
	const waitForProbe = (run, delay) => new Promise((resolve) => {
		if (run.cancelled) {
			resolve();
			return;
		}
		run.wake = resolve;
		run.timer = window.setTimeout(() => {
			run.timer = undefined;
			run.wake = undefined;
			resolve();
		}, delay);
	});
	const releaseRun = (run) => {
		if (run.deadlineTimer !== undefined) window.clearTimeout(run.deadlineTimer);
		if (liveProbes.current.get(run.row) === run) liveProbes.current.delete(run.row);
		if (submittedProbes.current.delete(run)) drainProbeQueue();
	};
	const cancelRun = (run) => {
		run.cancelled = true;
		run.controller.abort();
		if (run.timer !== undefined) window.clearTimeout(run.timer);
		if (run.deadlineTimer !== undefined) window.clearTimeout(run.deadlineTimer);
		run.wake?.();
		run.wake = undefined;
		pendingProbes.current = pendingProbes.current.filter((entry) => entry !== run);
		if (run.id && !run.cancelRequest) run.cancelRequest = api(`${BASE}/reasoning/cancel`, {
			method: "POST",
			body: JSON.stringify({ id: run.id })
		}).then(() => {
			releaseRun(run);
		}).catch(() => {});
	};
	const drainProbeQueue = () => {
		if (!mounted.current) return;
		while (submittedProbes.current.size < 8 && pendingProbes.current.length > 0) {
			const run = pendingProbes.current.shift();
			if (!current(run)) {
				const stale = liveProbes.current.get(run.row) === run;
				cancelRun(run);
				if (stale) {
					liveProbes.current.delete(run.row);
					setProbes((previous) => previous[run.row] ? {
						...previous,
						[run.row]: {
							...previous[run.row],
							phase: "cancelled"
						}
					} : previous);
				}
				continue;
			}
			submittedProbes.current.add(run);
			void run.launch().finally(async () => {
				await run.cancelRequest;
				releaseRun(run);
			});
		}
	};
	const invalidateEndpoint = (id) => {
		revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1);
		for (const [row, run] of liveProbes.current) if (run.endpoint === id) {
			cancelRun(run);
			liveProbes.current.delete(row);
		}
		setProbes((previous) => Object.fromEntries(Object.entries(previous).filter(([row]) => !endpointsRef.current.find((endpoint) => endpoint.rowId === id)?.models.some((model) => model.rowId === Number(row)))));
	};
	const cancelProbe = (row) => {
		const run = liveProbes.current.get(row);
		if (run) {
			cancelRun(run);
			liveProbes.current.delete(row);
		}
		setProbes((previous) => previous[row] ? {
			...previous,
			[row]: {
				...previous[row],
				phase: "cancelled"
			}
		} : previous);
	};
	(0, react.useEffect)(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			for (const run of liveProbes.current.values()) cancelRun(run);
			liveProbes.current.clear();
		};
	}, []);
	const [tools, setTools] = (0, react.useState)(emptyTools());
	const [structuredConfig, setStructuredConfig] = (0, react.useState)(false);
	const [expandedEndpoints, setExpandedEndpoints] = (0, react.useState)(() => new Set());
	const [expandedModels, setExpandedModels] = (0, react.useState)(() => new Set());
	const [busy, setBusy] = (0, react.useState)("");
	const [message, setMessage] = (0, react.useState)("");
	const [error, setError] = (0, react.useState)("");
	(0, react.useEffect)(() => {
		if (!message && !error) return;
		const timer = window.setTimeout(() => {
			setMessage("");
			setError("");
		}, error ? 1e4 : 6e3);
		return () => window.clearTimeout(timer);
	}, [message, error]);
	(0, react.useEffect)(() => {
		ensureCss();
		api(`${BASE}/config`).then(async (cfg) => {
			setBaseURL(cfg.baseURL ?? "");
			setStructuredConfig(cfg.catalogFormat === "structured-v1");
			setEndpoints((cfg.endpoints ?? []).map(endpointRowFrom));
			setTools({
				generate: toolRefFromConfig(cfg.tools?.generate),
				webSearch: {
					enabled: cfg.tools?.webSearch?.enabled === true,
					provider: typeof cfg.tools?.webSearch?.provider === "string" ? cfg.tools.webSearch.provider : "",
					model: typeof cfg.tools?.webSearch?.model === "string" ? cfg.tools.webSearch.model : ""
				}
			});
			try {
				const catalog = await loadModelsDev();
				setEndpoints((current$1) => current$1.map((endpoint) => ({
					...endpoint,
					models: applyOfficialDefaults(endpoint.models, providerDefinition(endpoint.platform), catalog).rows
				})));
			} catch {}
		}).catch((e) => setError(String(e instanceof Error ? e.message : e)));
	}, []);
	const updateEndpoint = (0, react.useCallback)((rowId, patch) => {
		invalidateEndpoint(rowId);
		setEndpoints((previous) => previous.map((endpoint) => endpoint.rowId === rowId ? {
			...endpoint,
			...patch
		} : endpoint));
	}, []);
	const updateModel = (endpointRowId, rowId, patch) => {
		invalidateEndpoint(endpointRowId);
		setEndpoints((previous) => previous.map((endpoint) => endpoint.rowId === endpointRowId ? {
			...endpoint,
			models: endpoint.models.map((row) => row.rowId === rowId ? {
				...row,
				...patch
			} : row)
		} : endpoint));
	};
	const toggleEndpoint = (rowId) => {
		setExpandedEndpoints((current$1) => {
			const next = new Set(current$1);
			if (next.has(rowId)) next.delete(rowId);
else next.add(rowId);
			return next;
		});
	};
	const startProbes = (endpoint, rows = endpoint.models, manual = false) => {
		if (!endpoint.autoProbeReasoning && !manual || !mounted.current) return;
		for (const row of rows) {
			const candidates = manual && row.reasoning === "off" ? [...DEFAULT_REASONING_LEVELS] : probeCandidates(row);
			if (!row.id.trim() || !candidates.length) continue;
			const old = liveProbes.current.get(row.rowId);
			if (old) cancelRun(old);
			const run = {
				endpoint: endpoint.rowId,
				row: row.rowId,
				signature: probeSignature(endpoint, row, baseRef.current),
				cancelled: false,
				controller: new AbortController()
			};
			liveProbes.current.set(row.rowId, run);
			const initial = {
				id: "",
				phase: "queued",
				requests: 0,
				maxRequests: 1 + 3 * candidates.length,
				minGapMs: 5e3,
				estimateMs: (1 + 3 * candidates.length) * 5e3,
				levels: candidates.map((level) => ({
					level,
					state: "unknown",
					reason: "queued"
				})),
				suggestion: candidates
			};
			setProbes((previous) => ({
				...previous,
				[row.rowId]: initial
			}));
			run.deadlineTimer = window.setTimeout(() => {
				const active = current(run);
				cancelRun(run);
				if (liveProbes.current.get(run.row) === run) liveProbes.current.delete(run.row);
				if (active) setProbes((previous) => ({
					...previous,
					[row.rowId]: {
						...previous[row.rowId] ?? initial,
						phase: "expired"
					}
				}));
			}, 6e5);
			run.launch = async () => {
				try {
					let receipt;
					for (let attempt = 0; attempt < 12 && current(run); attempt++) try {
						receipt = await api(`${BASE}/reasoning/start`, {
							method: "POST",
							body: JSON.stringify({
								endpoint: {
									baseURL: endpoint.baseURL.trim() || baseRef.current.trim(),
									platform: endpoint.platform,
									api: endpoint.api || (endpoint.platform === "claude" ? "anthropic-messages" : endpoint.platform === "grok" ? "openai-completions" : "openai-responses"),
									apiKey: endpoint.apiKey,
									apiKeyEnv: endpoint.apiKeyEnv
								},
								model: {
									id: row.id.trim(),
									...row.contextWindow.trim() ? { contextWindow: Number(row.contextWindow) } : {},
									...row.maxTokens.trim() ? { maxTokens: Number(row.maxTokens) } : {}
								},
								candidates
							})
						}, true);
						break;
					} catch (e) {
						if (!(e instanceof ProbeCapacityError) || attempt === 11) throw e;
						if (!current(run)) return;
						await waitForProbe(run, Math.min(1e3 * 2 ** attempt, 3e4));
					}
					if (!receipt) return;
					run.id = receipt.id;
					if (!current(run)) {
						cancelRun(run);
						return;
					}
					setProbes((previous) => ({
						...previous,
						[row.rowId]: {
							...initial,
							...receipt,
							levels: receipt.levels ?? initial.levels,
							suggestion: receipt.suggestion ?? initial.suggestion
						}
					}));
					for (;;) {
						const status = await api(`${BASE}/reasoning/status`, {
							method: "POST",
							body: JSON.stringify({ id: run.id }),
							signal: run.controller.signal
						});
						if (!current(run)) {
							cancelRun(run);
							return;
						}
						setProbes((previous) => ({
							...previous,
							[row.rowId]: {
								...initial,
								...status,
								levels: status.levels ?? initial.levels,
								suggestion: status.suggestion ?? initial.suggestion
							}
						}));
						if (!["queued", "running"].includes(status.phase)) {
							if (status.phase === "completed" && hasThinkingSuggestion(status.suggestion) && !row.fromSaved && !row.reasoningEdited && row.reasoning !== "off") setEndpoints((previous) => previous.map((entry) => entry.rowId === run.endpoint ? {
								...entry,
								models: entry.models.map((model) => model.rowId === run.row ? {
									...model,
									reasoning: "on",
									effortLevels: status.suggestion.join(", ")
								} : model)
							} : entry));
							break;
						}
						await waitForProbe(run, 1e3);
						if (!current(run)) return;
					}
				} catch {
					if (current(run)) {
						setProbes((previous) => ({
							...previous,
							[row.rowId]: {
								...initial,
								phase: "unavailable"
							}
						}));
						cancelRun(run);
					}
				}
			};
			pendingProbes.current.push(run);
		}
		drainProbeQueue();
	};
	const applyProbe = (endpointRowId, rowId) => {
		const suggestion = probes[rowId]?.suggestion;
		if (probes[rowId]?.phase !== "completed" || !suggestion || !hasThinkingSuggestion(suggestion)) return;
		updateModel(endpointRowId, rowId, {
			reasoning: "on",
			effortLevels: suggestion.join(", "),
			reasoningEdited: true
		});
	};
	const toggleModel = (rowId) => {
		setExpandedModels((current$1) => {
			const next = new Set(current$1);
			if (next.has(rowId)) next.delete(rowId);
else next.add(rowId);
			return next;
		});
	};
	const fillModel = async (endpointRowId, rowId) => {
		try {
			const catalog = await loadModelsDev();
			setEndpoints((previous) => previous.map((endpoint) => {
				if (endpoint.rowId !== endpointRowId) return endpoint;
				const def = providerDefinition(endpoint.platform);
				const models = endpoint.models.map((row) => row.rowId === rowId ? applyOfficialDefaults([row], def, catalog).rows[0] ?? row : row);
				return {
					...endpoint,
					models
				};
			}));
		} catch {}
	};
	const fillProvider = async (endpointRowId) => {
		invalidateEndpoint(endpointRowId);
		const revision = revisions.current.get(endpointRowId);
		const endpoint = endpointsRef.current.find((entry) => entry.rowId === endpointRowId);
		const def = providerDefinition(endpoint?.platform ?? "openai");
		const title = endpoint !== undefined && endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label;
		setBusy(`metadata-${endpointRowId}`);
		setError("");
		setMessage("");
		try {
			const catalog = await loadModelsDev();
			if (!mounted.current || revisions.current.get(endpointRowId) !== revision) return;
			setEndpoints((previous) => previous.map((entry) => entry.rowId === endpointRowId ? {
				...entry,
				models: applyOfficialDefaults(entry.models, providerDefinition(entry.platform), catalog).rows
			} : entry));
			setMessage(`${title} 已补全空白字段，保留手动设置`);
		} catch (e) {
			setError(`无法读取 models.dev：${String(e instanceof Error ? e.message : e)}`);
		} finally {
			setBusy("");
			const entry = endpointsRef.current.find((item) => item.rowId === endpointRowId);
			if (entry && mounted.current && revisions.current.get(endpointRowId) === revision) startProbes(entry);
		}
	};
	const save = async () => {
		const submitted = endpointsRef.current;
		for (const endpoint of submitted) invalidateEndpoint(endpoint.rowId);
		setBusy("save");
		setError("");
		setMessage("");
		try {
			if (!structuredConfig) throw new Error("服务端仍在运行旧版插件，请重启 DSH Web 后再保存结构化模型配置");
			if (submitted.length > 0 && submitted.every((endpoint) => endpoint.baseURL.trim().length === 0) && baseURL.trim().length === 0) throw new Error("请至少填写一个网关地址：每个端点自己的地址，或上方的默认地址");
			const payload = {
				baseURL,
				endpoints: submitted.map((endpoint) => {
					const def = providerDefinition(endpoint.platform);
					const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label;
					const streamIdleTimeoutMs = serializeStreamIdleTimeout(endpoint.streamIdleTimeoutMs, title);
					return {
						name: endpoint.name.trim(),
						baseURL: endpoint.baseURL.trim(),
						platform: endpoint.platform,
						apiKey: endpoint.apiKey,
						...endpoint.apiKeyEnv.length > 0 ? { apiKeyEnv: endpoint.apiKeyEnv } : {},
						api: endpoint.api,
						models: serializeModels(endpoint.models, title),
						...streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs } : {}
					};
				}),
				tools: {}
			};
			const generate = serializeToolRef(tools.generate);
			if (generate !== undefined) payload.tools.generate = generate;
			if (tools.webSearch.enabled) {
				const webSearch = serializeToolRef(tools.webSearch);
				if (webSearch === undefined) throw new Error("启用联网搜索需要先选择一个搜索模型");
				payload.tools.webSearch = {
					enabled: true,
					provider: webSearch.provider,
					model: webSearch.model
				};
			}
			const res = await api(`${BASE}/config`, {
				method: "POST",
				body: JSON.stringify(payload)
			});
			if (!mounted.current) return;
			if (!res || typeof res !== "object" || Array.isArray(res) || res.ok !== true) throw new Error(typeof res?.error === "string" ? res.error : "保存响应无效");
			if (res.routes !== undefined && (!Array.isArray(res.routes) || res.routes.some((route) => typeof route !== "string"))) throw new Error("保存响应的路由无效");
			const acknowledgements = res.endpoints;
			if (acknowledgements !== undefined && (!Array.isArray(acknowledgements) || acknowledgements.length !== submitted.length || acknowledgements.some((ack, index) => {
				const sent = payload.endpoints[index];
				return !ack || typeof ack !== "object" || Array.isArray(ack) || ack.name !== sent.name || ack.baseURL !== sent.baseURL.replace(/\/+$/, "") || ack.platform !== sent.platform || typeof ack.apiKeyEnv !== "string" || typeof ack.route !== "string" || typeof ack.keyConfigured !== "boolean";
			}))) throw new Error("保存响应的端点与提交不匹配");
			const routes = res.routes !== undefined && res.routes.length > 0 ? res.routes.join(", ") : "无（未填 key）";
			setMessage(`已保存。激活路由: ${routes}`);
			setEndpoints((previous) => previous.map((endpoint) => {
				const index = submitted.findIndex((sent$1) => sent$1.rowId === endpoint.rowId);
				if (index < 0) return endpoint;
				const sent = submitted[index];
				const ack = acknowledgements?.[index];
				return {
					...endpoint,
					...ack ? {
						apiKeyEnv: ack.apiKeyEnv,
						route: ack.route,
						keyConfigured: ack.keyConfigured,
						apiKey: endpoint.apiKey === sent.apiKey ? "" : endpoint.apiKey
					} : {},
					models: endpoint.models.map((row) => sent.models.includes(row) ? {
						...row,
						fromSaved: true
					} : row)
				};
			}));
		} catch (e) {
			if (mounted.current) setError(String(e instanceof Error ? e.message : e));
		} finally {
			if (mounted.current) setBusy("");
		}
	};
	const addEndpoint = () => {
		const endpoint = endpointRow();
		setEndpoints((previous) => [...previous, endpoint]);
		setExpandedEndpoints((current$1) => new Set([...current$1, endpoint.rowId]));
		setError("");
		setMessage("已添加一个端点，选择平台、填写地址与 API Key 后保存");
	};
	const removeEndpoint = (endpointRowId) => {
		invalidateEndpoint(endpointRowId);
		setEndpoints((previous) => previous.filter((endpoint) => endpoint.rowId !== endpointRowId));
		setExpandedEndpoints((current$1) => {
			const next = new Set(current$1);
			next.delete(endpointRowId);
			return next;
		});
	};
	const discover = async (endpointRowId) => {
		invalidateEndpoint(endpointRowId);
		const endpoint = endpointsRef.current.find((entry) => entry.rowId === endpointRowId);
		if (endpoint === undefined) return;
		const def = providerDefinition(endpoint.platform);
		const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label;
		setBusy(`discover-${endpointRowId}`);
		setError("");
		setMessage("");
		if (!endpoint.autoProbeReasoning) updateEndpoint(endpointRowId, { models: [] });
		const revision = revisions.current.get(endpointRowId);
		try {
			const res = await api(`${BASE}/discover`, {
				method: "POST",
				body: JSON.stringify({
					baseURL: endpoint.baseURL.trim() || baseURL,
					apiKey: endpoint.apiKey,
					apiKeyEnv: endpoint.apiKeyEnv,
					provider: endpoint.platform
				})
			});
			if (!mounted.current || revisions.current.get(endpointRowId) !== revision) return;
			let rows = (res.models ?? []).map((model) => endpoint.autoProbeReasoning ? endpoint.models.find((row) => row.id === model.id) ?? modelRow(model) : modelRow(model));
			try {
				rows = applyOfficialDefaults(rows, def, await loadModelsDev()).rows;
			} catch {}
			if (!mounted.current || revisions.current.get(endpointRowId) !== revision) return;
			setEndpoints((previous) => previous.map((entry$1) => entry$1.rowId === endpointRowId ? {
				...entry$1,
				models: rows
			} : entry$1));
			const entry = endpointsRef.current.find((item) => item.rowId === endpointRowId);
			if (entry) startProbes(entry);
			setMessage(`${title} 发现 ${rows.length} 个模型`);
		} catch (e) {
			setError(String(e instanceof Error ? e.message : e));
		} finally {
			setBusy("");
		}
	};
	const checkUsage = async (endpointRowId) => {
		const endpoint = endpoints.find((entry) => entry.rowId === endpointRowId);
		if (endpoint === undefined) return;
		const def = providerDefinition(endpoint.platform);
		const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label;
		setBusy(`usage-${endpointRowId}`);
		setError("");
		setMessage("");
		try {
			const res = await api(`${BASE}/usage`, {
				method: "POST",
				body: JSON.stringify({
					baseURL: endpoint.baseURL.trim() || baseURL,
					apiKey: endpoint.apiKey,
					apiKeyEnv: endpoint.apiKeyEnv,
					provider: endpoint.platform
				})
			});
			setMessage(`${title} 用量: ${res.summary ?? ""}`);
		} catch (e) {
			setError(String(e instanceof Error ? e.message : e));
		} finally {
			setBusy("");
		}
	};
	const checkStatus = async () => {
		setBusy("status");
		setError("");
		setMessage("");
		try {
			const res = await api(`${BASE}/status`);
			setMessage(`已注册路由: ${res.routes.length > 0 ? res.routes.join(", ") : "无"}；模型: ${JSON.stringify(res.models)}`);
		} catch (e) {
			setError(String(e instanceof Error ? e.message : e));
		} finally {
			setBusy("");
		}
	};
	const webSearchOptions = toolOptions(endpoints);
	const webSearchSelected = tools.webSearch.provider.length > 0 && tools.webSearch.model.length > 0 ? `${tools.webSearch.provider}:${tools.webSearch.model}` : "";
	const webSearchKnown = webSearchOptions.some((option) => option.value === webSearchSelected);
	return (0, react_jsx_runtime.jsxs)("div", {
		className: "s2a_section",
		ref: sectionRef,
		children: [
			(0, react_jsx_runtime.jsx)("h2", {
				className: "s2a_title",
				children: "Sub2API 模型接入"
			}),
			(0, react_jsx_runtime.jsx)("p", {
				className: "s2a_intro",
				children: "多端点 + 多 key：每个端点填自己的网关地址与 API key，key 在 sub2api 后台绑定的分组决定平台（OpenAI / Claude / Grok）与可用模型。"
			}),
			(0, react_jsx_runtime.jsx)("p", {
				className: "s2a_notice",
				children: "提示：先在 sub2api 后台创建各平台的分组并生成 API key，再在下方逐个添加端点。"
			}),
			(0, react_jsx_runtime.jsxs)("div", {
				className: "s2a_field",
				style: { marginTop: 2 },
				children: [(0, react_jsx_runtime.jsx)("label", {
					className: "s2a_fieldLabel",
					children: "默认网关地址（端点未单独填写时使用）"
				}), (0, react_jsx_runtime.jsx)("input", {
					className: "s2a_input",
					value: baseURL,
					placeholder: "http://localhost:8080",
					onChange: (event) => {
						for (const endpoint of endpointsRef.current) invalidateEndpoint(endpoint.rowId);
						baseRef.current = event.target.value;
						setBaseURL(event.target.value);
					}
				})]
			}),
			(0, react_jsx_runtime.jsxs)("div", {
				className: "s2a_rowCard",
				children: [(0, react_jsx_runtime.jsx)("div", {
					className: "s2a_rowHead",
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: "s2a_rowIdentity",
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: "s2a_rowName",
							children: "图片生成工具"
						}), (0, react_jsx_runtime.jsx)("span", {
							className: "s2a_rowTag",
							children: "generate_image"
						})]
					})
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: "s2a_editor",
					children: [(0, react_jsx_runtime.jsx)("p", {
						className: "s2a_intro",
						children: "指定生成图片使用的模型，生成结果会保存到工作区。"
					}), ["generate"].map((kind) => {
						const label = "生图模型";
						const ref = tools[kind];
						const options = toolOptions(endpoints);
						const selected = ref.provider.length > 0 && ref.model.length > 0 ? `${ref.provider}:${ref.model}` : "";
						const known = options.some((option) => option.value === selected);
						return (0, react_jsx_runtime.jsxs)("div", {
							className: "s2a_field",
							children: [(0, react_jsx_runtime.jsx)("label", {
								className: "s2a_fieldLabel",
								children: label
							}), (0, react_jsx_runtime.jsxs)("select", {
								className: "s2a_input",
								value: selected,
								"aria-label": label,
								onChange: (event) => {
									const next = options.find((option) => option.value === event.target.value);
									setTools((current$1) => ({
										...current$1,
										[kind]: next === undefined ? emptyToolRef() : {
											provider: next.provider,
											model: next.model
										}
									}));
								},
								children: [
									(0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "未指定"
									}),
									!known && selected.length > 0 && (0, react_jsx_runtime.jsx)("option", {
										value: selected,
										children: `${ref.provider} / ${ref.model}（不在当前目录）`
									}),
									options.map((option) => (0, react_jsx_runtime.jsx)("option", {
										value: option.value,
										children: option.label
									}, option.value))
								]
							})]
						}, kind);
					})]
				})]
			}),
			(0, react_jsx_runtime.jsxs)("div", {
				className: "s2a_rowCard",
				children: [(0, react_jsx_runtime.jsx)("div", {
					className: "s2a_rowHead",
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: "s2a_rowIdentity",
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: "s2a_rowName",
							children: "联网搜索"
						}), (0, react_jsx_runtime.jsx)("span", {
							className: "s2a_rowTag",
							children: "web_search"
						})]
					})
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: "s2a_editor",
					children: [
						(0, react_jsx_runtime.jsx)("p", {
							className: "s2a_intro",
							children: "启用后本插件会作为 DSH 搜索提供商的一个候选项：由所选模型经网关自带的 web_search 工具联网检索，回答与来源一并返回。 默认关闭；关闭时不注册候选，现有搜索提供商不受影响。"
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: "s2a_field",
							children: (0, react_jsx_runtime.jsxs)("label", {
								className: "s2a_fieldLabel",
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8
								},
								children: [(0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									"aria-label": "启用联网搜索",
									checked: tools.webSearch.enabled,
									onChange: (event) => {
										const checked = event.target.checked;
										setTools((current$1) => ({
											...current$1,
											webSearch: {
												...current$1.webSearch,
												enabled: checked
											}
										}));
									}
								}), "启用联网搜索（默认关闭）"]
							})
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: "s2a_field",
							children: [(0, react_jsx_runtime.jsx)("label", {
								className: "s2a_fieldLabel",
								children: "搜索模型"
							}), (0, react_jsx_runtime.jsxs)("select", {
								className: "s2a_input",
								"aria-label": "搜索模型",
								disabled: !tools.webSearch.enabled,
								value: webSearchSelected,
								onChange: (event) => {
									const next = webSearchOptions.find((option) => option.value === event.target.value);
									setTools((current$1) => ({
										...current$1,
										webSearch: {
											...current$1.webSearch,
											provider: next === undefined ? "" : next.provider,
											model: next === undefined ? "" : next.model
										}
									}));
								},
								children: [
									(0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "未指定"
									}),
									!webSearchKnown && webSearchSelected.length > 0 && (0, react_jsx_runtime.jsx)("option", {
										value: webSearchSelected,
										children: `${tools.webSearch.provider} / ${tools.webSearch.model}（不在当前目录）`
									}),
									webSearchOptions.map((option) => (0, react_jsx_runtime.jsx)("option", {
										value: option.value,
										children: option.label
									}, option.value))
								]
							})]
						})
					]
				})]
			}),
			(0, react_jsx_runtime.jsx)("ul", {
				className: "s2a_rows",
				children: endpoints.map((endpoint) => {
					const def = providerDefinition(endpoint.platform);
					const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label;
					const expanded = expandedEndpoints.has(endpoint.rowId);
					const detailsId = `s2a-endpoint-${endpoint.rowId}-details`;
					return (0, react_jsx_runtime.jsxs)("li", {
						className: "s2a_rowCard",
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: "s2a_rowHead",
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "s2a_iconBtn s2a_endpointToggle",
									title: expanded ? "收起端点" : "展开端点",
									"aria-label": `${expanded ? "收起" : "展开"} ${title} 端点`,
									"aria-expanded": expanded,
									"aria-controls": detailsId,
									onClick: () => toggleEndpoint(endpoint.rowId),
									children: (0, react_jsx_runtime.jsx)(IconChevron, { expanded })
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_rowIdentity",
									children: [
										(0, react_jsx_runtime.jsx)(ProviderIcon, {
											name: def.icon,
											size: 18
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: "s2a_rowName",
											children: title
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: "s2a_rowTag",
											children: endpoint.route.length > 0 ? endpoint.route : "未保存"
										})
									]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_rowActions",
									children: [
										(0, react_jsx_runtime.jsx)("button", {
											className: "s2a_btn",
											disabled: busy.length > 0,
											onClick: () => discover(endpoint.rowId),
											children: busy === `discover-${endpoint.rowId}` ? "…" : "获取模型"
										}),
										(0, react_jsx_runtime.jsx)("button", {
											className: "s2a_btn",
											disabled: busy.length > 0,
											onClick: () => checkUsage(endpoint.rowId),
											children: busy === `usage-${endpoint.rowId}` ? "…" : "查看用量"
										}),
										(0, react_jsx_runtime.jsx)("button", {
											className: "s2a_btn",
											disabled: busy.length > 0 || endpoints.length <= 1,
											title: endpoints.length <= 1 ? "至少保留一个端点" : "删除该端点",
											onClick: () => removeEndpoint(endpoint.rowId),
											children: "删除端点"
										})
									]
								})
							]
						}), expanded && (0, react_jsx_runtime.jsxs)("div", {
							id: detailsId,
							className: "s2a_editor",
							children: [
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 12
									},
									children: [(0, react_jsx_runtime.jsxs)("div", {
										className: "s2a_field",
										style: { flex: 2 },
										children: [(0, react_jsx_runtime.jsx)("label", {
											className: "s2a_fieldLabel",
											children: "名称（可选，决定路由名）"
										}), (0, react_jsx_runtime.jsx)("input", {
											className: "s2a_input",
											value: endpoint.name,
											placeholder: def.label,
											"aria-label": `${title} 名称`,
											onChange: (event) => updateEndpoint(endpoint.rowId, { name: event.target.value })
										})]
									}), (0, react_jsx_runtime.jsxs)("div", {
										className: "s2a_field",
										style: { flex: 1 },
										children: [(0, react_jsx_runtime.jsx)("label", {
											className: "s2a_fieldLabel",
											children: "平台"
										}), (0, react_jsx_runtime.jsx)("select", {
											className: "s2a_input",
											value: endpoint.platform,
											"aria-label": `${title} 平台`,
											onChange: (event) => updateEndpoint(endpoint.rowId, { platform: event.target.value }),
											children: PROVIDERS.map((entry) => (0, react_jsx_runtime.jsx)("option", {
												value: entry.key,
												children: entry.label
											}, entry.key))
										})]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_field",
									children: [(0, react_jsx_runtime.jsx)("label", {
										className: "s2a_fieldLabel",
										children: "网关地址（留空用默认地址）"
									}), (0, react_jsx_runtime.jsx)("input", {
										className: "s2a_input",
										value: endpoint.baseURL,
										placeholder: baseURL.trim().length > 0 ? baseURL : "http://localhost:8080",
										"aria-label": `${title} 网关地址`,
										onChange: (event) => updateEndpoint(endpoint.rowId, { baseURL: event.target.value })
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_field",
									children: [(0, react_jsx_runtime.jsxs)("label", {
										className: "s2a_fieldLabel",
										children: [
											title,
											" API Key",
											endpoint.keyConfigured || endpoint.apiKey.length > 0 ? " ✓" : ""
										]
									}), (0, react_jsx_runtime.jsx)("input", {
										className: "s2a_input",
										type: "password",
										value: endpoint.apiKey,
										placeholder: endpoint.keyConfigured ? `${def.placeholder}（已配置，留空保持不变）` : def.placeholder,
										"aria-label": `${title} API Key`,
										onChange: (event) => updateEndpoint(endpoint.rowId, { apiKey: event.target.value })
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_field",
									children: [(0, react_jsx_runtime.jsx)("label", {
										className: "s2a_fieldLabel",
										children: "网关协议（留空用平台默认）"
									}), (0, react_jsx_runtime.jsxs)("select", {
										className: "s2a_input",
										value: endpoint.api,
										"aria-label": `${title} 网关协议`,
										onChange: (event) => updateEndpoint(endpoint.rowId, { api: event.target.value }),
										children: [
											(0, react_jsx_runtime.jsxs)("option", {
												value: "",
												children: [
													"自动（",
													def.label,
													" 默认）"
												]
											}),
											(0, react_jsx_runtime.jsx)("option", {
												value: "openai-responses",
												children: "openai-responses"
											}),
											(0, react_jsx_runtime.jsx)("option", {
												value: "openai-completions",
												children: "openai-completions"
											}),
											(0, react_jsx_runtime.jsx)("option", {
												value: "anthropic-messages",
												children: "anthropic-messages"
											})
										]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_field",
									children: [(0, react_jsx_runtime.jsx)("label", {
										className: "s2a_fieldLabel",
										children: "流空闲超时（毫秒，留空用宿主默认）"
									}), (0, react_jsx_runtime.jsx)("input", {
										className: "s2a_input",
										type: "number",
										min: "1",
										step: "1",
										value: endpoint.streamIdleTimeoutMs,
										placeholder: "默认 300000（5 分钟）",
										"aria-label": `${title} 流空闲超时`,
										onChange: (event) => updateEndpoint(endpoint.rowId, { streamIdleTimeoutMs: event.target.value })
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "s2a_field",
									children: [
										(0, react_jsx_runtime.jsx)("label", {
											className: "s2a_fieldLabel",
											children: "模型列表"
										}),
										(0, react_jsx_runtime.jsxs)("label", {
											className: "s2a_probeToggle",
											children: [(0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												"aria-label": `${title} 自动探测档位`,
												checked: endpoint.autoProbeReasoning,
												onChange: (event) => updateEndpoint(endpoint.rowId, { autoProbeReasoning: event.target.checked })
											}), "自动探测档位"]
										}),
										(0, react_jsx_runtime.jsx)("div", {
											className: "s2a_models",
											children: endpoint.models.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
												className: "s2a_modelEmpty",
												children: "暂无模型"
											}) : endpoint.models.map((row) => {
												const expanded$1 = expandedModels.has(row.rowId);
												const detailsId$1 = `s2a-model-${row.rowId}-details`;
												return (0, react_jsx_runtime.jsxs)("div", {
													className: "s2a_modelItem",
													children: [
														(0, react_jsx_runtime.jsxs)("div", {
															className: "s2a_modelSummary",
															children: [
																(0, react_jsx_runtime.jsx)("div", { children: (0, react_jsx_runtime.jsx)("input", {
																	className: "s2a_input",
																	value: row.id,
																	placeholder: "模型 ID",
																	"aria-label": `${title} 模型 ID`,
																	onChange: (event) => updateModel(endpoint.rowId, row.rowId, { id: event.target.value }),
																	onBlur: () => fillModel(endpoint.rowId, row.rowId)
																}) }),
																(0, react_jsx_runtime.jsx)("div", { children: (0, react_jsx_runtime.jsx)("input", {
																	className: "s2a_input",
																	value: row.name,
																	placeholder: "名称",
																	"aria-label": `${title} 模型名称`,
																	onChange: (event) => updateModel(endpoint.rowId, row.rowId, { name: event.target.value })
																}) }),
																(0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: "s2a_iconBtn s2a_expandBtn",
																	title: expanded$1 ? "收起模型详情" : "展开模型详情",
																	"aria-label": expanded$1 ? `收起 ${row.id || "模型"} 详情` : `展开 ${row.id || "模型"} 详情`,
																	"aria-expanded": expanded$1,
																	"aria-controls": detailsId$1,
																	onClick: () => toggleModel(row.rowId),
																	children: (0, react_jsx_runtime.jsx)(IconChevron, { expanded: expanded$1 })
																}),
																(0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: "s2a_iconBtn s2a_trash",
																	title: "删除模型",
																	"aria-label": `删除 ${row.id || "模型"}`,
																	onClick: () => updateEndpoint(endpoint.rowId, { models: endpoint.models.filter((item) => item.rowId !== row.rowId) }),
																	children: (0, react_jsx_runtime.jsx)(IconTrash, {})
																})
															]
														}),
														(0, react_jsx_runtime.jsx)("div", {
															className: "s2a_probeEntry",
															children: (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "s2a_btn",
																"aria-label": `${title} ${row.id} 探测档位`,
																disabled: busy.length > 0 || !row.id.trim() || ["queued", "running"].includes(probes[row.rowId]?.phase ?? ""),
																onClick: () => startProbes(endpoint, [row], true),
																children: "探测档位"
															})
														}),
														probes[row.rowId] && (0, react_jsx_runtime.jsxs)("div", {
															className: "s2a_probe",
															role: "status",
															"aria-live": "polite",
															children: [
																(0, react_jsx_runtime.jsxs)("span", {
																	className: "s2a_probeStatus",
																	children: [
																		{
																			queued: "排队中",
																			running: "探测中",
																			completed: "探测完成",
																			cancelled: "已取消",
																			expired: "已超时，未知档位保留",
																			unavailable: "探测不可用，档位保留",
																			aborted: "探测中止"
																		}[probes[row.rowId].phase],
																		" · ",
																		probes[row.rowId].requests,
																		"/",
																		probes[row.rowId].maxRequests,
																		" 次请求",
																		probes[row.rowId].phase === "aborted" ? ` · 原因：${PROBE_REASONS[probes[row.rowId].abortReason ?? ""] ?? "原因未知"}` : "",
																		["queued", "running"].includes(probes[row.rowId].phase) ? ` · 预计 ${Math.ceil(probes[row.rowId].estimateMs / 1e3)} 秒` : ""
																	]
																}),
																["queued", "running"].includes(probes[row.rowId].phase) && (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: "s2a_btn",
																	"aria-label": `${title} ${row.id} 取消探测`,
																	onClick: () => cancelProbe(row.rowId),
																	children: "取消"
																}),
																probes[row.rowId].phase === "completed" && hasThinkingSuggestion(probes[row.rowId].suggestion) && (row.fromSaved || row.reasoningEdited || row.reasoning === "off") && (0, react_jsx_runtime.jsx)("button", {
																	type: "button",
																	className: "s2a_btn",
																	"aria-label": `${title} ${row.id} 应用探测建议`,
																	onClick: () => applyProbe(endpoint.rowId, row.rowId),
																	children: "应用建议"
																}),
																(0, react_jsx_runtime.jsx)("span", {
																	className: "s2a_probeLevels",
																	children: probes[row.rowId].levels.map((level) => (0, react_jsx_runtime.jsxs)("span", {
																		title: PROBE_REASONS[level.reason] ?? "未知，保留",
																		children: [
																			level.level,
																			": ",
																			{
																				accepted: "参数已接受",
																				unsupported: "已确认不支持",
																				unknown: "未知，保留"
																			}[level.state]
																		]
																	}, level.level))
																})
															]
														}),
														expanded$1 && (0, react_jsx_runtime.jsxs)("div", {
															id: detailsId$1,
															className: "s2a_modelDetails",
															children: [
																(0, react_jsx_runtime.jsxs)("div", {
																	className: "s2a_field",
																	children: [(0, react_jsx_runtime.jsx)("label", {
																		className: "s2a_fieldLabel",
																		children: "上下文窗口"
																	}), (0, react_jsx_runtime.jsx)("input", {
																		className: "s2a_input",
																		type: "number",
																		min: "1",
																		step: "1",
																		value: row.contextWindow,
																		placeholder: "自动填充",
																		"aria-label": `${title} 上下文窗口`,
																		onChange: (event) => updateModel(endpoint.rowId, row.rowId, { contextWindow: event.target.value })
																	})]
																}),
																(0, react_jsx_runtime.jsxs)("div", {
																	className: "s2a_field",
																	children: [(0, react_jsx_runtime.jsx)("label", {
																		className: "s2a_fieldLabel",
																		children: "最大输出 token"
																	}), (0, react_jsx_runtime.jsx)("input", {
																		className: "s2a_input",
																		type: "number",
																		min: "1",
																		step: "1",
																		value: row.maxTokens,
																		placeholder: "自动填充",
																		"aria-label": `${title} 最大输出 token`,
																		onChange: (event) => updateModel(endpoint.rowId, row.rowId, { maxTokens: event.target.value })
																	})]
																}),
																(0, react_jsx_runtime.jsxs)("div", {
																	className: "s2a_field",
																	children: [(0, react_jsx_runtime.jsx)("label", {
																		className: "s2a_fieldLabel",
																		children: "图片输入"
																	}), (0, react_jsx_runtime.jsxs)("select", {
																		className: "s2a_input",
																		"aria-label": `${title} ${row.id} 图片输入`,
																		value: row.input,
																		onChange: (event) => updateModel(endpoint.rowId, row.rowId, {
																			input: event.target.value,
																			inputEdited: true
																		}),
																		children: [
																			(0, react_jsx_runtime.jsx)("option", {
																				value: "",
																				children: "自动（按模型推断）"
																			}),
																			(0, react_jsx_runtime.jsx)("option", {
																				value: "text",
																				children: "仅文本"
																			}),
																			(0, react_jsx_runtime.jsx)("option", {
																				value: "text-image",
																				children: "文本 + 图片"
																			})
																		]
																	})]
																}),
																(0, react_jsx_runtime.jsxs)("div", {
																	className: "s2a_field s2a_reasoningField",
																	children: [
																		(0, react_jsx_runtime.jsx)("label", {
																			className: "s2a_fieldLabel",
																			children: "思考强度"
																		}),
																		(0, react_jsx_runtime.jsxs)("select", {
																			className: "s2a_input",
																			"aria-label": `${title} ${row.id} 思考模式`,
																			value: row.reasoning,
																			onChange: (event) => updateModel(endpoint.rowId, row.rowId, {
																				reasoning: event.target.value,
																				reasoningEdited: true
																			}),
																			children: [
																				(0, react_jsx_runtime.jsx)("option", {
																					value: "",
																					children: "自动"
																				}),
																				(0, react_jsx_runtime.jsx)("option", {
																					value: "off",
																					children: "不支持"
																				}),
																				(0, react_jsx_runtime.jsx)("option", {
																					value: "on",
																					children: "手动输入档位"
																				})
																			]
																		}),
																		row.reasoning === "on" && (0, react_jsx_runtime.jsx)("input", {
																			className: "s2a_input",
																			value: row.effortLevels,
																			"aria-label": `${title} ${row.id} 思考强度档位`,
																			placeholder: "例如 none, low, high, max",
																			onChange: (event) => updateModel(endpoint.rowId, row.rowId, {
																				effortLevels: event.target.value,
																				reasoningEdited: true
																			})
																		}),
																		(0, react_jsx_runtime.jsx)("span", {
																			className: "s2a_modelSource",
																			children: "多个档位用逗号分隔。手动设置不会被补全数据覆盖。"
																		})
																	]
																})
															]
														})
													]
												}, row.rowId);
											})
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: "s2a_modelFooter",
											children: [(0, react_jsx_runtime.jsxs)("span", {
												className: "s2a_modelSource",
												children: [
													"默认值来自 ",
													(0, react_jsx_runtime.jsx)("a", {
														href: "https://models.dev/",
														target: "_blank",
														rel: "noreferrer",
														children: "models.dev"
													}),
													"，未匹配时可手动填写"
												]
											}), (0, react_jsx_runtime.jsxs)("div", {
												className: "s2a_modelActions",
												children: [(0, react_jsx_runtime.jsx)("button", {
													className: "s2a_btn",
													disabled: busy.length > 0 || endpoint.models.length === 0,
													onClick: () => fillProvider(endpoint.rowId),
													children: busy === `metadata-${endpoint.rowId}` ? "…" : "补全数据"
												}), (0, react_jsx_runtime.jsx)("button", {
													className: "s2a_btn",
													disabled: busy.length > 0,
													onClick: () => updateEndpoint(endpoint.rowId, { models: [...endpoint.models, modelRow()] }),
													children: "添加模型"
												})]
											})]
										})
									]
								})
							]
						})]
					}, endpoint.rowId);
				})
			}),
			(0, react_jsx_runtime.jsxs)("div", {
				className: "s2a_actions",
				children: [
					(0, react_jsx_runtime.jsx)("button", {
						className: "s2a_btn",
						disabled: busy.length > 0,
						onClick: addEndpoint,
						children: "添加端点"
					}),
					(0, react_jsx_runtime.jsx)("button", {
						className: "s2a_primary",
						disabled: busy.length > 0,
						onClick: save,
						children: busy === "save" ? "保存中…" : "保存配置"
					}),
					(0, react_jsx_runtime.jsx)("button", {
						className: "s2a_btn",
						disabled: busy.length > 0,
						onClick: checkStatus,
						children: busy === "status" ? "…" : "查看状态"
					})
				]
			}),
			(message || error) && (0, react_jsx_runtime.jsxs)("div", {
				className: "s2a_toast",
				role: "status",
				"aria-live": "polite",
				children: [(0, react_jsx_runtime.jsx)("p", {
					className: `s2a_status ${error ? "s2a_statusErr" : "s2a_statusOk"}`,
					children: error || message
				}), (0, react_jsx_runtime.jsx)("button", {
					className: "s2a_iconBtn",
					"aria-label": "关闭提示",
					onClick: () => {
						setMessage("");
						setError("");
					},
					children: "×"
				})]
			})
		]
	});
}

//#endregion
//#region src/client/toolview.tsx
const ROOT = {
	display: "grid",
	gap: "8px",
	padding: "8px 10px"
};
const IMAGE = {
	maxWidth: "100%",
	maxHeight: 420,
	objectFit: "contain",
	borderRadius: 8,
	background: "var(--dsw-alias-bg-module-platform, #f2f2f2)"
};
const META = {
	fontSize: 11,
	lineHeight: 1.5,
	color: "var(--dsw-alias-label-secondary, #6b6b6b)",
	whiteSpace: "pre-wrap",
	wordBreak: "break-word"
};
/** Attachment-served URL for one image content block. */
function attachmentUrl(image) {
	const ref = JSON.stringify(image.attachment);
	return `/plugins/dsh-sub2api/attachment?ref=${encodeURIComponent(btoa(ref))}`;
}
function GenerateImageToolview(props) {
	const { block } = props;
	const content = "content" in block ? block.content : [];
	const image = content.find((b) => b.type === "image" && b.attachment !== undefined);
	const text = content.find((b) => b.type === "text");
	if (image === undefined && text === undefined) return (0, react_jsx_runtime.jsx)("div", {
		style: {
			...META,
			padding: "8px 10px"
		},
		children: "生成图片…"
	});
	return (0, react_jsx_runtime.jsxs)("div", {
		style: ROOT,
		children: [image !== undefined && (0, react_jsx_runtime.jsx)("img", {
			src: attachmentUrl(image),
			alt: image.attachment.name ?? "generated image",
			style: IMAGE
		}), text !== undefined && (0, react_jsx_runtime.jsx)("div", {
			style: META,
			children: text.text
		})]
	});
}

//#endregion
//#region src/client/index.tsx
const name = "dsh-sub2api-client";
const inject = ["slots"];
function apply(ctx) {
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "sub2api-models",
		order: 12,
		label: () => "Sub2API 模型"
	}, Sub2ApiSettings));
	ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: "generate_image"
	}, GenerateImageToolview));
}

//#endregion
exports.apply = apply
exports.inject = inject
exports.name = name
		return module.exports;
	}
});
