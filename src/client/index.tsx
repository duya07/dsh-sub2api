/**
 * Browser half of dsh-sub2api: registers the settings section.
 *
 * @module dsh-sub2api/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Sub2ApiSettings } from './settings.tsx'
import { GenerateImageToolview } from './toolview.tsx'
import { STABLE_IMAGE_TOOL_NAME } from '../shared/image-tool-names.ts'

export const name = 'dsh-sub2api-client'
export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sub2api-models',
    order: 12,
    label: () => 'Sub2API 模型',
  }, Sub2ApiSettings))

  // Render sub2api_generate_image results as an inline image inside the tool
  // card: the tool result already carries an image content block (durable
  // attachment), and this keyed toolview turns those bytes into an <img>.
  // Only the stable name gets a keyed entry — the opt-in legacy `generate_image`
  // alias deliberately falls back to the generic card instead of competing for
  // another plugin's native entry.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: STABLE_IMAGE_TOOL_NAME,
  }, GenerateImageToolview))
}
