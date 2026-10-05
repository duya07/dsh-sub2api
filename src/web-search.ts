/**
 * Global `web_search` provider served by this gateway.
 *
 * The reference plugins either bind the host's search tool to a subscription
 * account (private codex endpoints) or re-implement the tool themselves. Both
 * are wrong for a gateway-shaped plugin, so this module registers a *candidate*
 * into the host's `ctx.web` seam instead: the host keeps owning the tool, the
 * result shape and provider selection, while this plugin only answers one
 * `search()` call by asking the configured gateway endpoint to run its own
 * native `web_search` tool over the Responses API.
 *
 * Two properties matter for coexistence with the official provider:
 *
 * 1. `available()` returns false unless the user explicitly enabled this route
 *    in the settings section. The host throws `WEB_PROVIDER_AMBIGUOUS` when two
 *    *available* providers exist and no explicit `searchProvider` is
 *    configured, so an always-available candidate would break the search setup
 *    that already works today.
 * 2. One request per search: no hidden retries, and a coded error preserves the
 *    host's `WEB_*` error contract.
 *
 * The host's `@deepseek-ai/dsh-web` package ships no declaration file and is
 * deliberately absent from this plugin's dependencies, so this module defines
 * its own `HarnessError` subclass carrying the same stable `code` field the
 * seam documents.
 *
 * @module dsh-sub2api/web-search
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import { apiProtocolForKey, gatewayApiRoot, type ApiProtocol, type Config, type ProviderKey, type ProviderProfile } from './index.ts'
import { endpointRoute, platformLabel } from './pi-ai.ts'

/** Stable id this provider registers under with the host's `ctx.web` seam. */
export const SUB2API_WEB_SEARCH_PROVIDER_ID: string = 'sub2api'

/** Upper bound on a gateway search response body this plugin is willing to buffer. */
export const MAX_SEARCH_RESPONSE_BYTES: number = 2 * 1024 * 1024

/** Longest gateway error message echoed into a thrown error. */
const MAX_ERROR_DETAIL_LENGTH = 300

/** One source the host renders from a search result. */
export interface WebSearchSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

/**
 * The normalized result shape the host's `ctx.web` seam consumes. `content` is
 * an extension the host's tool layer already understands: when present it is
 * surfaced as the search answer, and `sources` stays the citation list.
 */
export interface WebSearchResult {
  sources: WebSearchSource[]
  truncated: boolean
  content?: string
}

/** The request shape the host's `ctx.web.search()` seam passes down. */
export interface WebSearchRequest {
  query: string
  maxResults?: number
}

/** The subset of the plugin host this provider needs. */
export interface WebSearchHost {
  config: () => Config
  resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>
}

/**
 * A search failure the host can route by `code`. Shaped like the host's own
 * `WebError` (`HarnessError` with a stable `code`), which cannot be imported
 * here because `@deepseek-ai/dsh-web` is not a dependency of this plugin.
 */
export class Sub2ApiWebError extends HarnessError {}

/** A gateway endpoint able to answer a Responses-API search. */
export interface ResolvedWebSearch {
  /** Route id the request is billed to; also what the settings section stores. */
  route: string
  /** Human label used in diagnostics. */
  label: string
  profile: ProviderProfile
  /** Model id sent as `model` on the Responses request. */
  model: string
  /** Gateway root that already carries the protocol's version segment. */
  baseURL: string
  api: ApiProtocol
}

function isPlatformKey(value: string): value is ProviderKey {
  return value === 'openai' || value === 'claude' || value === 'grok'
}

/**
 * Resolve the configured search route, or `undefined` when the feature is off,
 * under-specified, or bound to an endpoint that cannot serve a Responses
 * request. Callers treat `undefined` as "this provider is not available", which
 * is exactly what keeps provider selection unambiguous.
 */
