/**
 * Settings section for dsh-sub2api.
 *
 * An addable list of independently-keyed endpoints: every row carries its own
 * gateway host, its own API key and its own model catalog, so one sub2api
 * gateway can serve several groups at once. The key's group decides the
 * platform (OpenAI / Claude / Grok) and therefore the wire protocol and the
 * model list. Keys are written to the harness credential store through the host
 * HTTP bridge; hosts and model catalogs land in the `llm-sub2api:` settings
 * section.
 *
 * @module dsh-sub2api/client/settings
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ProviderIcon } from './icons.tsx'
import type { ProviderIconName } from './icons.tsx'

const BASE = '/plugins/dsh-sub2api'
const MODELS_DEV_API = 'https://models.dev/api.json'

/** Model-row controls matching the official Models page. */
function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3.5 5.25h13M8 5.25V3.5h4v1.75M5.25 5.25l.8 10.1c.05.65.6 1.15 1.25 1.15h5.4c.65 0 1.2-.5 1.25-1.15l.8-10.1M8.25 8v5.75M11.75 8v5.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="m7.5 4.75 5.25 5.25-5.25 5.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface ProviderDefinition {
  key: string
  label: string
  icon: ProviderIconName
  placeholder: string
  modelsDevProvider: string
}

const PROVIDERS: ProviderDefinition[] = [
  { key: 'openai', label: 'OpenAI', icon: 'openai', placeholder: 'sk-…', modelsDevProvider: 'openai' },
  { key: 'claude', label: 'Claude', icon: 'claude', placeholder: 'sk-ant-…', modelsDevProvider: 'anthropic' },
  { key: 'grok', label: 'Grok', icon: 'grok', placeholder: 'xai-…', modelsDevProvider: 'xai' },
]

type ProviderKey = 'openai' | 'claude' | 'grok'

function providerDefinition(key: string): ProviderDefinition {
  return PROVIDERS.find((def) => def.key === key) ?? PROVIDERS[0]!
}

/**
 * One settings-page row: a gateway host plus one key. The server derives the
 * route id from the platform and the optional name, so `route` stays empty for
 * a row that has not been saved yet.
 */
interface EndpointState {
  rowId: number
  name: string
  baseURL: string
  platform: ProviderKey
  /** Freshly typed key; write-only, never echoed back by the server. */
  apiKey: string
  /** Credential reference already stored for this row (echoed back so a rename keeps the key). */
  apiKeyEnv: string
  keyConfigured: boolean
  /** Wire-protocol override; empty means the platform's native protocol. */
  api: string
  models: ModelRow[]
  /** Route id the server resolved for this row ('' until saved). */
  route: string
  autoProbeReasoning: boolean
}

const CSS_ID = 'dsh-sub2api/settings.css'

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
`

function ensureCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-sub2api'
  tag.dataset.pluginCss = CSS_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

interface CatalogModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Array<'text' | 'image'>
  reasoningEfforts?: string[]
}

interface ModelRow {
  rowId: number
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  /** '' = 自动（按模型 ID 推断）; 'text' = 仅文本; 'text-image' = 文本 + 图片 */
  input: string
  /** '' = 自动（未设置，按路由默认）; 'on' = 支持（档位见 effortLevels）; 'off' = 不支持 */
  reasoning: string
  /** 该模型实际支持的推理档位（reasoning === 'on' 时保存到配置） */
  effortLevels: string
  inputEdited?: boolean
  reasoningEdited?: boolean
  fromSaved?: boolean
}

interface ProbeState {
  id: string
  phase: 'queued' | 'running' | 'completed' | 'cancelled' | 'expired' | 'unavailable'
  requests: number
  maxRequests: number
  minGapMs: number
  estimateMs: number
  levels: Array<{level: string; state: 'accepted' | 'unsupported' | 'unknown'; reason: string}>
  suggestion: string[]
}
interface ProbeRun { endpoint: number; row: number; signature: string; id?: string; cancelled: boolean; controller: AbortController; timer?: number; deadlineTimer?: number; wake?: () => void; launch?: () => Promise<void>; cancelRequest?: Promise<void> }
const PROBE_REASONS: Record<string, string> = {'accepted-parameter': '参数已接受，不证明思考生效', 'confirmed-rejection': '重复明确拒绝，且对照成功', 'unconfirmed-rejection': '拒绝未重复确认', 'no-control': '无成功对照', 'parameter-not-exact': '参数被转换或未发送', 'budget-limited': '预算或输出上限不足', 'rate-limited': '限流暂停', 'auth-or-quota': '认证或额度问题', 'upstream-error': '上游失败', 'ambiguous-error': '原因不明确', 'invalid-stream': '响应未完整确认', 'timeout': '超时', 'cancelled': '已取消', 'sdk-unavailable': 'SDK 不可用', 'queued': '待探测'}

function hasThinkingSuggestion(suggestion: readonly string[]): boolean {
  // An off/none-only map is not a valid thinking capability list for the host.
  return suggestion.some(level => level !== 'off' && level !== 'none')
}

function probeCandidates(row: ModelRow): string[] {
  if (row.reasoning === 'off') return []
  return row.reasoning === 'on' && row.effortLevels.trim() ? [...new Set(row.effortLevels.split(/[,，\s]+/).filter(Boolean))] : [...DEFAULT_REASONING_LEVELS]
}

function probeSignature(endpoint: EndpointState, row: ModelRow, baseURL: string): string {
  return JSON.stringify([endpoint.baseURL.trim() || baseURL.trim(), endpoint.apiKey, endpoint.apiKeyEnv, endpoint.platform, endpoint.api, endpoint.autoProbeReasoning, row.id, row.contextWindow, row.maxTokens, row.input, row.reasoning, row.effortLevels, row.reasoningEdited, row.fromSaved])
}

const DEFAULT_REASONING_LEVELS = ['low', 'medium', 'high']

interface ImageToolModelRef {
  provider: string
  model: string
}

interface ImageToolsState {
  generate: ImageToolModelRef
}

interface ConfigPayloadEndpoint {
  name: string
  baseURL: string
  platform: string
  apiKeyEnv?: string
  keyConfigured: boolean
  api?: string
  models: Array<CatalogModel | string>
  route: string
}

interface ConfigState {
  baseURL: string
  catalogFormat?: 'structured-v1'
  providers?: Record<string, { keyConfigured: boolean; models: Array<CatalogModel | string> }>
  endpoints?: ConfigPayloadEndpoint[]
  tools?: {
    generate?: ImageToolModelRef
  }
}

interface ModelsDevModel {
  id?: string
  name?: string
  /** Whether the model accepts image input (models.dev `attachment`). */
  attachment?: boolean
  /** Explicit modality list when the entry carries one. */
  modalities?: { input?: string[] }
  reasoning?: boolean
  /** models.dev JSON key is `reasoning_options` (snake_case). */
  reasoning_options?: Array<{ type?: string; values?: string[] }>
  limit?: { context?: number; output?: number }
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>
}

type ModelsDevCatalog = Record<string, ModelsDevProvider>

let nextRowId = 1
let modelsDevRequest: Promise<ModelsDevCatalog> | undefined

function modelRow(model: CatalogModel | string = { id: '' }): ModelRow {
  if (typeof model === 'string') {
    const [id = '', name = '', contextWindow = ''] = model.split('|')
    return { rowId: nextRowId++, id: id.trim(), name: name.trim(), contextWindow: contextWindow.trim(), maxTokens: '', input: '', reasoning: '', effortLevels: '' }
  }
  const reasoningEfforts = model.reasoningEfforts
  return {
    rowId: nextRowId++,
    id: model.id,
    name: model.name ?? '',
    contextWindow: model.contextWindow !== undefined ? String(model.contextWindow) : '',
    maxTokens: model.maxTokens !== undefined ? String(model.maxTokens) : '',
    input: model.input === undefined || model.input.length === 0 ? '' : model.input.includes('image') ? 'text-image' : 'text',
    reasoning: reasoningEfforts === undefined ? '' : reasoningEfforts.length === 0 ? 'off' : 'on',
    effortLevels: reasoningEfforts !== undefined && reasoningEfforts.length > 0 ? reasoningEfforts.join(', ') : '',
  }
}

function loadModelsDev(): Promise<ModelsDevCatalog> {
  modelsDevRequest ??= fetch(MODELS_DEV_API)
    .then(async (response) => {
      if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`)
      return await response.json() as ModelsDevCatalog
    })
    .catch((error) => {
      modelsDevRequest = undefined
      throw error
    })
  return modelsDevRequest
}

