import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { z } from 'zod'

export type ToolContext = { directory: string; sessionId: string; confirmedCase?: string }

type Format = 'xlsx' | 'pdf' | 'portal'
type Scalar = string | number | boolean
type TemplateField = { etiqueta: string; obligatorio: boolean; hoja?: string; celda_etiqueta?: string; celda_valor?: string }
type FilledField = TemplateField & { valor: Scalar; ruta_maestro: string }
type MissingField = TemplateField & { motivo: string }
type ConfirmationField = TemplateField & { valor_propuesto: Scalar; ruta_maestro: string; motivo: string }
export type Mapping = { caso: string; formato: Format; llenos: FilledField[]; faltantes: MissingField[]; requiere_confirmacion: ConfirmationField[] }
type ChecklistItem = { tipo: string; estado: 'vigente' | 'vencido' | 'ausente'; archivo: string | null; vigencia_hasta: string | null }

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const filename = z.string().min(1).refine(value => basename(value) === value && !/[\\/\x00-\x1f:]/.test(value))
const solicitudSchema = z.object({
  id: slug,
  de: z.string().email(),
  para: z.string().email(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string().length(2),
  cliente: z.string(),
  formato: z.enum(['xlsx', 'pdf', 'portal']),
  cuerpo: z.string(),
  adjuntos: z.array(filename)
}).strict()
const cellSchema = z.object({ hoja: z.string(), celda_etiqueta: z.string(), etiqueta: z.string(), celda_valor: z.string() }).strict()
const fieldSchema = z.object({ etiqueta: z.string(), obligatorio: z.boolean() }).strict()
const supportSchema = z.object({ tipo: z.string(), archivo: filename, vigencia_hasta: z.string().nullable(), pais_emisor: z.string(), descripcion: z.string() }).strict()
const templateFieldSchema = z.object({ etiqueta: z.string(), obligatorio: z.boolean(), hoja: z.string().optional(), celda_etiqueta: z.string().optional(), celda_valor: z.string().optional() }).strict()
const scalarSchema = z.union([z.string(), z.number(), z.boolean()])
const mappingSchema = z.object({
  caso: slug,
  formato: z.enum(['xlsx', 'pdf', 'portal']),
  llenos: z.array(templateFieldSchema.extend({ valor: scalarSchema, ruta_maestro: z.string() }).strict()),
  faltantes: z.array(templateFieldSchema.extend({ motivo: z.string() }).strict()),
  requiere_confirmacion: z.array(templateFieldSchema.extend({ valor_propuesto: scalarSchema, ruta_maestro: z.string(), motivo: z.string() }).strict())
}).strict()

const caseArgs = { caso: slug.describe('Nombre de la carpeta del caso en casos/') }
const fieldsArgs = { caso: caseArgs.caso, campos: z.array(z.string()).describe('Etiquetas exactas solicitadas por la plantilla') }
const formArgs = { caso: caseArgs.caso, mapeo: mappingSchema.describe('Mapeo devuelto por proveedor_mapear_campos') }
const sendArgs = { caso: caseArgs.caso, confirmado: z.boolean().describe('Confirmación explícita del usuario en el turno anterior') }

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))
const root = (ctx: ToolContext) => resolve(ctx.directory)
const casePath = (ctx: ToolContext, caso: string) => join(root(ctx), 'casos', slug.parse(caso))
const outPath = (ctx: ToolContext, caso: string) => join(process.env.VERCEL ? '/tmp' : root(ctx), 'out', slug.parse(caso))
const safeMessage = (error: unknown) => error instanceof z.ZodError ? 'datos de entrada o fixture inválidos' : error instanceof Error && error.message.startsWith('regla:') ? error.message.slice(6) : 'no fue posible completar la operación'
const toolName = (name: string) => `proveedor_${name}`

async function appendLog(ctx: ToolContext, caso: string, herramienta: string, ok: boolean, resumen: string) {
  if (!slug.safeParse(caso).success) return
  const dir = outPath(ctx, caso)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'log.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), herramienta: toolName(herramienta), ok, resumen })}\n`, { flag: 'a' })
}