export function resolveWebSearchTarget(config: Config): ResolvedWebSearch | undefined {
  const ref = config.tools?.webSearch
  if (ref === undefined || ref.enabled !== true) return undefined
  const provider = typeof ref.provider === 'string' ? ref.provider.trim() : ''
  const model = typeof ref.model === 'string' ? ref.model.trim() : ''
  if (provider.length === 0 || model.length === 0) return undefined

  const endpoints = config.endpoints ?? []
  const entry = endpoints.find((candidate) => endpointRoute(candidate, endpoints) === provider)
  if (entry !== undefined) {
    const baseURL = typeof entry.baseURL === 'string' ? entry.baseURL.trim() : ''
    if (baseURL.length === 0) return undefined
    const api = entry.api ?? apiProtocolForKey(entry.platform, entry)
    // A Responses search needs the Anthropic-style endpoint's sibling
    // (`/v1/responses`), so an anthropic-messages route is not a candidate.
    if (api !== 'openai-responses') return undefined
    return {
      route: provider,
      label: entry.name?.trim() || platformLabel(entry.platform),
      profile: {
        ...(entry.apiKeyEnv !== undefined ? { apiKeyEnv: entry.apiKeyEnv } : {}),
        ...(entry.api !== undefined ? { api: entry.api } : {}),
      },
      model,
      baseURL: gatewayApiRoot(baseURL),
      api,
    }
  }

  // Collapsed single-endpoint layouts keep the bare platform key as the route.
  if (!isPlatformKey(provider)) return undefined
  const profile = config.providers?.[provider] ?? {}
  const baseURL = typeof config.baseURL === 'string' ? config.baseURL.trim() : ''
  if (baseURL.length === 0) return undefined
  const api = apiProtocolForKey(provider, profile)
  if (api !== 'openai-responses') return undefined
  return {
    route: provider,
    label: `${platformLabel(provider)}（默认端点）`,
    profile,
    model,
    baseURL: gatewayApiRoot(baseURL),
    api,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function tooLargeError(): Sub2ApiWebError {
  return new Sub2ApiWebError(
    `sub2api web search: gateway response exceeds the ${MAX_SEARCH_RESPONSE_BYTES} byte cap`,
    'WEB_PROVIDER_ERROR',
  )
}

function abortedError(cause?: unknown): Sub2ApiWebError {
  return new Sub2ApiWebError('sub2api web search aborted', 'WEB_ABORTED', cause === undefined ? undefined : { cause })
}

async function readBodyLimited(response: Response, signal?: AbortSignal): Promise<string> {
  const body = response.body
  if (body === null || body === undefined) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_SEARCH_RESPONSE_BYTES) throw tooLargeError()
    return text
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > MAX_SEARCH_RESPONSE_BYTES) {
        await reader.cancel()
        throw tooLargeError()
      }
      chunks.push(value)
    }
  } catch (error) {
    if (signal?.aborted) throw abortedError(error)
    throw error
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Read the gateway's error message, never the whole body and never a credential. */
async function readErrorDetail(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`
  try {
    const text = await response.text()
    if (text.length === 0) return fallback
    const parsed = asRecord(JSON.parse(text))
    const nested = asRecord(parsed?.error)
    const message = typeof nested?.message === 'string'
      ? nested.message
      : typeof parsed?.message === 'string' ? parsed.message : ''
    const trimmed = message.trim()
    if (trimmed.length === 0) return fallback
    return trimmed.length > MAX_ERROR_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_ERROR_DETAIL_LENGTH)}…` : trimmed
  } catch {
    return fallback
  }
}

function readCitation(value: unknown, seen: Set<string>): WebSearchSource | undefined {
  const record = asRecord(value)
  if (record?.type !== 'url_citation') return undefined
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  if (url.length === 0 || seen.has(url)) return undefined
  seen.add(url)
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  return title.length > 0 ? { url, title } : { url }
}

/**
 * Normalize a Responses-API body into the host's search result: model text from
 * `message.content[].output_text` plus `url_citation` annotations. A response
 * carrying neither is reported as an error instead of an empty result, because
 * an empty answer would silently look like "nothing found".
 */
