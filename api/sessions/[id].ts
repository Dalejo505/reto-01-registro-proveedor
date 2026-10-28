import type { IncomingMessage, ServerResponse } from 'node:http'

export default function handler(_request: IncomingMessage, response: ServerResponse) {
  response.statusCode = 404
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ error: 'Sesión no encontrada' }))
}