function wrap<A, T>(name: string, fn: (args: A, ctx: ToolContext) => Promise<T>) {
  return async (args: A, ctx: ToolContext): Promise<string> => {
    const candidate = typeof args === 'object' && args !== null && 'caso' in args ? String((args as { caso?: unknown }).caso ?? '') : ''
    try {
      const data = await fn(args, ctx)
      await appendLog(ctx, candidate, name, true, 'operación completada')
      return JSON.stringify({ ok: true, data })
    } catch (error) {
      const message = safeMessage(error)
      await appendLog(ctx, candidate, name, false, message).catch(() => undefined)
      return JSON.stringify({ ok: false, error: message })
    }
  }
}

async function loadCase(ctx: ToolContext, caso: string) {
  const dir = casePath(ctx, caso)
  const solicitud = solicitudSchema.parse(await readJson(join(dir, 'solicitud.json')))
  if (solicitud.id !== caso) throw new Error('regla:el identificador de la solicitud no coincide con el caso')
  const rawFields = solicitud.formato === 'xlsx'
    ? z.array(cellSchema).parse(await readJson(join(dir, 'plantilla-celdas.json')))
    : z.array(fieldSchema).parse(await readJson(join(dir, 'plantilla-campos.json')))
  const campos: TemplateField[] = rawFields.map(field => 'hoja' in field
    ? { etiqueta: field.etiqueta, obligatorio: true, hoja: field.hoja, celda_etiqueta: field.celda_etiqueta, celda_valor: field.celda_valor }
    : field)
  const soportes = z.array(z.string()).parse(await readJson(join(dir, 'soportes-exigidos.json')))
  return { solicitud, campos, soportes }
}

function valueAt(source: Record<string, unknown>, path: string): Scalar | null {
  const value = path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>)[key] : undefined, source)
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
}

async function createMapping(ctx: ToolContext, caso: string, requested?: string[]): Promise<Mapping> {
  const { solicitud, campos } = await loadCase(ctx, caso)
  const selected = requested ? campos.filter(field => requested.includes(field.etiqueta)) : campos
  if (requested && (new Set(requested).size !== requested.length || selected.length !== requested.length)) throw new Error('regla:los campos no coinciden con la plantilla del caso')
  const glossary = z.record(z.string(), z.string()).parse(await readJson(join(root(ctx), 'glosario-campos.json')))
  const master = z.record(z.string(), z.unknown()).parse(await readJson(join(root(ctx), 'repositorio', 'maestro.json')))
  const mapping: Mapping = { caso, formato: solicitud.formato, llenos: [], faltantes: [], requiere_confirmacion: [] }
  for (const field of selected) {
    const path = glossary[field.etiqueta]
    if (!path) {
      mapping.faltantes.push({ ...field, motivo: 'sin equivalencia en el glosario' })
      continue
    }
    const value = valueAt(master, path)
    if (value === null || value === '') {
      mapping.faltantes.push({ ...field, motivo: `sin valor en maestro:${path}` })
      continue
    }
    if (path === 'nit' && solicitud.pais !== 'CO') {
      mapping.requiere_confirmacion.push({ ...field, valor_propuesto: value, ruta_maestro: `maestro.${path}`, motivo: 'identificador extranjero: requiere confirmar equivalencia' })
      continue
    }
    mapping.llenos.push({ ...field, valor: value, ruta_maestro: `maestro.${path}` })
  }
  return mapping
}

async function verifiedMapping(ctx: ToolContext, caso: string, supplied: Mapping) {
  const expected = await createMapping(ctx, caso)
  if (JSON.stringify(mappingSchema.parse(supplied)) !== JSON.stringify(expected)) throw new Error('regla:el mapeo no coincide con la fuente de verdad')
  return expected
}

const display = (value: Scalar | null) => value === null ? '[PENDIENTE]' : String(value)
const md = (value: string) => value.replace(/[|\r\n]/g, ' ')

function rows(mapping: Mapping) {
  const complete = mapping.llenos.map(field => ({ ...field, output: field.valor }))
  const uncertain = mapping.requiere_confirmacion.map(field => ({ ...field, output: field.valor_propuesto }))
  const missing = mapping.faltantes.map(field => ({ ...field, output: null }))
  return [...complete, ...uncertain, ...missing]
}