function canonicalModelsDevProvider(id: string): string | undefined {
  const normalized = id.toLowerCase()
  if (/^(gpt|o[134]|codex)/.test(normalized)) return 'openai'
  if (normalized.startsWith('claude')) return 'anthropic'
  if (normalized.startsWith('grok')) return 'xai'
  if (normalized.startsWith('gemini')) return 'google'
  if (normalized.startsWith('deepseek')) return 'deepseek'
  return undefined
}

function officialModel(catalog: ModelsDevCatalog, def: ProviderDefinition, id: string): ModelsDevModel | undefined {
  const preferredProviders = [canonicalModelsDevProvider(id), def.modelsDevProvider].filter((provider, index, all): provider is string => (
    provider !== undefined && all.indexOf(provider) === index
  ))
  for (const provider of preferredProviders) {
    const models = catalog[provider]?.models
    const match = models?.[id] ?? (models !== undefined ? Object.values(models).find((model) => model.id === id) : undefined)
    if (match !== undefined) return match
  }
  for (const provider of Object.values(catalog)) {
    const models = provider.models
    const match = models?.[id] ?? (models !== undefined ? Object.values(models).find((model) => model.id === id) : undefined)
    if (match !== undefined) return match
  }
  return undefined
}

/** The concrete reasoning-effort levels a model advertises, or undefined. */
function officialEffortValues(official: ModelsDevModel): string[] | undefined {
  const effort = official.reasoning_options?.find((option) => option.type === 'effort')
  const values = effort?.values
  if (values === undefined || values.length === 0) return undefined
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/**
 * Image-input modality derived from models.dev: an explicit modality list
 * wins, then the `attachment` flag. Absent means the entry says nothing, and
 * the row keeps "auto" (the adapter infers from the model id).
 */
function officialInput(official: ModelsDevModel): 'text' | 'text-image' | undefined {
  const input = official.modalities?.input
  if (Array.isArray(input) && input.includes('image')) return 'text-image'
  if (typeof official.attachment === 'boolean') return official.attachment ? 'text-image' : 'text'
  return undefined
}

function applyOfficialDefaults(rows: ModelRow[], def: ProviderDefinition, catalog: ModelsDevCatalog): { rows: ModelRow[]; filled: number } {
  let filled = 0
  const next = rows.map((row) => {
    const official = officialModel(catalog, def, row.id.trim())
    if (official === undefined) return row
    const name = row.name.trim().length === 0 && typeof official.name === 'string' ? official.name : row.name
    const officialContext = official.limit?.context
    const contextWindow = row.contextWindow.length === 0 && Number.isSafeInteger(officialContext) && (officialContext ?? 0) > 0
      ? String(officialContext)
      : row.contextWindow
    const officialOutput = official.limit?.output
    const maxTokens = row.maxTokens.length === 0 && Number.isSafeInteger(officialOutput) && (officialOutput ?? 0) > 0
      ? String(officialOutput)
      : row.maxTokens
    // 图片输入：models.dev 有数据就自动定，用户不用选
    const input = !row.inputEdited && row.input.length === 0 && officialInput(official) !== undefined ? officialInput(official)! : row.input
    const officialEfforts = officialEffortValues(official)
    let reasoning = row.reasoning
    let effortLevels = row.effortLevels
    if (!row.reasoningEdited && reasoning.length === 0) {
      if (officialEfforts !== undefined && officialEfforts.length > 0) {
        reasoning = 'on'
        effortLevels = officialEfforts.join(', ')
      } else if (typeof official.reasoning === 'boolean') {
        reasoning = official.reasoning ? 'on' : 'off'
        effortLevels = official.reasoning ? DEFAULT_REASONING_LEVELS.join(', ') : ''
      }
    }
    if (
      name !== row.name || contextWindow !== row.contextWindow || maxTokens !== row.maxTokens
      || input !== row.input
      || reasoning !== row.reasoning || effortLevels !== row.effortLevels
    ) filled++
    return { ...row, name, contextWindow, maxTokens, input, reasoning, effortLevels }
  })
  return { rows: next, filled }
}

class ProbeCapacityError extends Error {}

async function api<T>(path: string, init?: RequestInit, capacityWait = false): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    if (capacityWait && response.status === 429) throw new ProbeCapacityError('probe task limit')
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

function endpointRow(platform: ProviderKey = 'openai'): EndpointState {
  return {
    rowId: nextRowId++,
    name: '',
    baseURL: '',
    platform,
    apiKey: '',
    apiKeyEnv: '',
    keyConfigured: false,
    api: '',
    models: [],
    route: '',
    autoProbeReasoning: false,
  }
}

function endpointRowFrom(value: ConfigPayloadEndpoint): EndpointState {
  const platform = (PROVIDERS.some((def) => def.key === value.platform) ? value.platform : 'openai') as ProviderKey
  return {
    rowId: nextRowId++,
    name: typeof value.name === 'string' ? value.name : '',
    baseURL: typeof value.baseURL === 'string' ? value.baseURL : '',
    platform,
    apiKey: '',
    apiKeyEnv: typeof value.apiKeyEnv === 'string' ? value.apiKeyEnv : '',
    keyConfigured: value.keyConfigured === true,
    api: typeof value.api === 'string' ? value.api : '',
    models: (value.models ?? []).map((model) => ({...modelRow(model), fromSaved: true})),
    route: typeof value.route === 'string' ? value.route : '',
    autoProbeReasoning: false,
  }
}

function emptyToolRef(): ImageToolModelRef {
  return { provider: '', model: '' }
}

function emptyTools(): ImageToolsState {
  return { generate: emptyToolRef() }
}

/**
 * The stored ref names either an endpoint's route id (`sub2api-openai-gw2`) or,
 * for sections written before endpoints existed, a bare platform key.
 */
function toolRefFromConfig(value: ImageToolModelRef | undefined): ImageToolModelRef {
  const provider = typeof value?.provider === 'string' ? value.provider : ''
  const model = typeof value?.model === 'string' ? value.model : ''
  const known = PROVIDERS.some((def) => def.key === provider) || provider.startsWith('sub2api-')
  return known ? { provider, model } : { provider: '', model: '' }
}

function toolOptions(endpoints: readonly EndpointState[]): Array<{ value: string; label: string; provider: string; model: string }> {
  const options: Array<{ value: string; label: string; provider: string; model: string }> = []
  for (const endpoint of endpoints) {
    // A row that has never been saved has no route yet, so the chat bridge
    // cannot name its models. Saving first makes them selectable here.
    if (endpoint.route.length === 0) continue
    const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : providerDefinition(endpoint.platform).label
    for (const row of endpoint.models) {
      const id = row.id.trim()
      if (id.length === 0) continue
      const name = row.name.trim()
      options.push({
        value: `${endpoint.route}:${id}`,
        label: `${title} / ${name.length > 0 ? `${name} (${id})` : id}`,
        provider: endpoint.route,
        model: id,
      })
    }
  }
  return options
}

function serializeToolRef(ref: ImageToolModelRef): ImageToolModelRef | undefined {
  const provider = ref.provider.trim()
  const model = ref.model.trim()
  if (provider.length === 0 || model.length === 0) return undefined
  return { provider, model }
}

/**
 * Validate one row's model catalog and drop everything the section schema would
 * not accept. `title` is the row's display name, so an error names the row it
 * came from instead of a platform the user cannot see on screen any more.
 */
function serializeModels(rows: readonly ModelRow[], title: string): CatalogModel[] {
  const nonEmptyRows = rows.filter((row) =>
    row.id.trim().length > 0 || row.name.trim().length > 0 || row.contextWindow.length > 0 || row.maxTokens.length > 0 || row.reasoning.length > 0)
  const seen = new Set<string>()
  return nonEmptyRows.map((row) => {
    const id = row.id.trim()
    if (id.length === 0) throw new Error(`${title} 存在未填写 ID 的模型`)
    if (seen.has(id)) throw new Error(`${title} 模型 ID 重复：${id}`)
    seen.add(id)
    const name = row.name.trim()
    const contextWindow = row.contextWindow.length > 0 ? Number(row.contextWindow) : undefined
    if (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow < 1)) {
      throw new Error(`${title} ${id} 的 Context Window 必须是正整数`)
    }
    const maxTokens = row.maxTokens.trim().length > 0 ? Number(row.maxTokens) : undefined
    if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) {
      throw new Error(`${title} ${id} 的 Max Tokens 必须是正整数`)
    }
    const reasoningEfforts = row.reasoning === 'off' ? [] : row.reasoning === 'on'
      ? [...new Set(row.effortLevels.split(/[,，/\s]+/).filter(Boolean))]
      : undefined
    if (row.reasoning === 'on' && !reasoningEfforts?.length) throw new Error(`${title} ${id} 请填写至少一个思考强度`)
    if (reasoningEfforts?.some(level => !['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level))) throw new Error(`${title} ${id} 思考强度支持 none、off、minimal、low、medium、high、xhigh、max`)
    const input: Array<'text' | 'image'> | undefined = row.input === 'text-image'
      ? ['text', 'image']
      : row.input === 'text'
        ? ['text']
        : undefined
    return {
      id,
      ...(name.length > 0 ? { name } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(input !== undefined ? { input } : {}),
      ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
    }
  })
}

export function Sub2ApiSettings() {
  const sectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    // DSH's settings scroller has bottom padding; extend the opaque footer
    // through that inset so scrolling rows cannot peek out underneath it.
    let scroller = section.parentElement
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (!scroller) return
    const update = () => section.style.setProperty('--s2a-footer-inset', getComputedStyle(scroller).paddingBottom)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])
  const [baseURL, setBaseURL] = useState('')
  const [endpoints, setEndpointState] = useState<EndpointState[]>([])
  const endpointsRef = useRef<EndpointState[]>([])
  const setEndpoints = useCallback((next: EndpointState[] | ((current: EndpointState[]) => EndpointState[])) => {
    const value = typeof next === 'function' ? next(endpointsRef.current) : next
    endpointsRef.current = value
    setEndpointState(value)
  }, [])
  const [probes, setProbes] = useState<Record<number, ProbeState>>({})
  const liveProbes = useRef(new Map<number, ProbeRun>())
  const pendingProbes = useRef<ProbeRun[]>([])
  const submittedProbes = useRef(new Set<ProbeRun>())
  const revisions = useRef(new Map<number, number>())
  const mounted = useRef(true)
  const baseRef = useRef(baseURL)
  baseRef.current = baseURL
  const current = (run: ProbeRun) => {
    const entry = endpointsRef.current.find(item => item.rowId === run.endpoint)
    const model = entry?.models.find(item => item.rowId === run.row)
    return mounted.current && !run.cancelled && liveProbes.current.get(run.row) === run && entry !== undefined && model !== undefined && probeSignature(entry, model, baseRef.current) === run.signature
  }
  const waitForProbe = (run: ProbeRun, delay: number) => new Promise<void>(resolve => {
    if (run.cancelled) {resolve(); return}
    run.wake = resolve
    run.timer = window.setTimeout(() => {run.timer = undefined; run.wake = undefined; resolve()}, delay)
  })
  const releaseRun = (run: ProbeRun) => {
    if (run.deadlineTimer !== undefined) window.clearTimeout(run.deadlineTimer)
    if (liveProbes.current.get(run.row) === run) liveProbes.current.delete(run.row)
    if (submittedProbes.current.delete(run)) drainProbeQueue()
  }
  const cancelRun = (run: ProbeRun) => {
    run.cancelled = true; run.controller.abort()
    if (run.timer !== undefined) window.clearTimeout(run.timer)
    if (run.deadlineTimer !== undefined) window.clearTimeout(run.deadlineTimer)
    run.wake?.(); run.wake = undefined
    pendingProbes.current = pendingProbes.current.filter(entry => entry !== run)
    if (run.id && !run.cancelRequest) {
      run.cancelRequest = api(`${BASE}/reasoning/cancel`, {method: 'POST', body: JSON.stringify({id: run.id})}).then(() => {releaseRun(run)}).catch(() => {})
    }
  }
  const drainProbeQueue = () => {
    if (!mounted.current) return
    while (submittedProbes.current.size < 8 && pendingProbes.current.length > 0) {
      const run = pendingProbes.current.shift()!
      if (!current(run)) {
        const stale = liveProbes.current.get(run.row) === run
        cancelRun(run)
        if (stale) {liveProbes.current.delete(run.row); setProbes(previous => previous[run.row] ? {...previous, [run.row]: {...previous[run.row]!, phase: 'cancelled'}} : previous)}
        continue
      }
      submittedProbes.current.add(run)
      // A slot remains occupied through a late acknowledgement and its cancellation.
      void run.launch!().finally(async () => {await run.cancelRequest; releaseRun(run)})
    }
  }
  const invalidateEndpoint = (id: number) => {
    revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
    for (const [row, run] of liveProbes.current) if (run.endpoint === id) {cancelRun(run); liveProbes.current.delete(row)}
    setProbes(previous => Object.fromEntries(Object.entries(previous).filter(([row]) => !endpointsRef.current.find(endpoint => endpoint.rowId === id)?.models.some(model => model.rowId === Number(row)))))
  }
  const cancelProbe = (row: number) => {
    const run = liveProbes.current.get(row)
    if (run) {cancelRun(run); liveProbes.current.delete(row)}
    setProbes(previous => previous[row] ? {...previous, [row]: {...previous[row]!, phase: 'cancelled'}} : previous)
  }
  useEffect(() => {
    mounted.current = true
    return () => {mounted.current = false; for (const run of liveProbes.current.values()) cancelRun(run); liveProbes.current.clear()}
  }, [])
  const [tools, setTools] = useState<ImageToolsState>(emptyTools())
  const [structuredConfig, setStructuredConfig] = useState(false)
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<number>>(() => new Set())
  const [expandedModels, setExpandedModels] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!message && !error) return
    const timer = window.setTimeout(() => { setMessage(''); setError('') }, error ? 10000 : 6000)
    return () => window.clearTimeout(timer)
  }, [message, error])

  useEffect(() => {
    ensureCss()
    api<ConfigState>(`${BASE}/config`)
      .then(async (cfg) => {
        setBaseURL(cfg.baseURL ?? '')
        setStructuredConfig(cfg.catalogFormat === 'structured-v1')
        setEndpoints((cfg.endpoints ?? []).map(endpointRowFrom))
        setTools({
          generate: toolRefFromConfig(cfg.tools?.generate),
        })
        try {
          const catalog = await loadModelsDev()
          setEndpoints((current) => current.map((endpoint) => ({
            ...endpoint,
            models: applyOfficialDefaults(endpoint.models, providerDefinition(endpoint.platform), catalog).rows,
          })))
        } catch {
          // The form remains fully editable when the optional public catalog is unavailable.
        }
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [])

  const updateEndpoint = useCallback((rowId: number, patch: Partial<EndpointState>) => {
    invalidateEndpoint(rowId)
    setEndpoints((previous) => previous.map((endpoint) => endpoint.rowId === rowId ? { ...endpoint, ...patch } : endpoint))
  }, [])

  const updateModel = (endpointRowId: number, rowId: number, patch: Partial<ModelRow>) => {
    invalidateEndpoint(endpointRowId)
    setEndpoints((previous) => previous.map((endpoint) => endpoint.rowId === endpointRowId
      ? { ...endpoint, models: endpoint.models.map((row) => row.rowId === rowId ? { ...row, ...patch } : row) }
      : endpoint))
  }

  const toggleEndpoint = (rowId: number) => {
    setExpandedEndpoints((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const startProbes = (endpoint: EndpointState, rows = endpoint.models, manual = false) => {
    if ((!endpoint.autoProbeReasoning && !manual) || !mounted.current) return
    for (const row of rows) {
      const candidates = manual && row.reasoning === 'off' ? [...DEFAULT_REASONING_LEVELS] : probeCandidates(row)
      if (!row.id.trim() || !candidates.length) continue
      const old = liveProbes.current.get(row.rowId)
      if (old) cancelRun(old)
      const run: ProbeRun = {endpoint: endpoint.rowId, row: row.rowId, signature: probeSignature(endpoint, row, baseRef.current), cancelled: false, controller: new AbortController()}
      liveProbes.current.set(row.rowId, run)
      const initial: ProbeState = {id: '', phase: 'queued', requests: 0, maxRequests: 1 + 3 * candidates.length, minGapMs: 5000, estimateMs: (1 + 3 * candidates.length) * 5000, levels: candidates.map(level => ({level, state: 'unknown', reason: 'queued'})), suggestion: candidates}
      setProbes(previous => ({...previous, [row.rowId]: initial}))
      run.deadlineTimer = window.setTimeout(() => {
        const active = current(run)
        cancelRun(run)
        if (liveProbes.current.get(run.row) === run) liveProbes.current.delete(run.row)
        if (active) setProbes(previous => ({...previous, [row.rowId]: {...(previous[row.rowId] ?? initial), phase: 'expired'}}))
      }, 600000)
      run.launch = async () => {
        try {
          // Do not abort the start acknowledgement: a late task id must still be cancelled.
          let receipt: ProbeState | undefined
          for (let attempt = 0; attempt < 12 && current(run); attempt++) {
            try {
              receipt = await api<ProbeState>(`${BASE}/reasoning/start`, {method: 'POST', body: JSON.stringify({endpoint: {baseURL: endpoint.baseURL.trim() || baseRef.current.trim(), platform: endpoint.platform, api: endpoint.api || (endpoint.platform === 'claude' ? 'anthropic-messages' : endpoint.platform === 'grok' ? 'openai-completions' : 'openai-responses'), apiKey: endpoint.apiKey, apiKeyEnv: endpoint.apiKeyEnv}, model: {id: row.id.trim(), ...(row.contextWindow.trim() ? {contextWindow: Number(row.contextWindow)} : {}), ...(row.maxTokens.trim() ? {maxTokens: Number(row.maxTokens)} : {})}, candidates})}, true)
              break
            } catch (e) {
              if (!(e instanceof ProbeCapacityError) || attempt === 11) throw e
              if (!current(run)) return
              await waitForProbe(run, Math.min(1000 * 2 ** attempt, 30000))
            }
          }
          if (!receipt) return
          run.id = receipt.id
          if (!current(run)) {cancelRun(run); return}
          setProbes(previous => ({...previous, [row.rowId]: {...initial, ...receipt, levels: receipt.levels ?? initial.levels, suggestion: receipt.suggestion ?? initial.suggestion}}))
          for (;;) {
            const status = await api<ProbeState>(`${BASE}/reasoning/status`, {method: 'POST', body: JSON.stringify({id: run.id}), signal: run.controller.signal})
            if (!current(run)) {cancelRun(run); return}
            setProbes(previous => ({...previous, [row.rowId]: {...initial, ...status, levels: status.levels ?? initial.levels, suggestion: status.suggestion ?? initial.suggestion}}))
            if (!['queued', 'running'].includes(status.phase)) {
              if (status.phase === 'completed' && hasThinkingSuggestion(status.suggestion) && !row.fromSaved && !row.reasoningEdited && row.reasoning !== 'off') {
                setEndpoints(previous => previous.map(entry => entry.rowId === run.endpoint ? {...entry, models: entry.models.map(model => model.rowId === run.row ? {...model, reasoning: 'on', effortLevels: status.suggestion.join(', ')} : model)} : entry))
              }
              break
            }
            await waitForProbe(run, 1000)
            if (!current(run)) return
          }
        } catch {
          if (current(run)) {setProbes(previous => ({...previous, [row.rowId]: {...initial, phase: 'unavailable'}})); cancelRun(run)}
        }
      }
      pendingProbes.current.push(run)
    }
    drainProbeQueue()
  }

  const applyProbe = (endpointRowId: number, rowId: number) => {
    const suggestion = probes[rowId]?.suggestion
    if (probes[rowId]?.phase !== 'completed' || !suggestion || !hasThinkingSuggestion(suggestion)) return
    updateModel(endpointRowId, rowId, {reasoning: 'on', effortLevels: suggestion.join(', '), reasoningEdited: true})
  }

  const toggleModel = (rowId: number) => {
    setExpandedModels((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const fillModel = async (endpointRowId: number, rowId: number) => {
    try {
      const catalog = await loadModelsDev()
      setEndpoints((previous) => previous.map((endpoint) => {
        if (endpoint.rowId !== endpointRowId) return endpoint
        const def = providerDefinition(endpoint.platform)
        const models = endpoint.models.map((row) => row.rowId === rowId ? applyOfficialDefaults([row], def, catalog).rows[0] ?? row : row)
        return { ...endpoint, models }
      }))
    } catch {
      // Manual values remain available if models.dev cannot be reached.
    }
  }

  const fillProvider = async (endpointRowId: number) => {
    invalidateEndpoint(endpointRowId)
    const revision = revisions.current.get(endpointRowId)
    const endpoint = endpointsRef.current.find((entry) => entry.rowId === endpointRowId)
    const def = providerDefinition(endpoint?.platform ?? 'openai')
    const title = endpoint !== undefined && endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label
    setBusy(`metadata-${endpointRowId}`); setError(''); setMessage('')
    try {
      const catalog = await loadModelsDev()
      if (!mounted.current || revisions.current.get(endpointRowId) !== revision) return
      setEndpoints((previous) => previous.map((entry) => entry.rowId === endpointRowId ? {...entry, models: applyOfficialDefaults(entry.models, providerDefinition(entry.platform), catalog).rows} : entry))
      setMessage(`${title} 已补全空白字段，保留手动设置`)
    } catch (e) {
      setError(`无法读取 models.dev：${String(e instanceof Error ? e.message : e)}`)
    } finally {
      setBusy('')
      const entry = endpointsRef.current.find(item => item.rowId === endpointRowId)
      if (entry && mounted.current && revisions.current.get(endpointRowId) === revision) startProbes(entry)
    }
  }

  const save = async () => {
    const submitted = endpointsRef.current
    for (const endpoint of submitted) invalidateEndpoint(endpoint.rowId)
    setBusy('save'); setError(''); setMessage('')
    try {
      if (!structuredConfig) throw new Error('服务端仍在运行旧版插件，请重启 DSH Web 后再保存结构化模型配置')
      if (submitted.length > 0
        && submitted.every((endpoint) => endpoint.baseURL.trim().length === 0)
        && baseURL.trim().length === 0) {
        throw new Error('请至少填写一个网关地址：每个端点自己的地址，或上方的默认地址')
      }
      const payload = {
        baseURL,
        endpoints: submitted.map((endpoint) => {
          const def = providerDefinition(endpoint.platform)
          const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label
          return {
            name: endpoint.name.trim(),
            baseURL: endpoint.baseURL.trim(),
            platform: endpoint.platform,
            apiKey: endpoint.apiKey,
            ...(endpoint.apiKeyEnv.length > 0 ? { apiKeyEnv: endpoint.apiKeyEnv } : {}),
            api: endpoint.api,
            models: serializeModels(endpoint.models, title),
          }
        }),
        tools: {} as { generate?: ImageToolModelRef },
      }
      const generate = serializeToolRef(tools.generate)
      if (generate !== undefined) payload.tools.generate = generate
      const res = await api<{ ok: boolean; error?: string; routes?: string[]; endpoints?: ConfigPayloadEndpoint[] }>(`${BASE}/config`, { method: 'POST', body: JSON.stringify(payload) })
      if (!mounted.current) return
      if (!res || typeof res !== 'object' || Array.isArray(res) || res.ok !== true) {
        throw new Error(typeof res?.error === 'string' ? res.error : '保存响应无效')
      }
      if (res.routes !== undefined && (!Array.isArray(res.routes) || res.routes.some(route => typeof route !== 'string'))) {
        throw new Error('保存响应的路由无效')
      }
      const acknowledgements = res.endpoints
      if (acknowledgements !== undefined && (!Array.isArray(acknowledgements) || acknowledgements.length !== submitted.length || acknowledgements.some((ack, index) => {
        const sent = payload.endpoints[index]!
        return !ack || typeof ack !== 'object' || Array.isArray(ack)
          || ack.name !== sent.name || ack.baseURL !== sent.baseURL.replace(/\/+$/, '') || ack.platform !== sent.platform
          || typeof ack.apiKeyEnv !== 'string' || typeof ack.route !== 'string' || typeof ack.keyConfigured !== 'boolean'
      }))) throw new Error('保存响应的端点与提交不匹配')
      const routes = res.routes !== undefined && res.routes.length > 0 ? res.routes.join(', ') : '无（未填 key）'
      setMessage(`已保存。激活路由: ${routes}`)
      setEndpoints(previous => previous.map(endpoint => {
        const index = submitted.findIndex(sent => sent.rowId === endpoint.rowId)
        if (index < 0) return endpoint
        const sent = submitted[index]!
        const ack = acknowledgements?.[index]
        return {
          ...endpoint,
          ...(ack ? {apiKeyEnv: ack.apiKeyEnv!, route: ack.route, keyConfigured: ack.keyConfigured, apiKey: endpoint.apiKey === sent.apiKey ? '' : endpoint.apiKey} : {}),
          models: endpoint.models.map(row => sent.models.includes(row) ? {...row, fromSaved: true} : row),
        }
      }))
    } catch (e) {
      if (mounted.current) setError(String(e instanceof Error ? e.message : e))
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const addEndpoint = () => {
    const endpoint = endpointRow()
    setEndpoints((previous) => [...previous, endpoint])
    setExpandedEndpoints((current) => new Set([...current, endpoint.rowId]))
    setError(''); setMessage('已添加一个端点，选择平台、填写地址与 API Key 后保存')
  }

  const removeEndpoint = (endpointRowId: number) => {
    invalidateEndpoint(endpointRowId)
    setEndpoints((previous) => previous.filter((endpoint) => endpoint.rowId !== endpointRowId))
    setExpandedEndpoints((current) => {
      const next = new Set(current)
      next.delete(endpointRowId)
      return next
    })
  }

  const discover = async (endpointRowId: number) => {
    invalidateEndpoint(endpointRowId)
    const endpoint = endpointsRef.current.find((entry) => entry.rowId === endpointRowId)
    if (endpoint === undefined) return
    const def = providerDefinition(endpoint.platform)
    const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label
    setBusy(`discover-${endpointRowId}`); setError(''); setMessage('')
    // Clear the list first so a failed fetch cannot leave a stale catalog behind.
    if (!endpoint.autoProbeReasoning) updateEndpoint(endpointRowId, {models: []})
    const revision = revisions.current.get(endpointRowId)
    try {
      const res = await api<{ ok: boolean; models: CatalogModel[] }>(`${BASE}/discover`, {
        method: 'POST',
        body: JSON.stringify({
          baseURL: endpoint.baseURL.trim() || baseURL,
          apiKey: endpoint.apiKey,
          apiKeyEnv: endpoint.apiKeyEnv,
          provider: endpoint.platform,
        }),
      })
      if (!mounted.current || revisions.current.get(endpointRowId) !== revision) return
      let rows = (res.models ?? []).map(model => endpoint.autoProbeReasoning ? endpoint.models.find(row => row.id === model.id) ?? modelRow(model) : modelRow(model))
      try {
        rows = applyOfficialDefaults(rows, def, await loadModelsDev()).rows
      } catch {
        // Discovery results are still useful without public metadata.
      }
      if (!mounted.current || revisions.current.get(endpointRowId) !== revision) return
      setEndpoints(previous => previous.map(entry => entry.rowId === endpointRowId ? {...entry, models: rows} : entry))
      const entry = endpointsRef.current.find(item => item.rowId === endpointRowId)
      if (entry) startProbes(entry)
      setMessage(`${title} 发现 ${rows.length} 个模型`)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy('')
    }
  }

  const checkUsage = async (endpointRowId: number) => {
    const endpoint = endpoints.find((entry) => entry.rowId === endpointRowId)
    if (endpoint === undefined) return
    const def = providerDefinition(endpoint.platform)
    const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label
    setBusy(`usage-${endpointRowId}`); setError(''); setMessage('')
    try {
      const res = await api<{ ok: boolean; summary?: string }>(`${BASE}/usage`, {
        method: 'POST',
        body: JSON.stringify({
          baseURL: endpoint.baseURL.trim() || baseURL,
          apiKey: endpoint.apiKey,
          apiKeyEnv: endpoint.apiKeyEnv,
          provider: endpoint.platform,
        }),
      })
      setMessage(`${title} 用量: ${res.summary ?? ''}`)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy('')
    }
  }

  const checkStatus = async () => {
    setBusy('status'); setError(''); setMessage('')
    try {
      const res = await api<{ routes: string[]; models: Record<string, string[]> }>(`${BASE}/status`)
      setMessage(`已注册路由: ${res.routes.length > 0 ? res.routes.join(', ') : '无'}；模型: ${JSON.stringify(res.models)}`)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="s2a_section" ref={sectionRef}>
      <h2 className="s2a_title">Sub2API 模型接入</h2>
      <p className="s2a_intro">
        多端点 + 多 key：每个端点填自己的网关地址与 API key，key 在 sub2api 后台绑定的分组决定平台（OpenAI / Claude / Grok）与可用模型。
      </p>
      <p className="s2a_notice">
        提示：先在 sub2api 后台创建各平台的分组并生成 API key，再在下方逐个添加端点。
      </p>
      <div className="s2a_field" style={{ marginTop: 2 }}>
        <label className="s2a_fieldLabel">默认网关地址（端点未单独填写时使用）</label>
        <input className="s2a_input" value={baseURL} placeholder="http://localhost:8080" onChange={(event) => {for (const endpoint of endpointsRef.current) invalidateEndpoint(endpoint.rowId); baseRef.current = event.target.value; setBaseURL(event.target.value)}} />
      </div>
      <div className="s2a_rowCard">
        <div className="s2a_rowHead">
          <div className="s2a_rowIdentity">
            <span className="s2a_rowName">图片生成工具</span>
            <span className="s2a_rowTag">generate_image</span>
          </div>
        </div>
        <div className="s2a_editor">
          <p className="s2a_intro">
            指定生成图片使用的模型，生成结果会保存到工作区。
          </p>
          {(['generate'] as const).map((kind) => {
            const label = '生图模型'
            const ref = tools[kind]
            const options = toolOptions(endpoints)
            const selected = ref.provider.length > 0 && ref.model.length > 0 ? `${ref.provider}:${ref.model}` : ''
            const known = options.some((option) => option.value === selected)
            return (
              <div key={kind} className="s2a_field">
                <label className="s2a_fieldLabel">{label}</label>
                <select
                  className="s2a_input"
                  value={selected}
                  aria-label={label}
                  onChange={(event) => {
                    const next = options.find((option) => option.value === event.target.value)
                    setTools((current) => ({
                      ...current,
                      [kind]: next === undefined ? emptyToolRef() : { provider: next.provider, model: next.model },
                    }))
                  }}
                >
                  <option value="">未指定</option>
                  {!known && selected.length > 0 && (
                    <option value={selected}>{`${ref.provider} / ${ref.model}（不在当前目录）`}</option>
                  )}
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>
      <ul className="s2a_rows">
        {endpoints.map((endpoint) => {
          const def = providerDefinition(endpoint.platform)
          const title = endpoint.name.trim().length > 0 ? endpoint.name.trim() : def.label
          const expanded = expandedEndpoints.has(endpoint.rowId)
          const detailsId = `s2a-endpoint-${endpoint.rowId}-details`
          return (
            <li key={endpoint.rowId} className="s2a_rowCard">
              <div className="s2a_rowHead">
                <button
                  type="button"
                  className="s2a_iconBtn s2a_endpointToggle"
                  title={expanded ? '收起端点' : '展开端点'}
                  aria-label={`${expanded ? '收起' : '展开'} ${title} 端点`}
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => toggleEndpoint(endpoint.rowId)}
                >
                  <IconChevron expanded={expanded} />
                </button>
                <div className="s2a_rowIdentity">
                  <ProviderIcon name={def.icon} size={18} />
                  <span className="s2a_rowName">{title}</span>
                  <span className="s2a_rowTag">{endpoint.route.length > 0 ? endpoint.route : '未保存'}</span>
                </div>
                <div className="s2a_rowActions">
                  <button className="s2a_btn" disabled={busy.length > 0} onClick={() => discover(endpoint.rowId)}>
                    {busy === `discover-${endpoint.rowId}` ? '…' : '获取模型'}
                  </button>
                  <button className="s2a_btn" disabled={busy.length > 0} onClick={() => checkUsage(endpoint.rowId)}>
                    {busy === `usage-${endpoint.rowId}` ? '…' : '查看用量'}
                  </button>
                  <button
                    className="s2a_btn"
                    disabled={busy.length > 0 || endpoints.length <= 1}
                    title={endpoints.length <= 1 ? '至少保留一个端点' : '删除该端点'}
                    onClick={() => removeEndpoint(endpoint.rowId)}
                  >
                    删除端点
                  </button>
                </div>
              </div>
              {expanded && <div id={detailsId} className="s2a_editor">
                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="s2a_field" style={{ flex: 2 }}>
                    <label className="s2a_fieldLabel">名称（可选，决定路由名）</label>
                    <input
                      className="s2a_input"
                      value={endpoint.name}
                      placeholder={def.label}
                      aria-label={`${title} 名称`}
                      onChange={(event) => updateEndpoint(endpoint.rowId, { name: event.target.value })}
                    />
                  </div>
                  <div className="s2a_field" style={{ flex: 1 }}>
                    <label className="s2a_fieldLabel">平台</label>
                    <select
                      className="s2a_input"
                      value={endpoint.platform}
                      aria-label={`${title} 平台`}
                      onChange={(event) => updateEndpoint(endpoint.rowId, { platform: event.target.value as ProviderKey })}
                    >
                      {PROVIDERS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="s2a_field">
                  <label className="s2a_fieldLabel">网关地址（留空用默认地址）</label>
                  <input
                    className="s2a_input"
                    value={endpoint.baseURL}
                    placeholder={baseURL.trim().length > 0 ? baseURL : 'http://localhost:8080'}
                    aria-label={`${title} 网关地址`}
                    onChange={(event) => updateEndpoint(endpoint.rowId, { baseURL: event.target.value })}
                  />
                </div>
                <div className="s2a_field">
                  <label className="s2a_fieldLabel">
                    {title} API Key{endpoint.keyConfigured || endpoint.apiKey.length > 0 ? ' ✓' : ''}
                  </label>
                  <input
                    className="s2a_input"
                    type="password"
                    value={endpoint.apiKey}
                    placeholder={endpoint.keyConfigured ? `${def.placeholder}（已配置，留空保持不变）` : def.placeholder}
                    aria-label={`${title} API Key`}
                    onChange={(event) => updateEndpoint(endpoint.rowId, { apiKey: event.target.value })}
                  />
                </div>
                <div className="s2a_field">
                  <label className="s2a_fieldLabel">网关协议（留空用平台默认）</label>
                  <select
                    className="s2a_input"
                    value={endpoint.api}
                    aria-label={`${title} 网关协议`}
                    onChange={(event) => updateEndpoint(endpoint.rowId, { api: event.target.value })}
                  >
                    <option value="">自动（{def.label} 默认）</option>
                    <option value="openai-responses">openai-responses</option>
                    <option value="openai-completions">openai-completions</option>
                    <option value="anthropic-messages">anthropic-messages</option>
                  </select>
                </div>
                <div className="s2a_field">
                  <label className="s2a_fieldLabel">模型列表</label>
                  <label className="s2a_probeToggle">
                    <input type="checkbox" aria-label={`${title} 自动探测档位`} checked={endpoint.autoProbeReasoning} onChange={event => updateEndpoint(endpoint.rowId, {autoProbeReasoning: event.target.checked})} />
                    自动探测档位
                  </label>
                  <div className="s2a_models">
                    {endpoint.models.length === 0
                      ? <p className="s2a_modelEmpty">暂无模型</p>
                      : endpoint.models.map((row) => {
                        const expanded = expandedModels.has(row.rowId)
                        const detailsId = `s2a-model-${row.rowId}-details`
                        return (
                          <div key={row.rowId} className="s2a_modelItem">
                            <div className="s2a_modelSummary">
                              <div>
                                <input
                                  className="s2a_input"
                                  value={row.id}
                                  placeholder="模型 ID"
                                  aria-label={`${title} 模型 ID`}
                                  onChange={(event) => updateModel(endpoint.rowId, row.rowId, { id: event.target.value })}
                                  onBlur={() => fillModel(endpoint.rowId, row.rowId)}
                                />
                              </div>
                              <div>
                                <input
                                  className="s2a_input"
                                  value={row.name}
                                  placeholder="名称"
                                  aria-label={`${title} 模型名称`}
                                  onChange={(event) => updateModel(endpoint.rowId, row.rowId, { name: event.target.value })}
                                />
                              </div>
                              <button
                                type="button"
                                className="s2a_iconBtn s2a_expandBtn"
                                title={expanded ? '收起模型详情' : '展开模型详情'}
                                aria-label={expanded ? `收起 ${row.id || '模型'} 详情` : `展开 ${row.id || '模型'} 详情`}
                                aria-expanded={expanded}
                                aria-controls={detailsId}
                                onClick={() => toggleModel(row.rowId)}
                              >
                                <IconChevron expanded={expanded} />
                              </button>
                              <button
                                type="button"
                                className="s2a_iconBtn s2a_trash"
                                title="删除模型"
                                aria-label={`删除 ${row.id || '模型'}`}
                                onClick={() => updateEndpoint(endpoint.rowId, { models: endpoint.models.filter((item) => item.rowId !== row.rowId) })}
                              >
                                <IconTrash />
                              </button>
                            </div>
                            <div className="s2a_probeEntry"><button type="button" className="s2a_btn" aria-label={`${title} ${row.id} 探测档位`} disabled={busy.length > 0 || !row.id.trim() || ['queued', 'running'].includes(probes[row.rowId]?.phase ?? '')} onClick={() => startProbes(endpoint, [row], true)}>探测档位</button></div>
                            {probes[row.rowId] && <div className="s2a_probe" role="status" aria-live="polite">
                              <span className="s2a_probeStatus">{({queued: '排队中', running: '探测中', completed: '探测完成', cancelled: '已取消', expired: '已超时，未知档位保留', unavailable: '探测不可用，档位保留'})[probes[row.rowId]!.phase]} · {probes[row.rowId]!.requests}/{probes[row.rowId]!.maxRequests} 次请求{['queued', 'running'].includes(probes[row.rowId]!.phase) ? ` · 预计 ${Math.ceil(probes[row.rowId]!.estimateMs / 1000)} 秒` : ''}</span>
                              {['queued', 'running'].includes(probes[row.rowId]!.phase) && <button type="button" className="s2a_btn" aria-label={`${title} ${row.id} 取消探测`} onClick={() => cancelProbe(row.rowId)}>取消</button>}
                              {probes[row.rowId]!.phase === 'completed' && hasThinkingSuggestion(probes[row.rowId]!.suggestion) && (row.fromSaved || row.reasoningEdited || row.reasoning === 'off') && <button type="button" className="s2a_btn" aria-label={`${title} ${row.id} 应用探测建议`} onClick={() => applyProbe(endpoint.rowId, row.rowId)}>应用建议</button>}
                              <span className="s2a_probeLevels">{probes[row.rowId]!.levels.map(level => <span key={level.level} title={PROBE_REASONS[level.reason] ?? '未知，保留'}>{level.level}: {({accepted: '参数已接受', unsupported: '已确认不支持', unknown: '未知，保留'})[level.state]}</span>)}</span>
                            </div>}
                            {expanded && (
                              <div id={detailsId} className="s2a_modelDetails">
                                <div className="s2a_field">
                                  <label className="s2a_fieldLabel">上下文窗口</label>
                                  <input
                                    className="s2a_input"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={row.contextWindow}
                                    placeholder="自动填充"
                                    aria-label={`${title} 上下文窗口`}
                                    onChange={(event) => updateModel(endpoint.rowId, row.rowId, { contextWindow: event.target.value })}
                                  />
                                </div>
                                <div className="s2a_field">
                                  <label className="s2a_fieldLabel">最大输出 token</label>
                                  <input
                                    className="s2a_input"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={row.maxTokens}
                                    placeholder="自动填充"
                                    aria-label={`${title} 最大输出 token`}
                                    onChange={(event) => updateModel(endpoint.rowId, row.rowId, { maxTokens: event.target.value })}
                                  />
                                </div>
                                <div className="s2a_field">
                                  <label className="s2a_fieldLabel">图片输入</label>
                                  <select className="s2a_input" aria-label={`${title} ${row.id} 图片输入`} value={row.input}
                                    onChange={event => updateModel(endpoint.rowId, row.rowId, { input: event.target.value, inputEdited: true })}>
                                    <option value="">自动（按模型推断）</option>
                                    <option value="text">仅文本</option>
                                    <option value="text-image">文本 + 图片</option>
                                  </select>
                                </div>
                                <div className="s2a_field s2a_reasoningField">
                                  <label className="s2a_fieldLabel">思考强度</label>
                                  <select className="s2a_input" aria-label={`${title} ${row.id} 思考模式`} value={row.reasoning}
                                    onChange={event => updateModel(endpoint.rowId, row.rowId, { reasoning: event.target.value, reasoningEdited: true })}>
                                    <option value="">自动</option>
                                    <option value="off">不支持</option>
                                    <option value="on">手动输入档位</option>
                                  </select>
                                  {row.reasoning === 'on' && <input className="s2a_input" value={row.effortLevels}
                                    aria-label={`${title} ${row.id} 思考强度档位`} placeholder="例如 none, low, high, max"
                                    onChange={event => updateModel(endpoint.rowId, row.rowId, { effortLevels: event.target.value, reasoningEdited: true })} />}
                                  <span className="s2a_modelSource">多个档位用逗号分隔。手动设置不会被补全数据覆盖。</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                  <div className="s2a_modelFooter">
                    <span className="s2a_modelSource">
                      默认值来自 <a href="https://models.dev/" target="_blank" rel="noreferrer">models.dev</a>，未匹配时可手动填写
                    </span>
                    <div className="s2a_modelActions">
                      <button className="s2a_btn" disabled={busy.length > 0 || endpoint.models.length === 0} onClick={() => fillProvider(endpoint.rowId)}>
                        {busy === `metadata-${endpoint.rowId}` ? '…' : '补全数据'}
                      </button>
                      <button className="s2a_btn" disabled={busy.length > 0} onClick={() => updateEndpoint(endpoint.rowId, { models: [...endpoint.models, modelRow()] })}>
                        添加模型
                      </button>
                    </div>
                  </div>
                </div>
              </div>}
            </li>
          )
        })}
      </ul>
      <div className="s2a_actions">
        <button className="s2a_btn" disabled={busy.length > 0} onClick={addEndpoint}>
          添加端点
        </button>
        <button className="s2a_primary" disabled={busy.length > 0} onClick={save}>
          {busy === 'save' ? '保存中…' : '保存配置'}
        </button>
        <button className="s2a_btn" disabled={busy.length > 0} onClick={checkStatus}>
          {busy === 'status' ? '…' : '查看状态'}
        </button>
      </div>
      {(message || error) && <div className="s2a_toast" role="status" aria-live="polite">
        <p className={`s2a_status ${error ? 's2a_statusErr' : 's2a_statusOk'}`}>{error || message}</p>
        <button className="s2a_iconBtn" aria-label="关闭提示" onClick={() => { setMessage(''); setError('') }}>×</button>
      </div>}
    </div>
  )
}

export default Sub2ApiSettings
