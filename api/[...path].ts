import { getRequestListener } from '@hono/node-server'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    const { default: app } = await import('../src/app.ts')
    return getRequestListener(app.fetch)(request, response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de inicialización desconocido'
    response.statusCode = 500
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'No se pudo inicializar la API.', detail: message }))
  }
}
