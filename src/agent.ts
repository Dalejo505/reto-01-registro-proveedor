import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio } from './tools/proveedor.ts'
import { confirmText, slug, toolResponse, type ChatReply, type PublicCall } from './contracts.ts'
import type { ChatMessage, LlmAdapter, ToolDefinition } from './llm/adapter.ts'

export const directory = process.cwd()
type Session = { history: Array<{ role: 'user' | 'assistant'; content: string }>; modelHistory: ChatMessage[]; pending: string | null; selected: string | null; tokens: number; last: ChatReply | null }
const sessions = new Map<string, Session>()
const tools = { leer_solicitud, mapear_campos, generar_formulario, armar_paquete }
type ToolName = keyof typeof tools
const names = Object.keys(tools) as ToolName[]
const maxToolIterations = Number.parseInt(process.env.MAX_TOOL_ITERATIONS ?? '25', 10)
const sessionTokenBudget = Number.parseInt(process.env.SESSION_TOKEN_BUDGET ?? '40000', 10)
const toolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'proveedor_leer_solicitud', description: leer_solicitud.description, parameters: { type: 'object', properties: { caso: { type: 'string', description: 'Slug exacto de un caso listado' } }, required: ['caso'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_mapear_campos', description: mapear_campos.description, parameters: { type: 'object', properties: { caso: { type: 'string', description: 'Slug exacto de un caso listado' }, campos: { type: 'array', items: { type: 'string' }, description: 'Etiquetas exactas devueltas por proveedor_leer_solicitud' } }, required: ['caso', 'campos'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_generar_formulario', description: generar_formulario.description, parameters: { type: 'object', properties: { caso: { type: 'string', description: 'Slug exacto de un caso listado' }, mapeo: { type: 'object', description: 'Mapeo devuelto por proveedor_mapear_campos' } }, required: ['caso', 'mapeo'], additionalProperties: false } } },
  { type: 'function', function: { name: 'proveedor_armar_paquete', description: armar_paquete.description, parameters: { type: 'object', properties: { caso: { type: 'string', description: 'Slug exacto de un caso listado' } }, required: ['caso'], additionalProperties: false } } }
]
const safeError = 'No se pudo procesar el caso. Revisa los datos de la solicitud y vuelve a intentar.'
const urls = (caso: string, data: Record<string, unknown>) => {
  const direct = [data.ruta]
  const nested = Array.isArray(data.archivos) ? data.archivos : []
  return [...direct, ...nested].filter((value): value is string => typeof value === 'string').map(value => {
    const name = value.split(/[\\/]/).pop()!
    return ['formulario.xlsx', 'formulario.pdf', 'valores-portal.md', 'checklist.md', 'borrador-correo.md', 'ENVIO-SIMULADO.md'].includes(name) ? `/api/download/${caso}/${encodeURIComponent(name)}` : ''
  }).filter(Boolean)
}

export async function listCases(): Promise<string[]> {
  return (await readdir(join(directory, 'casos'), { withFileTypes: true })).filter(entry => entry.isDirectory() && slug.safeParse(entry.name).success).map(entry => entry.name).sort()
}

export function getSession(id: string) {
  const session = sessions.get(id)
  return session ? { sessionId: id, history: session.history, selectedCase: session.selected, needsConfirmation: !!session.pending, pendingCase: session.pending, tokensUsed: session.tokens, last: session.last } : null
}

async function invoke(name: ToolName | 'simular_envio', caso: string, id: string, confirmed = false, prior?: Record<string, unknown>) {
  let raw: string
  if (name === 'simular_envio') raw = await simular_envio.execute({ caso, confirmado: true }, { directory, sessionId: id, ...(confirmed ? { confirmedCase: caso } : {}) })
  else if (name === 'mapear_campos') {
    const campos = Array.isArray(prior?.campos) ? prior.campos.filter((item): item is string => typeof item === 'string') : []
    raw = await mapear_campos.execute({ caso, campos }, { directory, sessionId: id })
  } else if (name === 'generar_formulario') {
    if (!prior) throw new Error('Mapeo requerido')
    raw = await generar_formulario.execute({ caso, mapeo: prior as never }, { directory, sessionId: id })
  } else if (name === 'leer_solicitud') raw = await leer_solicitud.execute({ caso }, { directory, sessionId: id })
  else raw = await armar_paquete.execute({ caso }, { directory, sessionId: id })
  const result = toolResponse.parse(JSON.parse(raw))
  if (!result.ok) throw new Error(result.error)
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('Respuesta de herramienta inválida')
  const data = result.data as Record<string, unknown>
  if (name === 'mapear_campos' && (!Array.isArray(data.llenos) || !Array.isArray(data.faltantes) || !Array.isArray(data.requiere_confirmacion))) throw new Error('Mapeo inválido')
  if (name === 'armar_paquete' && (!Array.isArray(data.checklist) || typeof data.listo_para_firma !== 'boolean')) throw new Error('Paquete inválido')
  if (name === 'generar_formulario' && typeof data.ruta !== 'string') throw new Error('Formulario inválido')
  if (name === 'simular_envio' && typeof data.ruta !== 'string') throw new Error('Simulación inválida')
  return data
}

