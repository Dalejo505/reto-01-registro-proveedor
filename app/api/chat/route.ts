import { NextResponse } from 'next/server'
import { chat } from '../../../src/agent.ts'
import { chatSchema } from '../../../src/contracts.ts'
import { ClaudeAdapter } from '../../../src/llm/claude.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const confirmations = new Set<string>()

export async function POST(request: Request) {
  try {
    const payload = chatSchema.safeParse(await request.json())
    if (!payload.success) return NextResponse.json({ error: 'Mensaje o sesión inválidos' }, { status: 400 })
    if (confirmations.has(payload.data.sessionId) && /^(no\s+confirm|cancelar|seguir\s+revisando|rechazar)/i.test(payload.data.message.trim())) {
      confirmations.delete(payload.data.sessionId)
      return NextResponse.json({ reply: 'Simulación descartada. El paquete queda preparado para revisión; no se envió ningún correo.', toolCalls: [], needsConfirmation: false })
    }
    const key = process.env.ANTHROPIC_API_KEY
    const adapter = key ? new ClaudeAdapter(process.env.CLAUDE_MODEL || 'claude-opus-5', key) : null
    const result = await chat(payload.data.sessionId, payload.data.message, adapter)
    if (result.needsConfirmation) confirmations.add(payload.data.sessionId)
    else confirmations.delete(payload.data.sessionId)
    return NextResponse.json(result)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido'
    return NextResponse.json({ error: 'No se pudo procesar la solicitud.', detail }, { status: 500 })
  }
}
