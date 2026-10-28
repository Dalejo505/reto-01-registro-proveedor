export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] }
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export type ModelTurn = { message: ChatMessage; usage: { total_tokens: number } }
export interface LlmAdapter {
  provider: string
  model: string
  turn(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelTurn>
}
