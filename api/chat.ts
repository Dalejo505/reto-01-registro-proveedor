import type { IncomingMessage, ServerResponse } from 'node:http'
import { chat } from '../src/agent.ts'
import { chatSchema } from '../src/contracts.ts'
import { ClaudeAdapter } from '../src/llm/claude.ts'

const busy = new Set<string>()

function json(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(data))
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : null
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Método no permitido' })
  try {
    const payload = chatSchema.safeParse(await body(request))
    if (!payload.success) return json(response, 400, { error: 'Mensaje o sesión inválidos' })
    if (busy.has(payload.data.sessionId)) return json(response, 409, { error: 'Sesión ocupada' })
    busy.add(payload.data.sessionId)
    try {
      const key = process.env.ANTHROPIC_API_KEY
      const adapter = key ? new ClaudeAdapter(process.env.CLAUDE_MODEL || 'claude-opus-5', key) : null
      return json(response, 200, await chat(payload.data.sessionId, payload.data.message, adapter))
    } finally {
      busy.delete(payload.data.sessionId)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido'
    return json(response, 500, { error: 'No se pudo procesar la solicitud.', detail })
  }
}
