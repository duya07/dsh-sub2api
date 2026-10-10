/**
 * Global image-generation tool.
 *
 * These call a configured Sub2API model independently of the current chat
 * route, so a text-only session can still create images. Results include a workspace path and an image attachment.
 *
 * @module dsh-sub2api/image-tools
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  DEFAULT_MAX_TOKENS,
  apiProtocolForKey,
  gatewayAnthropicRoot,
  gatewayApiRoot,
  type ApiProtocol,
  type Config,
  type ProviderKey,
  type ProviderProfile,
} from './index.ts'
import { endpointRoute } from './pi-ai.ts'
import {
  IMAGE_TOOL_PROMPT_SECTION,
  LEGACY_IMAGE_TOOL_NAME,
  STABLE_IMAGE_TOOL_NAME,
} from './shared/image-tool-names.ts'
import {
  DEFAULT_RATE_LIMIT_RETRY_POLICY,
  HttpIdleTimeoutError,
  TRANSIENT_HTTP_FAILURE,
  classifyHttpFailure,
  cooldownNote,
  endpointCooldowns,
  fetchWithResilience,
  type EndpointCooldownTracker,
  type RateLimitRetryPolicy,
} from './http-resilience.ts'

interface ImageFsTarget {
  displayPath: string
}

interface ImageFsInfo {
  type: string
}

interface ImageFs {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<ImageFsTarget>
  stat(target: ImageFsTarget, signal?: AbortSignal): Promise<ImageFsInfo | undefined>
  readBytes(target: ImageFsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  contains(parent: ImageFsTarget, child: ImageFsTarget): boolean
  processPath(target: ImageFsTarget): string
}

function getFs(ctx: Context): ImageFs | undefined {
  return (ctx as Context & { get(name: 'fs'): ImageFs | undefined }).get('fs')
}

export const GENERATE_IMAGE_NAME: string = LEGACY_IMAGE_TOOL_NAME
export const DEFAULT_IMAGE_TOOL_TIMEOUT_MS = 180_000
export const DEFAULT_MAX_IMAGE_BYTES: number = 20 * 1024 * 1024

/**
 * How long one image-path request may stay silent before the idle watchdog
 * aborts it.
 *
 * `DEFAULT_IMAGE_TOOL_TIMEOUT_MS` above is a *total* budget: it cannot tell an
 * endpoint that is still rendering from one whose connection died, so a dead
 * socket used to hold the tool for the whole three minutes. A generation
 * endpoint normally answers within 10–60 seconds and a remote image URL within
 * a few seconds, so two silent minutes only ever fires on a genuinely stalled
 * request, while the total budget still applies on top.
 */
export const IMAGE_TOOL_IDLE_TIMEOUT_MS: number = 120_000

/**
 * The bounded retry policy for the image paths: at most one extra attempt, and
 * only for a `429` that states a delay this plugin can parse. Exported so a
 * host or a test can pass `{ enabled: false }` and get strictly single-shot
 * requests.
 */
export const IMAGE_TOOL_RATE_LIMIT_RETRY_POLICY: RateLimitRetryPolicy = DEFAULT_RATE_LIMIT_RETRY_POLICY

/**
 * The slice of the host tool registry this plugin needs. `get` is optional so
 * the plugin keeps working against hosts (and test doubles) that only expose
 * `register`.
 */
interface ToolRegistry {
  register: (definition: unknown) => unknown
  get?: (name: string) => unknown
}

/** True when `error` is the host's own "name already taken" rejection. */
function isOwnDuplicateNameError(error: unknown, name: string): boolean {
  return error instanceof Error && error.message.startsWith(`tool "${name}" is already registered`)
}

/**
 * True when another tool already owns `name`. A registry without `get` (older
 * hosts and minimal test doubles) cannot be asked, so the name is assumed free
 * and registration is still attempted. A `get` that throws is a real registry
 * failure — it propagates, because treating it as "free" would register into a
 * broken registry and advertise a tool nobody can resolve.
 */
function isToolNameTaken(tools: ToolRegistry, name: string): boolean {
  if (typeof tools.get !== 'function') return false
  return tools.get(name) !== undefined
}