function summary(caso: string, mapped: Record<string, unknown> | null, packaged: Record<string, unknown> | null, form: Record<string, unknown> | null) {
  const rows: Array<{ tipo: string; estado: string }> = Array.isArray(packaged?.checklist) ? packaged.checklist : []
  const missing = Array.isArray(mapped?.faltantes) ? mapped.faltantes.map(value => typeof value === 'object' && value !== null && 'etiqueta' in value ? String(value.etiqueta) : String(value)) : []
  const uncertain = Array.isArray(mapped?.requiere_confirmacion) ? mapped.requiere_confirmacion.map(value => typeof value === 'object' && value !== null && 'etiqueta' in value ? String(value.etiqueta) : String(value)) : []
  return { caso, formato: form?.formato ?? mapped?.formato ?? null, faltantes: missing, porConfirmar: uncertain, soportes: rows.map(row => ({ tipo: String(row.tipo), estado: String(row.estado) })), listoParaFirma: packaged?.listo_para_firma === true, requiereFirma: true, requiereCargaManual: mapped?.formato === 'portal' }
}

export async function chat(id: string, message: string, adapter: LlmAdapter | null): Promise<ChatReply> {
  let session = sessions.get(id)
  if (!session) {
    session = { history: [], modelHistory: [], pending: null, selected: null, tokens: 0, last: null }
    sessions.set(id, session)
  }
  session.history.push({ role: 'user', content: message })
  const finish = (response: ChatReply) => {
    session!.last = response
    session!.history.push({ role: 'assistant', content: response.reply })
    return response
  }
  const cases = await listCases()
  if (session.pending && /^(no\s+confirm|cancelar|seguir\s+revisando|rechazar)/i.test(message.trim())) {
    session.pending = null
    return finish({ reply: 'Simulación descartada. El paquete queda preparado para revisión; no se envió ningún correo.', toolCalls: [], needsConfirmation: false, ...(session.last?.summary ? { summary: session.last.summary } : {}), ...(session.last?.files ? { files: session.last.files } : {}) })
  }
  if (session.pending && message === confirmText) {
    const caso = session.pending
    session.pending = null
    try {
      const data = await invoke('simular_envio', caso, id, true)
      return finish({ reply: `Envío simulado para ${caso}. No se envió ningún correo real.`, toolCalls: [{ name: 'simular_envio', args: { caso }, ok: true }], needsConfirmation: false, summary: { caso, estado: 'simulado', enviado: false }, files: urls(caso, data) })
    } catch {
      return finish({ reply: safeError, toolCalls: [{ name: 'simular_envio', args: { caso }, ok: false, error: safeError }], needsConfirmation: false })
    }
  }
  if (session.pending && /confirm|simul|enviar|envío/i.test(message)) return finish({ reply: `Para simular el envío, pulsa «${confirmText}». No se ha enviado nada.`, toolCalls: [], needsConfirmation: true, ...(session.last?.summary ? { summary: session.last.summary } : {}), ...(session.last?.files ? { files: session.last.files } : {}) })
  if (session.pending) session.pending = null
  const mentioned = cases.filter(caso => new RegExp(`(^|[^a-z0-9-])${caso}($|[^a-z0-9-])`, 'i').test(message))
  if (mentioned.length > 1) return finish({ reply: `Indica un solo caso: ${mentioned.join(', ')}.`, toolCalls: [], needsConfirmation: false })
  const selected = mentioned[0] ?? session.selected
  if (!selected) return finish({ reply: `Casos disponibles: ${cases.join(', ')}. Escribe el identificador exacto del caso para preparar el formulario y el paquete.${adapter ? '' : ' Modo sin clave LLM: procesamiento local determinista.'}`, toolCalls: [], needsConfirmation: false })
  session.selected = selected
  const calls: PublicCall[] = []
  const results: Partial<Record<ToolName, Record<string, unknown>>> = {}
  const performed = new Set<ToolName>()
  const run = async (name: ToolName) => {
    try {
      const prior = name === 'mapear_campos' ? results.leer_solicitud : name === 'generar_formulario' ? results.mapear_campos : undefined
      const data = await invoke(name, selected, id, false, prior)
      calls.push({ name: `proveedor_${name}`, args: { caso: selected }, ok: true })
      results[name] = data
      performed.add(name)
      return data
    } catch {
      calls.push({ name: `proveedor_${name}`, args: { caso: selected }, ok: false, error: safeError })
      throw new Error(safeError)
    }
  }
  const deterministic = async (prefix = ''): Promise<ChatReply> => {
    try {
      if (!performed.has('leer_solicitud')) await run('leer_solicitud')
      if (!performed.has('mapear_campos')) await run('mapear_campos')
       if (!performed.has('generar_formulario')) {
         try { await run('generar_formulario') } catch (error) {
           if (results.mapear_campos?.formato !== 'portal') throw error
         }
       }
       if (!performed.has('armar_paquete')) await run('armar_paquete')
      const detail = summary(selected, results.mapear_campos ?? null, results.armar_paquete ?? null, results.generar_formulario ?? null)
      const missing = detail.faltantes.length ? `Campos pendientes: ${detail.faltantes.join(', ')}. ` : 'No hay campos obligatorios pendientes. '
      const invalid = detail.soportes.filter(row => row.estado !== 'vigente')
      const supports = invalid.length ? `Soportes por revisar: ${invalid.map(row => `${row.tipo} (${row.estado})`).join(', ')}. ` : 'Soportes disponibles vigentes. '
      session!.pending = selected
      return finish({ reply: `${prefix}Paquete preparado para ${selected} (${detail.formato}). ${missing}${supports}${detail.requiereFirma ? 'Requiere firma y revisión humana. ' : ''}${detail.requiereCargaManual ? 'Carga manual en portal requerida; no se ingresó al portal. ' : ''}No se ha enviado nada. Pulsa «${confirmText}» solo si deseas simular el envío.`, toolCalls: calls, needsConfirmation: true, summary: detail, files: urls(selected, results.armar_paquete!) })
    } catch {
      return finish({ reply: safeError, toolCalls: calls, needsConfirmation: false })
    }
  }
  if (!adapter) return deterministic('Modo sin clave LLM: procesamiento local determinista. ')
  try {
    if (session.tokens >= sessionTokenBudget) return finish({ reply: 'Límite de tokens de esta sesión alcanzado. Inicia otra sesión.', toolCalls: [], needsConfirmation: false })
    const prompt = await readFile(join(directory, 'agent', 'prompt.md'), 'utf8')
    const knowledge = await readFile(join(directory, 'src', 'knowledge', 'registro-proveedor.md'), 'utf8')
    const context: ChatMessage[] = [{ role: 'system', content: `${prompt}\n${knowledge}\nCasos permitidos: ${cases.join(', ')}. Caso seleccionado: ${selected}. No pidas ni reveles valores sensibles. No simules envíos.` }, ...session.modelHistory, { role: 'user', content: message }]
    let callCount = 0
    for (let turn = 0; turn < maxToolIterations; turn++) {
      const answer = await adapter.turn(context, toolDefinitions)
      session.tokens += answer.usage.total_tokens
      if (session.tokens > sessionTokenBudget) throw new Error('Presupuesto agotado')
      context.push(answer.message)
      if (!answer.message.tool_calls?.length) {
        session.modelHistory = context.slice(1).filter(item => item.role === 'user' || item.role === 'assistant').slice(-20)
        return deterministic()
      }
      callCount += answer.message.tool_calls.length
      if (answer.message.tool_calls.length > 5 || callCount > maxToolIterations) throw new Error('Demasiadas herramientas')
      for (const call of answer.message.tool_calls) {
        const requestedName = call.function.name
        const name = requestedName.replace(/^proveedor_/, '') as ToolName
        if (!names.includes(name)) throw new Error('Herramienta no autorizada')
        const args = z.object({ caso: slug }).passthrough().parse(JSON.parse(call.function.arguments))
        if (args.caso !== selected) throw new Error('Caso no autorizado')
        await run(name)
        const data = results[name]!
        const detail = summary(selected, name === 'mapear_campos' ? data : null, name === 'armar_paquete' ? data : null, name === 'generar_formulario' ? data : null)
        context.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, ...detail }) })
      }
    }
    throw new Error('Límite de turnos')
  } catch {
    return deterministic('El modelo no completó la operación. Se usó procesamiento local. ')
  }
}
