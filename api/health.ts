import type { IncomingMessage, ServerResponse } from 'node:http'

export default function handler(_request: IncomingMessage, response: ServerResponse) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ ok: true, provider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'deterministic-local', model: process.env.ANTHROPIC_API_KEY ? process.env.CLAUDE_MODEL || 'claude-opus-5' : null }))
}