/** Prompt text for the names this plugin registered; empty string drops the section. */
function imageToolPromptText(names: readonly string[]): string {
  if (names.length === 0) return ''
  const primary = names[0]!
  const alias = names.length > 1 ? names[1]! : undefined
  const subject = alias === undefined ? primary : `${primary} (or ${alias} where that name is still free)`
  return `Use the ${subject} tool to create an image with the configured image model and write it to the workspace. Call it when the current chat model cannot generate images. Pass referenceImages (1–5 complete image references) to edit existing images; omit it to generate a new one. The tool returns the saved file path, not the image bytes.`
}

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const GENERATE_SIZES: readonly string[] = [
  'auto',
  '256x256',
  '512x512',
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
] as const

const GENERATE_QUALITIES: readonly string[] = ['auto', 'low', 'medium', 'high', 'standard', 'hd'] as const

export interface ImageToolHost {
  config: () => Config
  resolveApiKey: (route: string, profile: ProviderProfile) => Promise<string>
  /**
   * Override the idle window of one gateway request. Defaults to
   * {@link IMAGE_TOOL_IDLE_TIMEOUT_MS}; a non-positive value disables the
   * watchdog.
   */
  idleTimeoutMs?: number
  /** Override the bounded `429` retry policy. Defaults to {@link IMAGE_TOOL_RATE_LIMIT_RETRY_POLICY}. */
  rateLimitRetry?: RateLimitRetryPolicy
  /**
   * Override the endpoint cooldown registry. Defaults to the process-wide
   * {@link endpointCooldowns}, which the web-search path shares, so one dead
   * gateway is remembered across both.
   */
  endpointCooldowns?: EndpointCooldownTracker
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  grok: 'Grok',
}

interface ResolvedToolModel {
  route: string
  label: string
  profile: ProviderProfile
  model: string
  baseURL: string
  /** Wire protocol the gateway speaks for this provider group (see DEFAULT_PROTOCOL). */
  api: ApiProtocol
  /** Output cap for the model, used where the wire protocol requires one. */
  maxTokens: number
}

function isProviderKey(value: string): value is ProviderKey {
  return value === 'openai' || value === 'claude' || value === 'grok'
}

function mediaTypeForPath(filePath: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

function mediaTypeFromBytes(data: Uint8Array): ImageMediaType {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
  if (
    data.length >= 12
    && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return 'image/webp'
  return 'image/png'
}

function extensionForMediaType(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return '.png'
  }
}

function decodeDataUrl(value: string): { mediaType: ImageMediaType; data: Uint8Array } | undefined {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim())
  if (match === null) return undefined
  const declared = match[1]!.toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1]!.toLowerCase()
  const mediaType = declared as ImageMediaType
  return { mediaType, data: Buffer.from(match[2]!, 'base64') }
}

function sessionCwd(exec: { agent?: { session: { header: { cwd?: string } } } }): string | undefined {
  return exec.agent?.session.header.cwd
}

