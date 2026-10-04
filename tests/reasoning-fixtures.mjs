export const protocols = ['openai-responses', 'openai-completions', 'anthropic-messages']
export function probeDraft(api = 'openai-responses', candidates = ['low', 'high']) {
  return {endpoint: {baseURL: 'https://fake.test', platform: api === 'anthropic-messages' ? 'claude' : 'openai', api, apiKey: 'fakekey', apiKeyEnv: 'OWN_ONLY'}, model: {id: 'model-a', contextWindow: 128000, maxTokens: 32768}, candidates}
}
export function sseFrames(api, model = 'model-a', text = 'OK', stop = 'stop') {
  if (api === 'openai-responses') {
    const item = {id: 'msg', type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text, annotations: []}]}
    return [
      {type: 'response.created', response: {id: 'resp', status: 'in_progress', model, output: []}},
      {type: 'response.output_item.added', output_index: 0, item: {...item, status: 'in_progress', content: []}},
      {type: 'response.output_text.delta', item_id: 'msg', output_index: 0, content_index: 0, delta: text},
      {type: 'response.output_item.done', output_index: 0, item},
      {type: stop === 'stop' ? 'response.completed' : 'response.incomplete', response: {id: 'resp', status: stop === 'stop' ? 'completed' : 'incomplete', model, output: [item], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}}, incomplete_details: stop === 'stop' ? undefined : {reason: 'max_output_tokens'}}},
    ]
  }
  if (api === 'openai-completions') return [
    {id: 'chat', object: 'chat.completion.chunk', created: 0, model, choices: [{index: 0, delta: {role: 'assistant', content: text}, finish_reason: null}]},
    {id: 'chat', object: 'chat.completion.chunk', created: 0, model, choices: [{index: 0, delta: {}, finish_reason: stop === 'stop' ? 'stop' : 'length'}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}},
    '[DONE]',
  ]
  return [
    {type: 'message_start', message: {id: 'msg', type: 'message', role: 'assistant', model, content: [], usage: {input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}}},
    {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text}},
    {type: 'content_block_stop', index: 0},
    {type: 'message_delta', delta: {stop_reason: stop === 'stop' ? 'end_turn' : 'max_tokens'}, usage: {output_tokens: 1}},
    {type: 'message_stop'},
  ]
}
export function sseResponse(api, frames = sseFrames(api)) {
  return new Response(frames.map(frame => `${typeof frame === 'object' && frame.type ? `event: ${frame.type}\n` : ''}data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}})
}