async function generate(ctx: ToolContext, caso: string, supplied: Mapping) {
  const mapping = await verifiedMapping(ctx, caso, supplied)
  const { solicitud, campos } = await loadCase(ctx, caso)
  const ordered = campos.map(field => rows(mapping).find(row => row.etiqueta === field.etiqueta)!)
  const dir = outPath(ctx, caso)
  await mkdir(dir, { recursive: true })
  if (solicitud.formato === 'portal') {
    const ruta = join(dir, 'valores-portal.md')
    await writeFile(ruta, [`# Valores para portal — ${md(solicitud.cliente)}`, '', 'Formato no soportado. Copie los valores manualmente; no se accedió al portal.', '', '| Campo | Valor | Estado |', '|---|---|---|', ...ordered.map(row => `| ${md(row.etiqueta)} | ${md(display(row.output))} | ${'motivo' in row ? row.motivo : row.output === null ? 'pendiente' : 'listo'} |`)].join('\n'))
    throw new Error('regla:formato no soportado')
  }
  if (solicitud.formato === 'xlsx') {
    const book = new ExcelJS.Workbook()
    for (const row of ordered) {
      const sheet = book.getWorksheet(row.hoja!) ?? book.addWorksheet(row.hoja!)
      sheet.getCell(row.celda_etiqueta!).value = row.etiqueta
      sheet.getCell(row.celda_valor!).value = row.output
    }
    const ruta = join(dir, 'formulario.xlsx')
    await book.xlsx.writeFile(ruta)
    return { ruta, formato: solicitud.formato }
  }
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  let page = pdf.addPage([612, 792])
  let y = 750
  for (const row of ordered) {
    if (y < 50) { page = pdf.addPage([612, 792]); y = 750 }
    const text = `${row.etiqueta}: ${display(row.output)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?')
    page.drawText(text.slice(0, 100), { x: 36, y, font, size: 10 })
    y -= 26
  }
  const ruta = join(dir, 'formulario.pdf')
  await writeFile(ruta, await pdf.save())
  return { ruta, formato: solicitud.formato }
}

async function supportChecklist(ctx: ToolContext, caso: string): Promise<ChecklistItem[]> {
  const { soportes } = await loadCase(ctx, caso)
  const index = z.array(supportSchema).parse(await readJson(join(root(ctx), 'repositorio', 'soportes', 'index.json')))
  const today = new Date().toISOString().slice(0, 10)
  const result: ChecklistItem[] = []
  for (const tipo of soportes) {
    const found = index.find(item => item.tipo === tipo)
    if (!found) { result.push({ tipo, estado: 'ausente', archivo: null, vigencia_hasta: null }); continue }
    try {
      await readFile(join(root(ctx), 'repositorio', 'soportes', found.archivo))
      result.push({ tipo, estado: found.vigencia_hasta && found.vigencia_hasta < today ? 'vencido' : 'vigente', archivo: found.archivo, vigencia_hasta: found.vigencia_hasta })
    } catch {
      result.push({ tipo, estado: 'ausente', archivo: null, vigencia_hasta: found.vigencia_hasta })
    }
  }
  return result
}

async function assemble(ctx: ToolContext, caso: string) {
  const mapping = await createMapping(ctx, caso)
  const { solicitud } = await loadCase(ctx, caso)
  if (solicitud.formato !== 'portal') await generate(ctx, caso, mapping)
  else {
    try { await generate(ctx, caso, mapping) } catch (error) { if (safeMessage(error) !== 'formato no soportado') throw error }
  }
  const checklist = await supportChecklist(ctx, caso)
  const packageDir = join(outPath(ctx, caso), 'paquete')
  await mkdir(packageDir, { recursive: true })
  const sourceForm = join(outPath(ctx, caso), solicitud.formato === 'portal' ? 'valores-portal.md' : solicitud.formato === 'xlsx' ? 'formulario.xlsx' : 'formulario.pdf')
  await copyFile(sourceForm, join(packageDir, basename(sourceForm)))
  for (const item of checklist) if (item.archivo) await copyFile(join(root(ctx), 'repositorio', 'soportes', item.archivo), join(packageDir, item.archivo))
  const checklistPath = join(packageDir, 'checklist.md')
  await writeFile(checklistPath, [`# Checklist — ${caso}`, '', ...checklist.map(item => `- [${item.estado === 'vigente' ? 'x' : ' '}] ${item.tipo}: ${item.estado}${item.vigencia_hasta ? ` (vigencia ${item.vigencia_hasta})` : ''}`), '', '## Campos', ...mapping.faltantes.map(field => `- Faltante: ${field.etiqueta} — ${field.motivo}`), ...mapping.requiere_confirmacion.map(field => `- Por confirmar: ${field.etiqueta} — ${field.motivo}`)].join('\n'))
  const emailPath = join(packageDir, 'borrador-correo.md')
  await writeFile(emailPath, `Para: ${solicitud.de}\nAsunto: Re: ${solicitud.asunto}\n\nBuen día,\n\nAdjuntamos el formulario y los soportes disponibles para el registro solicitado por ${solicitud.cliente}. El paquete requiere revisión y firma humana antes de cualquier envío real.\n`)
  const listo_para_firma = checklist.every(item => item.estado === 'vigente')
  const archivos_copiados = checklist.filter(item => item.archivo).map(item => join(packageDir, item.archivo as string))
  return { ruta: packageDir, listo_para_firma, checklist, formulario: solicitud.formato === 'portal' ? null : join(packageDir, basename(sourceForm)), archivos_copiados, faltantes: mapping.faltantes, requiere_confirmacion: mapping.requiere_confirmacion, archivos: [sourceForm, checklistPath, emailPath] }
}

export const leer_solicitud = {
  description: 'Lee país, cliente, formato, campos y soportes exigidos del caso.',
  args: caseArgs,
  execute: wrap('leer_solicitud', async (args: { caso: string }, ctx) => {
    const { caso } = z.object(caseArgs).strict().parse(args)
    const { solicitud, campos, soportes } = await loadCase(ctx, caso)
    return { pais: solicitud.pais, cliente: solicitud.cliente, formato: solicitud.formato, campos: campos.map(field => field.etiqueta), soportes }
  })
}

export const mapear_campos = {
  description: 'Mapea campos solicitados al maestro con trazabilidad, faltantes e incertidumbres.',
  args: fieldsArgs,
  execute: wrap('mapear_campos', async (args: { caso: string; campos: string[] }, ctx) => {
    const parsed = z.object(fieldsArgs).strict().parse(args)
    return createMapping(ctx, parsed.caso, parsed.campos)
  })
}

export const generar_formulario = {
  description: 'Genera el formulario solicitado usando exclusivamente un mapeo verificado.',
  args: formArgs,
  execute: wrap('generar_formulario', async (args: { caso: string; mapeo: Mapping }, ctx) => {
    const parsed = z.object(formArgs).strict().parse(args)
    return generate(ctx, parsed.caso, parsed.mapeo)
  })
}

export const armar_paquete = {
  description: 'Arma el paquete de formulario, soportes, checklist y borrador de correo.',
  args: caseArgs,
  execute: wrap('armar_paquete', async (args: { caso: string }, ctx) => assemble(ctx, z.object(caseArgs).strict().parse(args).caso))
}

export const simular_envio = {
  description: 'Registra una simulación local únicamente tras confirmación explícita controlada por el servidor.',
  args: sendArgs,
  execute: wrap('simular_envio', async (args: { caso: string; confirmado: boolean }, ctx) => {
    const parsed = z.object(sendArgs).strict().parse(args)
    if (!parsed.confirmado || ctx.confirmedCase !== parsed.caso) throw new Error('regla:requiere confirmación explícita')
    const dir = outPath(ctx, parsed.caso)
    await mkdir(dir, { recursive: true })
    const ruta = join(dir, 'ENVIO-SIMULADO.md')
    await writeFile(ruta, `# Envío simulado\n\nCaso: ${parsed.caso}\nSesión: ${ctx.sessionId}\n\nNo se realizó ninguna acción externa.\n`)
    return { ruta, enviado: false }
  })
}

export const proveedor_leer_solicitud = leer_solicitud
export const proveedor_mapear_campos = mapear_campos
export const proveedor_generar_formulario = generar_formulario
export const proveedor_armar_paquete = armar_paquete
export const proveedor_simular_envio = simular_envio