function resolveToolModel(config: Config, kind: 'generate'): ResolvedToolModel {
  const ref = config.tools?.[kind]
  const label = '生图'
  const provider = typeof ref?.provider === 'string' ? ref.provider.trim() : ''
  const model = typeof ref?.model === 'string' ? ref.model.trim() : ''
  if (provider.length === 0 || model.length === 0) {
    throw new Error(`sub2api: 未配置${label}模型。打开设置 → Sub2API 模型，为「全局图像工具」指定一个模型后再试`)
  }
  const endpoints = config.endpoints ?? []
  // Endpoint mode: `provider` names one entry's route id, so an image tool can
  // bill a specific key when the gateway holds several keys per platform.
  const endpoint = endpoints.find((entry) => endpointRoute(entry, endpoints) === provider)
  if (endpoint !== undefined) {
    const host = (endpoint.baseURL ?? '').trim().replace(/\/+$/, '') || config.baseURL.trim().replace(/\/+$/, '')
    if (host.length === 0) throw new Error('sub2api: baseURL is not configured')
    if (endpoint.apiKeyEnv === undefined) {
      throw new Error(`sub2api: ${label}模型所在的端点未配置 API key，无法调用${label}模型`)
    }
    const api = endpoint.api ?? apiProtocolForKey(endpoint.platform, endpoint)
    const endpointRoot = api === 'anthropic-messages' ? gatewayAnthropicRoot(host) : gatewayApiRoot(host)
    const endpointModel = endpoint.models?.find((entry) => entry.id === model)
    return {
      route: provider,
      label: endpoint.name?.trim() || PROVIDER_LABELS[endpoint.platform],
      profile: endpoint,
      model,
      baseURL: endpointRoot,
      api,
      maxTokens: endpointModel?.maxTokens ?? DEFAULT_MAX_TOKENS,
    }
  }
  if (!isProviderKey(provider)) {
    throw new Error(`sub2api: ${label}模型的平台 "${provider}" 无效，应为 openai / claude / grok`)
  }
  const baseURL = config.baseURL.trim().replace(/\/+$/, '')
  if (baseURL.length === 0) throw new Error('sub2api: baseURL is not configured')
  const profile = config.providers[provider]
  if (profile.apiKeyEnv === undefined) {
    throw new Error(`sub2api: ${PROVIDER_LABELS[provider]} 未配置 API key，无法调用${label}模型`)
  }
  const catalogModel = profile.models?.find((entry) => entry.id === model)
  // The settings store the bare gateway host; the wire endpoints live under the
  // `/v1` root for OpenAI-style protocols, while the Anthropic SDK appends
  // `/v1/messages` itself and needs the bare host.
  const api = apiProtocolForKey(provider, profile)
  const endpointRoot = api === 'anthropic-messages' ? gatewayAnthropicRoot(baseURL) : gatewayApiRoot(baseURL)
  return {
    route: `sub2api-${provider}`,
    label: PROVIDER_LABELS[provider],
    profile,
    model,
    baseURL: endpointRoot,
    api,
    maxTokens: catalogModel?.maxTokens ?? DEFAULT_MAX_TOKENS,
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const parsed = await response.json() as { error?: { message?: unknown; code?: unknown; type?: unknown } }
    const message = parsed.error?.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch {
    // keep the status fallback
  }
  return `HTTP ${response.status}`
}

async function gatewayFetch(
  host: ImageToolHost,
  resolved: ResolvedToolModel,
  path: string,
  body: Record<string, unknown> | FormData,
  signal: AbortSignal | undefined,
  accept: string,
): Promise<Response> {
  // A gateway that keeps failing is parked before the request is even built, so
  // the caller gets a named reason instead of another full-length stall.
  const cooldowns = host.endpointCooldowns ?? endpointCooldowns
  const parked = cooldowns.check(resolved.baseURL)
  if (parked !== undefined) throw new LlmError(`sub2api: ${parked.message}`, 'TRANSPORT')
  const apiKey = await host.resolveApiKey(resolved.route, resolved.profile)
  const multipart = body instanceof FormData
  let response: Response
  try {
    const outcome = await fetchWithResilience((attemptSignal) => fetch(`${resolved.baseURL}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        // A multipart body must stay unlabelled so fetch appends its own
        // boundary; declaring application/json here would break the edit call.
        ...(multipart ? {} : { 'content-type': 'application/json' }),
        accept,
        ...attributionHeaders(),
      },
      body: multipart ? body : JSON.stringify(body),
      signal: attemptSignal,
    }), {
      signal,
      idleMs: host.idleTimeoutMs ?? IMAGE_TOOL_IDLE_TIMEOUT_MS,
      policy: host.rateLimitRetry ?? IMAGE_TOOL_RATE_LIMIT_RETRY_POLICY,
    })
    response = outcome.response
  } catch (error) {
    // A stalled connection is named as such instead of being folded into the
    // generic transport failure, so a silent gateway is diagnosable.
    if (error instanceof HttpIdleTimeoutError) {
      const note = cooldownNote(cooldowns.recordFailure(resolved.baseURL, TRANSIENT_HTTP_FAILURE))
      throw new LlmError(`sub2api: gateway stopped sending data for ${error.idleMs}ms (idle timeout)${note}`, 'TRANSPORT', { cause: error })
    }
    if (signal?.aborted) throw new LlmError('sub2api: request aborted', 'ABORTED', { cause: error })
    const note = cooldownNote(cooldowns.recordFailure(resolved.baseURL, TRANSIENT_HTTP_FAILURE))
    throw new LlmError(`sub2api: API request to ${resolved.baseURL}${path} failed${note}`, 'TRANSPORT', { cause: error })
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response)
    const note = cooldownNote(
      cooldowns.recordFailure(resolved.baseURL, classifyHttpFailure(response.status, response.headers)),
    )
    throw new Error(`sub2api ${path}: ${detail}${note}`)
  }
  // The gateway answered: whatever it failed with before is history.
  cooldowns.recordSuccess(resolved.baseURL)
  return response
}

async function collectSseText(response: Response): Promise<string> {
  if (response.body === null) throw new Error('sub2api: API returned no response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const idx = buffer.indexOf('\n\n')
        if (idx === -1) break
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLines = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart())
        if (dataLines.length === 0) continue
        const joined = dataLines.join('\n')
        if (joined === '[DONE]') return text
        for (const line of dataLines) {
          if (line === '[DONE]') return text
          let chunk: { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }
          try {
            chunk = JSON.parse(line) as typeof chunk
          } catch {
            continue
          }
          for (const choice of chunk.choices ?? []) {
            const delta = choice.delta?.content ?? choice.message?.content
            if (typeof delta === 'string') text += delta
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // lock already released
    }
  }
  return text
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part !== 'object' || part === null) return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      return ''
    })
    .join('')
}

async function collectChatText(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    const text = (await collectSseText(response)).trim()
    if (text.length === 0) throw new Error('sub2api: image model returned no text')
    return text
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
  const text = flattenMessageContent(payload.choices?.[0]?.message?.content).trim()
  if (text.length === 0) throw new Error('sub2api: image model returned no text')
  return text
}

async function loadRemoteImage(url: string, signal: AbortSignal | undefined, maxBytes: number): Promise<{ mediaType: ImageMediaType; data: Uint8Array }> {
  const encoded = decodeDataUrl(url)
  if (encoded !== undefined) return encoded
  let response: Response
  try {
    const outcome = await fetchWithResilience(
      (attemptSignal) => fetch(url, { method: 'GET', signal: attemptSignal, redirect: 'follow' }),
      { signal, idleMs: IMAGE_TOOL_IDLE_TIMEOUT_MS, policy: IMAGE_TOOL_RATE_LIMIT_RETRY_POLICY },
    )
    response = outcome.response
  } catch (error) {
    if (error instanceof HttpIdleTimeoutError) {
      throw new LlmError(`sub2api: image URL stopped sending data for ${error.idleMs}ms (idle timeout)`, 'TRANSPORT', { cause: error })
    }
    if (signal?.aborted) throw new LlmError('sub2api: request aborted', 'ABORTED', { cause: error })
    throw new Error(`sub2api: failed to download image URL: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`sub2api: image URL returned HTTP ${response.status}`)
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > maxBytes) throw new Error(`sub2api: image URL exceeds ${maxBytes} bytes`)
  const headerType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  const mediaType = headerType === 'image/png' || headerType === 'image/jpeg' || headerType === 'image/webp' || headerType === 'image/gif'
    ? headerType
    : mediaTypeFromBytes(buffer)
  return { mediaType, data: buffer }
}

function extractGeneratedImage(payload: unknown): { data?: Uint8Array; mediaType?: ImageMediaType; url?: string; revisedPrompt?: string } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const items = Array.isArray(record.data) ? record.data : []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const revised = typeof row.revised_prompt === 'string' ? row.revised_prompt : undefined
    if (typeof row.b64_json === 'string' && row.b64_json.length > 0) {
      const data = Buffer.from(row.b64_json, 'base64')
      return { data, mediaType: mediaTypeFromBytes(data), ...(revised !== undefined ? { revisedPrompt: revised } : {}) }
    }
    if (typeof row.url === 'string' && row.url.length > 0) {
      if (row.url.startsWith('data:')) {
        const decoded = decodeDataUrl(row.url)
        if (decoded !== undefined) return { ...decoded, ...(revised !== undefined ? { revisedPrompt: revised } : {}) }
      }
      return { url: row.url, ...(revised !== undefined ? { revisedPrompt: revised } : {}) }
    }
  }
  return undefined
}

