import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true, provider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'deterministic-local', model: process.env.ANTHROPIC_API_KEY ? process.env.CLAUDE_MODEL || 'claude-opus-5' : null })
}
