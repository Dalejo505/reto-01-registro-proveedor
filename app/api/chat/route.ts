import { NextResponse } from 'next/server'
import { chat } from '../../../src/agent.ts'
import { chatSchema } from '../../../src/contracts.ts'
import { ClaudeAdapter } from '../../../src/llm/claude.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const payload = chatSchema.safeParse(await request.json())
    if (!payload.success) return NextResponse.json({ error: 'Mensaje o sesión inválidos' }, { status: 400 })
    const key = process.env.ANTHROPIC_API_KEY
    const adapter = key ? new ClaudeAdapter(process.env.CLAUDE_MODEL || 'claude-opus-5', key) : null
    return NextResponse.json(await chat(payload.data.sessionId, payload.data.message, adapter))
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido'
    return NextResponse.json({ error: 'No se pudo procesar la solicitud.', detail }, { status: 500 })
  }
}