function extractImageFromText(text: string): { kind: 'data'; mediaType: ImageMediaType; data: Uint8Array } | { kind: 'url'; url: string } | undefined {
  const dataMatch = /data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+/i.exec(text)
  if (dataMatch !== null) {
    const decoded = decodeDataUrl(dataMatch[0]!)
    if (decoded !== undefined) return { kind: 'data', ...decoded }
  }
  const urlMatch = /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(?:\?\S*)?/i.exec(text)
  if (urlMatch !== null) return { kind: 'url', url: urlMatch[0]!.replace(/[),.;]+$/, '') }
  const markdown = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i.exec(text)
  if (markdown !== null) return { kind: 'url', url: markdown[1]! }
  return undefined
}

/** One entry of the `referenceImages` tool argument (a DSH image reference). */
interface ImageReferenceInput {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number; height: number }
}

interface ResolvedReference {
  data: Uint8Array
  mediaType: ImageMediaType
  name: string
}

/** The slice of the DSH attachment service the edit path needs. */
interface AttachmentService {
  imageLimits?: {
    maxImagesPerMessage?: number
    maxImageBytes?: number
    maxMessageImageBytes?: number
  }
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<{ ref: ImageAttachmentRef; data: Uint8Array }>
}

const MAX_REFERENCE_IMAGES = 5
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ATTACHMENT_ID_PATTERN = /^sha256:[a-f0-9]{64}$/
const INVALID_REFERENCE_MESSAGE = 'sub2api: referenceImages 含有无效引用；请复制完整的图片引用（attachmentId/mediaType/bytes/width/height），本地文件先调用 read_image 读取。不要省略引用重试编辑。'

