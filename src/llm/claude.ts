import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { ChatMessage, LlmAdapter, ToolDefinition } from './adapter.ts'

function convertMessages(messages: ChatMessage[]) {
  const system = messages.filter(message => message.role === 'system').map(message => message.content ?? '').join('\n')
  const converted: MessageParam[] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (!message || message.role === 'system') continue
    if (message.role === 'user') {
      converted.push({ role: 'user', content: message.content ?? '' })
      continue
    }
    if (message.role === 'assistant') {
      converted.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
          ...(message.tool_calls ?? []).map(call => ({ type: 'tool_use' as const, id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) as unknown }))
        ]
      })
      continue
    }
    const results: ToolResultBlockParam[] = []
    let cursor = index
    while (cursor < messages.length) {
      const toolMessage = messages[cursor]
      if (!toolMessage || toolMessage.role !== 'tool') break
      results.push({ type: 'tool_result', tool_use_id: toolMessage.tool_call_id ?? '', content: toolMessage.content ?? '' })
      cursor++
    }
    converted.push({ role: 'user', content: results })
    index = cursor - 1
  }
  return { system, messages: converted }
}

function convertTools(tools: ToolDefinition[]): Tool[] {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters as Tool.InputSchema
  }))
}

export class ClaudeAdapter implements LlmAdapter {
  readonly provider = 'anthropic'
  private readonly client: Anthropic

  constructor(readonly model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 })
  }

  async turn(history: ChatMessage[], tools: ToolDefinition[]) {
    const converted = convertMessages(history)
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: converted.system,
        messages: converted.messages,
        tools: convertTools(tools)
      })
      const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('\n') || null
      const toolCalls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use').map(block => ({ id: block.id, type: 'function' as const, function: { name: block.name, arguments: JSON.stringify(block.input) } }))
      return {
        message: { role: 'assistant' as const, content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        usage: { total_tokens: response.usage.input_tokens + response.usage.output_tokens }
      }
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new Error('La API key de Claude no es válida')
      if (error instanceof Anthropic.RateLimitError) throw new Error('Claude alcanzó temporalmente su límite de uso')
      throw new Error('No se pudo completar la respuesta de Claude')
    }
  }
}