export function parseResponsesSearch(body: string): WebSearchResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    throw new Sub2ApiWebError(
      'sub2api web search: gateway returned a body that is not JSON',
      'WEB_PROVIDER_ERROR',
      { cause: error },
    )
  }
  const record = asRecord(parsed)
  const items = Array.isArray(record?.output) ? record.output : []
  const texts: string[] = []
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const entry = asRecord(item)
    if (entry?.type !== 'message') continue
    const parts = Array.isArray(entry.content) ? entry.content : []
    for (const part of parts) {
      const piece = asRecord(part)
      if (piece?.type !== 'output_text') continue
      if (typeof piece.text === 'string' && piece.text.length > 0) texts.push(piece.text)
      const annotations = Array.isArray(piece.annotations) ? piece.annotations : []
      for (const annotation of annotations) {
        const source = readCitation(annotation, seen)
        if (source !== undefined) sources.push(source)
      }
    }
  }
  // Gateways that flatten the answer expose `output_text` at the top level.
  if (texts.length === 0 && typeof record?.output_text === 'string' && record.output_text.length > 0) {
    texts.push(record.output_text)
  }
  if (texts.length === 0 && sources.length === 0) {
    throw new Sub2ApiWebError(
      'sub2api web search: gateway response carried no output_text and no citations (the endpoint may not support the web_search tool)',
      'WEB_PROVIDER_ERROR',
    )
  }
  const content = texts.join('\n').trim()
  return { sources, truncated: false, ...(content.length > 0 ? { content } : {}) }
}

function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || maxResults <= 0 || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

/**
 * One gateway-backed search candidate for the host's `ctx.web` seam.
 */
export class Sub2ApiWebSearchProvider {
  /** Seam id; fixed so the host's `web.searchProvider` can select it by name. */
  readonly id: string = SUB2API_WEB_SEARCH_PROVIDER_ID

  private readonly host: WebSearchHost

  constructor(host: WebSearchHost) {
    this.host = host
  }

  /**
   * Only an explicitly enabled and fully resolved route is available. Anything
   * else keeps this candidate invisible to provider selection.
   */
  available(): boolean {
    return resolveWebSearchTarget(this.host.config()) !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const target = resolveWebSearchTarget(this.host.config())
    if (target === undefined) {
      throw new Sub2ApiWebError(
        'sub2api web search is not enabled: turn it on in the plugin settings section and save',
        'WEB_PROVIDER_UNAVAILABLE',
      )
    }
    if (signal?.aborted) throw abortedError()

    let apiKey: string
    try {
      apiKey = await this.host.resolveApiKey(target.route, target.profile)
    } catch (error) {
      throw new Sub2ApiWebError(
        `sub2api web search: no usable API key for ${target.label} (${target.route})`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
        { cause: error },
      )
    }
    if (signal?.aborted) throw abortedError()

    const endpoint = `${target.baseURL}/responses`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          ...attributionHeaders(),
        },
        body: JSON.stringify({
          model: target.model,
          input: request.query,
          tools: [{ type: 'web_search' }],
          stream: false,
        }),
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw abortedError(error)
      throw new Sub2ApiWebError(
        `sub2api web search: request to ${endpoint} failed`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw new Sub2ApiWebError(
        `sub2api web search failed (HTTP ${response.status}): ${detail}`,
        'WEB_PROVIDER_ERROR',
      )
    }

    let text: string
    try {
      text = await readBodyLimited(response, signal)
    } catch (error) {
      if (error instanceof Sub2ApiWebError) throw error
      if (signal?.aborted) throw abortedError(error)
      throw new Sub2ApiWebError('sub2api web search: gateway response could not be read', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    return capSources(parseResponsesSearch(text), request.maxResults)
  }
}

/** The subset of the host's `ctx.web` seam this plugin registers into. */
interface WebSearchSeam {
  registerSearchProvider: (provider: Sub2ApiWebSearchProvider) => () => void
}

/**
 * Register the candidate into the host's web seam. Registration is an effect,
 * so disabling or unloading the plugin withdraws the provider with it.
 */
export function registerWebSearchProvider(ctx: Context, host: WebSearchHost): void {
  ctx.inject(['web'], (webCtx: Context) => {
    const seam = (webCtx as unknown as { web: WebSearchSeam }).web
    const provider = new Sub2ApiWebSearchProvider(host)
    webCtx.effect(() => seam.registerSearchProvider(provider))
  })
}