function getAttachments(ctx: Context): AttachmentService | undefined {
  return (ctx as Context & { get(name: 'attachments'): AttachmentService | undefined }).get('attachments')
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isCompleteReference(value: unknown): value is ImageReferenceInput {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Partial<ImageReferenceInput>
  return typeof ref.attachmentId === 'string'
    && ATTACHMENT_ID_PATTERN.test(ref.attachmentId)
    && typeof ref.mediaType === 'string'
    && IMAGE_MEDIA_TYPES.includes(ref.mediaType as ImageMediaType)
    && isPositiveInteger(ref.bytes)
    && isPositiveInteger(ref.width)
    && isPositiveInteger(ref.height)
}

/**
 * Turn the raw `referenceImages` argument into image bytes.
 *
 * `undefined` means "no references given": the caller then generates a new
 * image. Anything else must resolve to 1–5 complete, distinct references that
 * the DSH attachment service can hand back — an unusable reference is an error,
 * never a silent downgrade to text-to-image.
 */
async function resolveReferenceImages(
  refs: unknown,
  attachments: AttachmentService | undefined,
  signal: AbortSignal | undefined,
): Promise<ResolvedReference[] | undefined> {
  if (refs === undefined) return undefined
  if (attachments === undefined) {
    throw new Error('sub2api: 图片编辑需要 DSH 附件服务；当前会话没有挂载 attachments，无法读取引用图片')
  }
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > MAX_REFERENCE_IMAGES) {
    throw new Error('sub2api: referenceImages 必须是 1–5 张完整图片引用；只有生成新图时才省略该字段，不要用空数组回退到文生图。')
  }
  const limits = attachments.imageLimits
  if (limits?.maxImagesPerMessage !== undefined && refs.length > limits.maxImagesPerMessage) {
    throw new Error(`sub2api: referenceImages 超出 DSH 图片限制（单次最多 ${limits.maxImagesPerMessage} 张）`)
  }
  const seen = new Set<string>()
  const resolved: ResolvedReference[] = []
  let total = 0
  for (const entry of refs) {
    if (!isCompleteReference(entry)) throw new Error(INVALID_REFERENCE_MESSAGE)
    const ref = entry
    if (seen.has(ref.attachmentId)) {
      throw new Error(`sub2api: referenceImages 含有重复图片（${ref.attachmentId}）；每张图片只能引用一次`)
    }
    seen.add(ref.attachmentId)
    if (limits?.maxImageBytes !== undefined && ref.bytes > limits.maxImageBytes) {
      throw new Error(`sub2api: referenceImages 超出 DSH 图片限制（单张最大 ${limits.maxImageBytes} 字节）`)
    }
    total += ref.bytes
    if (limits?.maxMessageImageBytes !== undefined && total > limits.maxMessageImageBytes) {
      throw new Error(`sub2api: referenceImages 超出 DSH 图片限制（合计最大 ${limits.maxMessageImageBytes} 字节）`)
    }
    const mediaType = ref.mediaType as ImageMediaType
    const stored = await attachments.readImage({
      attachmentId: ref.attachmentId,
      mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(typeof ref.name === 'string' && ref.name.length > 0 ? { name: ref.name } : {}),
    } as ImageAttachmentRef, signal)
    const name = typeof ref.name === 'string' && ref.name.length > 0
      ? ref.name
      : `reference-${resolved.length + 1}${extensionForMediaType(mediaType)}`
    resolved.push({ data: stored.data, mediaType, name })
  }
  return resolved
}

