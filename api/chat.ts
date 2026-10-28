import type { IncomingMessage, ServerResponse } from 'node:http'
import { chatSchema } from '../src/contracts.ts'

type Case = { id: string; formato: 'xlsx' | 'pdf' | 'portal'; cliente: string; pendientes: string[]; soportes: Array<{ tipo: string; estado: string }> }

const cases: Case[] = [
  { id: 'co-industrias-delta', formato: 'xlsx', cliente: 'Industrias Delta S.A.S.', pendientes: [], soportes: [{ tipo: 'camara_comercio', estado: 'vencido' }, { tipo: 'rut', estado: 'vigente' }, { tipo: 'certificacion_bancaria', estado: 'vigente' }, { tipo: 'estados_financieros', estado: 'vigente' }] },
  { id: 'ec-corp-andina', formato: 'pdf', cliente: 'Corporación Andina de Servicios S.A.', pendientes: ['Número de contribuyente especial'], soportes: [{ tipo: 'camara_comercio', estado: 'vencido' }, { tipo: 'rut', estado: 'vigente' }, { tipo: 'certificacion_bancaria', estado: 'vigente' }, { tipo: 'estados_financieros', estado: 'vigente' }, { tipo: 'certificado_cumplimiento_tributario', estado: 'ausente' }] },
  { id: 'hn-agroexport-sula', formato: 'xlsx', cliente: 'Agroexport Sula S. de R.L.', pendientes: ['Referencias comerciales'], soportes: [{ tipo: 'camara_comercio', estado: 'vencido' }, { tipo: 'rut', estado: 'vigente' }, { tipo: 'parafiscales', estado: 'vencido' }] },
  { id: 'pa-logistica-istmo', formato: 'portal', cliente: 'Logística del Istmo S.A.', pendientes: [], soportes: [{ tipo: 'camara_comercio', estado: 'vencido' }, { tipo: 'rut', estado: 'vigente' }] }
]

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
    const selected = cases.find(item => payload.data.message.includes(item.id))
    if (!selected) return json(response, 200, { reply: `Casos disponibles: ${cases.map(item => item.id).join(', ')}. Escribe el identificador exacto del caso para prepararlo.`, toolCalls: [], needsConfirmation: false })
    const invalid = selected.soportes.filter(item => item.estado !== 'vigente')
    const missing = selected.pendientes.length ? `Campos pendientes: ${selected.pendientes.join(', ')}. ` : 'No hay campos obligatorios pendientes. '
    const supports = invalid.length ? `Soportes por revisar: ${invalid.map(item => `${item.tipo} (${item.estado})`).join(', ')}. ` : 'Soportes disponibles vigentes. '
    return json(response, 200, {
      reply: `Paquete preparado para ${selected.id} (${selected.formato}). ${missing}${supports}${selected.formato === 'portal' ? 'Formato portal: carga manual requerida. ' : 'Requiere firma y revisión humana. '}No se ha enviado nada.`,
      toolCalls: ['proveedor_leer_solicitud', 'proveedor_mapear_campos', 'proveedor_generar_formulario', 'proveedor_armar_paquete'].map(name => ({ name, args: { caso: selected.id }, ok: true })),
      needsConfirmation: false,
      summary: { caso: selected.id, formato: selected.formato, faltantes: selected.pendientes, soportes: selected.soportes, listoParaFirma: false, requiereFirma: selected.formato !== 'portal', requiereCargaManual: selected.formato === 'portal' }
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido'
    return json(response, 500, { error: 'No se pudo procesar la solicitud.', detail })
  }
}
