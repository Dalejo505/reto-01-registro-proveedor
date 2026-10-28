import 'dotenv/config'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { chat, directory, getSession, listCases } from './agent.ts'
import { chatSchema, sessionIdSchema, slug } from './contracts.ts'
import { ClaudeAdapter } from './llm/claude.ts'

const key = process.env.ANTHROPIC_API_KEY
const model = process.env.CLAUDE_MODEL || 'claude-opus-5'
const adapter = key ? new ClaudeAdapter(model, key) : null
const app = new Hono()
app.get('/api/health', c => c.json({ ok: true, provider: adapter?.provider ?? 'deterministic-local', model: adapter?.model ?? null }))
app.get('/api/cases', async c => {
  const cases = await listCases()
  const previews = await Promise.all(cases.map(async caso => {
    try {
      const request = JSON.parse(await readFile(join(directory, 'casos', caso, 'solicitud.json'), 'utf8'))
      return { id: caso, cliente: typeof request.cliente === 'string' ? request.cliente : caso, formato: ['pdf', 'xlsx', 'portal'].includes(request.formato) ? request.formato : null, pais: typeof request.pais === 'string' ? request.pais : null }
    } catch { return { id: caso, cliente: caso, formato: null, pais: null } }
  }))
  return c.json({ cases: previews })
})
app.get('/api/sessions/:id', c => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Sesión inválida' }, 400)
  const session = getSession(id.data)
  return session ? c.json(session) : c.json({ error: 'Sesión no encontrada' }, 404)
})
const busy = new Set<string>()
app.post('/api/chat', async c => {
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'JSON inválido' }, 400) }
  const parsed = chatSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Mensaje o sesión inválidos' }, 400)
  const { sessionId, message } = parsed.data
  if (busy.has(sessionId)) return c.json({ error: 'Sesión ocupada' }, 409)
  busy.add(sessionId)
  try { return c.json(await chat(sessionId, message, adapter)) }
  catch { return c.json({ error: 'No se pudo procesar la solicitud' }, 500) }
  finally { busy.delete(sessionId) }
})
app.get('/api/download/:caso/:file', async c => {
  const caso = slug.safeParse(c.req.param('caso'))
  const file = c.req.param('file')
  if (!caso.success || !['formulario.xlsx', 'formulario.pdf', 'valores-portal.md', 'checklist.md', 'borrador-correo.md', 'ENVIO-SIMULADO.md'].includes(file)) return c.json({ error: 'Archivo no disponible' }, 404)
  if (!(await listCases()).includes(caso.data)) return c.json({ error: 'Archivo no disponible' }, 404)
  const root = resolve(directory, 'out', caso.data)
  const target = resolve(root, ['checklist.md', 'borrador-correo.md'].includes(file) ? join('paquete', file) : file)
  try {
    const actual = await realpath(target)
    const realRoot = await realpath(root)
    if (!actual.startsWith(realRoot + sep) || !(await stat(actual)).isFile()) return c.json({ error: 'Archivo no disponible' }, 404)
    const data = await readFile(actual)
    const type = file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : file.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
    c.header('Content-Type', type)
    c.header('Content-Disposition', `attachment; filename="${file}"`)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cache-Control', 'no-store')
    return c.body(data)
  } catch { return c.json({ error: 'Archivo no disponible' }, 404) }
})

serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000), hostname: process.env.HOST || '127.0.0.1' })
export default app