function defaultOutputName(mediaType: ImageMediaType): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `generated-${stamp}${extensionForMediaType(mediaType)}`
}

async function writeGeneratedFile(
  ctx: Context,
  exec: { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } },
  toolName: string,
  requestedPath: string | undefined,
  data: Uint8Array,
  mediaType: ImageMediaType,
): Promise<string> {
  const fs = getFs(ctx)
  if (fs === undefined) throw new Error('cannot write generated image: filesystem service is not mounted')
  const cwd = sessionCwd(exec)
  const rawPath = requestedPath !== undefined && requestedPath.trim().length > 0
    ? requestedPath.trim()
    : defaultOutputName(mediaType)
  const withExt = extname(rawPath).length === 0 ? `${rawPath}${extensionForMediaType(mediaType)}` : rawPath
  const target = await fs.resolve(withExt, { ...(cwd !== undefined ? { cwd } : {}), signal: exec.signal })
  if (cwd !== undefined) {
    const root = await fs.resolve('.', { cwd, signal: exec.signal })
    if (!fs.contains(root, target)) {
      throw new Error(`${toolName} can only write inside the session workspace; refused "${target.displayPath}"`)
    }
  }
  const abs = fs.processPath(target)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
  return target.displayPath
}

async function generateViaImagesApi(
  host: ImageToolHost,
  resolved: ResolvedToolModel,
  args: { prompt: string; size?: string; quality?: string },
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<{ data: Uint8Array; mediaType: ImageMediaType; revisedPrompt?: string }> {
  const response = await gatewayFetch(host, resolved, '/images/generations', {
    model: resolved.model,
    prompt: args.prompt,
    n: 1,
    response_format: 'b64_json',
    ...(args.size !== undefined && args.size !== 'auto' ? { size: args.size } : {}),
    ...(args.quality !== undefined && args.quality !== 'auto' ? { quality: args.quality } : {}),
  }, signal, 'application/json')
  const payload: unknown = await response.json()
  const image = extractGeneratedImage(payload)
  if (image === undefined) throw new Error('sub2api: image API returned no image data')
  if (image.data !== undefined && image.mediaType !== undefined) {
    return { data: image.data, mediaType: image.mediaType, ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}) }
  }
  if (image.url !== undefined) {
    const downloaded = await loadRemoteImage(image.url, signal, maxBytes)
    return { ...downloaded, ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}) }
  }
  throw new Error('sub2api: image API returned no image data')
}

/**
 * Edit existing images through the OpenAI-shaped multipart endpoint the
 * gateway exposes. The parts of the multipart body follow the public
 * images/edits contract (`model`, `prompt`, repeated `image[]`).
 */
