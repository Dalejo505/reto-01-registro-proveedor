import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { chat, getSession, listCases } from '../src/agent.ts'
import { chatSchema, sessionIdSchema, slug } from '../src/contracts.ts'
import { ClaudeAdapter } from '../src/llm/claude.ts'

const root = process.cwd()
const key = process.env.ANTHROPIC_API_KEY
const model = process.env.CLAUDE_MODEL || 'claude-opus-5'
const adapter = key ? new ClaudeAdapter(model, key) : null
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
  try {
    const url = new URL(request.url ?? '/', 'https://local')
    const pathname = url.pathname
    if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true, provider: adapter?.provider ?? 'deterministic-local', model: adapter?.model ?? null })
    if (request.method === 'GET' && pathname === '/api/cases') {
      const cases = await listCases()
      const previews = await Promise.all(cases.map(async caso => {
        const source = JSON.parse(await readFile(join(root, 'casos', caso, 'solicitud.json'), 'utf8')) as Record<string, unknown>
        return { id: caso, cliente: typeof source.cliente === 'string' ? source.cliente : caso, formato: ['pdf', 'xlsx', 'portal'].includes(String(source.formato)) ? source.formato : null, pais: typeof source.pais === 'string' ? source.pais : null }
      }))
      return json(response, 200, { cases: previews })
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/)
    if (request.method === 'GET' && sessionMatch) {
      const sessionId = sessionIdSchema.safeParse(sessionMatch[1])
      if (!sessionId.success) return json(response, 400, { error: 'Sesión inválida' })
      const session = getSession(sessionId.data)
      return json(response, session ? 200 : 404, session ?? { error: 'Sesión no encontrada' })
    }
    if (request.method === 'POST' && pathname === '/api/chat') {
      const payload = chatSchema.safeParse(await body(request))
      if (!payload.success) return json(response, 400, { error: 'Mensaje o sesión inválidos' })
      if (busy.has(payload.data.sessionId)) return json(response, 409, { error: 'Sesión ocupada' })
      busy.add(payload.data.sessionId)
      try { return json(response, 200, await chat(payload.data.sessionId, payload.data.message, adapter)) }
      catch { return json(response, 500, { error: 'No se pudo procesar la solicitud' }) }
      finally { busy.delete(payload.data.sessionId) }
    }
    const downloadMatch = pathname.match(/^\/api\/download\/([a-z0-9-]+)\/([^/]+)$/)
    if (request.method === 'GET' && downloadMatch) {
      const caso = slug.safeParse(downloadMatch[1])
      const file = downloadMatch[2]
      const allowed = ['formulario.xlsx', 'formulario.pdf', 'valores-portal.md', 'checklist.md', 'borrador-correo.md', 'ENVIO-SIMULADO.md']
      if (!caso.success || !file || !allowed.includes(file)) return json(response, 404, { error: 'Archivo no disponible' })
      const base = resolve(root, 'out', caso.data)
      const target = resolve(base, ['checklist.md', 'borrador-correo.md'].includes(file) ? join('paquete', file) : file)
      const actual = await realpath(target)
      if (!actual.startsWith(base + sep) || !(await stat(actual)).isFile()) return json(response, 404, { error: 'Archivo no disponible' })
      const content = await readFile(actual)
      response.statusCode = 200
      response.setHeader('Content-Type', file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain; charset=utf-8')
      response.setHeader('Content-Disposition', `attachment; filename="${file}"`)
      return response.end(content)
    }
    return json(response, 404, { error: 'Ruta no encontrada' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido'
    return json(response, 500, { error: 'No se pudo inicializar la API.', detail })
  }
}