async function generateViaImagesEdit(
  host: ImageToolHost,
  resolved: ResolvedToolModel,
  prompt: string,
  references: ResolvedReference[],
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<{ data: Uint8Array; mediaType: ImageMediaType; revisedPrompt?: string }> {
  const form = new FormData()
  form.append('model', resolved.model)
  form.append('prompt', prompt)
  for (const reference of references) {
    form.append('image[]', new Blob([reference.data], { type: reference.mediaType }), reference.name)
  }
  const response = await gatewayFetch(host, resolved, '/images/edits', form, signal, 'application/json')
  const payload: unknown = await response.json()
  const image = extractGeneratedImage(payload)
  if (image === undefined) throw new Error('sub2api /images/edits: gateway returned no image data')
  if (image.data !== undefined && image.mediaType !== undefined) {
    return { data: image.data, mediaType: image.mediaType, ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}) }
  }
  if (image.url !== undefined) {
    const downloaded = await loadRemoteImage(image.url, signal, maxBytes)
    return { ...downloaded, ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}) }
  }
  throw new Error('sub2api /images/edits: gateway returned no image data')
}

async function generateViaChat(
  host: ImageToolHost,
  resolved: ResolvedToolModel,
  prompt: string,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<{ data: Uint8Array; mediaType: ImageMediaType; revisedPrompt?: string }> {
  const response = await gatewayFetch(host, resolved, '/chat/completions', {
    model: resolved.model,
    messages: [{
      role: 'user',
      content: `Generate an image for this prompt and return the image itself (as a data URL or a direct image URL), not a description:\n\n${prompt}`,
    }],
    stream: true,
    stream_options: { include_usage: true },
  }, signal, 'text/event-stream')
  const text = await collectChatText(response)
  const extracted = extractImageFromText(text)
  if (extracted === undefined) {
    throw new Error(`sub2api: chat image model did not return image data. Response preview: ${text.slice(0, 240)}`)
  }
  if (extracted.kind === 'data') return { data: extracted.data, mediaType: extracted.mediaType }
  return await loadRemoteImage(extracted.url, signal, maxBytes)
}

export function registerImageTools(ctx: Context, host: ImageToolHost): void {
  ctx.inject(['tools', 'systemPrompt'], (toolCtx) => {
    const tools = toolCtx.tools as unknown as ToolRegistry
    const registered: string[] = []

    const defineImageTool = (name: string) => defineTool({
      name,
      description: 'Generate or edit an image with the configured image model and write it to the workspace. Use this when the current chat model cannot generate images. Pass referenceImages (1–5 complete DSH image references) to edit existing images; an unusable reference is an error and is never replaced by a new generation. Returns the saved file path.',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Image generation prompt.',
        },
        file_path: {
          type: 'string',
          description: 'Workspace path to write. Defaults to generated-<timestamp>.png in the session cwd.',
        },
        size: {
          type: 'string',
          enum: [...GENERATE_SIZES],
          description: 'Requested size when the image API supports it.',
        },
        quality: {
          type: 'string',
          enum: [...GENERATE_QUALITIES],
          description: 'Requested quality when the image API supports it.',
        },
        referenceImages: {
          type: 'array',
          description: 'Ordered DSH image references (1–5) to edit. Copy complete references from a user attachment, a read_image result, or an earlier generated image; a local file must be read with read_image first. Omitting this field generates a new image.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: [...IMAGE_MEDIA_TYPES], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
              originalDimensions: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            model: { type: 'string', required: true },
            mediaType: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
            revisedPrompt: { type: 'string' },
            attachment: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attachmentId: { type: 'string', required: true },
                mediaType: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                name: { type: 'string' },
              },
            },
          },
        },
        render: (_args, value) => {
          const blocks: ContentBlock[] = []
          const attachment = value.attachment
          if (attachment !== undefined && typeof attachment === 'object' && attachment !== null) {
            // Inline the generated image into the tool result so the chat UI
            // renders it (image content blocks render as a gallery, exactly
            // like pasted images). Text blocks are kept alongside so the
            // model still sees the path and metadata on later turns.
            blocks.push({ type: 'image', attachment: attachment as ImageAttachmentRef })
          }
          blocks.push({
            type: 'text',
            text: [
              `<path>${value.path}</path>`,
              '<type>image</type>',
              '<content>',
              `${value.mediaType}, ${value.bytes} bytes, model ${value.model}`,
              value.revisedPrompt !== undefined ? `revised prompt: ${value.revisedPrompt}` : '',
              '</content>',
            ].filter((line) => line.length > 0).join('\n'),
          })
          return blocks
        },
      },
      timeoutMs: DEFAULT_IMAGE_TOOL_TIMEOUT_MS,
      async execute(args, exec) {
        const prompt = args.prompt.trim()
        if (prompt.length === 0) throw new Error('prompt must be a non-empty string')
        const resolved = resolveToolModel(host.config(), 'generate')
        const attachments = getAttachments(ctx)
        const maxBytes = attachments?.imageLimits?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
        const references = await resolveReferenceImages(args.referenceImages, attachments, exec.signal)
        let image: { data: Uint8Array; mediaType: ImageMediaType; revisedPrompt?: string }
        if (references !== undefined) {
          // Editing never falls back to text-to-image: a failed edit must
          // surface, otherwise the references would be silently dropped.
          image = await generateViaImagesEdit(host, resolved, prompt, references, exec.signal, maxBytes)
        } else {
          try {
            image = await generateViaImagesApi(host, resolved, {
              prompt,
              ...(args.size !== undefined ? { size: args.size } : {}),
              ...(args.quality !== undefined ? { quality: args.quality } : {}),
            }, exec.signal, maxBytes)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (!/HTTP 404|HTTP 405|HTTP 501|not found|unknown endpoint|does not exist|not implemented/i.test(message)) throw error
            image = await generateViaChat(host, resolved, prompt, exec.signal, maxBytes)
          }
        }
        const path = await writeGeneratedFile(ctx, exec, name, args.file_path, image.data, image.mediaType)
        // Save the generated bytes as a durable attachment so the tool result
        // can carry an image content block that the chat UI renders inline.
        let attachment: ImageAttachmentRef | undefined
        const attachmentStore = ctx.get('attachments')
        if (attachmentStore !== undefined) {
          try {
            attachment = await attachmentStore.saveImage({
              data: image.data,
              mediaType: image.mediaType,
              ...(path.length > 0 ? { name: basename(path) } : {}),
            })
          } catch {
            // Attachment storage is best-effort: fall back to a text-only
            // result (the workspace file is still there for the model/UI).
            attachment = undefined
          }
        }
        return {
          path,
          model: `${resolved.route}/${resolved.model}`,
          mediaType: image.mediaType,
          bytes: image.data.byteLength,
          ...(image.revisedPrompt !== undefined ? { revisedPrompt: image.revisedPrompt } : {}),
          ...(attachment !== undefined ? { attachment } : {}),
        }
      },
      presentCall(args) {
        return {
          card: 'generic',
          title: `Generate image${args.file_path !== undefined ? ` ${args.file_path}` : ''}`,
          ...(args.file_path !== undefined ? { locations: [{ path: args.file_path }] } : {}),
        }
      },
      presentResult(_args, result) {
        // Show only the image in the UI; the XML text block is for the model and
        // stays in the model-facing content unchanged.
        const imageBlock = result.content.find((b) => b.type === 'image')
        if (imageBlock !== undefined) {
          return { card: 'generic' as const, content: [imageBlock] }
        }
        // No attachment (read-only install fallback): show just the path line.
        const textBlock = result.content.find((b) => b.type === 'text')
        if (textBlock !== undefined && textBlock.type === 'text') {
          const pathLine = textBlock.text.match(/<path>(.*?)<\/path>/)?.[1]
          if (pathLine !== undefined) {
            return { card: 'generic' as const, content: [{ type: 'text', text: pathLine }] }
          }
        }
        return undefined
      },
    })

    const attempt = (name: string): void => {
      if (isToolNameTaken(tools, name)) return
      try {
        toolCtx.tools.register(defineImageTool(name))
      } catch (error) {
        if (!isOwnDuplicateNameError(error, name)) throw error
        return
      }
      registered.push(name)
    }

    attempt(STABLE_IMAGE_TOOL_NAME)
    if (host.config?.()?.tools?.generate?.compatToolName === true) {
      attempt(LEGACY_IMAGE_TOOL_NAME)
    }

    // Rendered lazily so the prompt can only ever name tools this plugin
    // actually registered.
    toolCtx.systemPrompt.section({
      name: IMAGE_TOOL_PROMPT_SECTION,
      order: 119,
      text: () => imageToolPromptText(registered),
    })
  })
}
