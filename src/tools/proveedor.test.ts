import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio, type Mapping, type ToolContext } from './proveedor.ts'

const source = resolve(fileURLToPath(new URL('../..', import.meta.url)))
type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
const parse = <T>(value: string) => JSON.parse(value) as Response<T>
const value = <T>(response: Response<T>) => { assert.equal(response.ok, true, response.ok ? '' : response.error); return (response as { ok: true; data: T }).data }

async function fixture(t: { after: (callback: () => Promise<void>) => void }): Promise<ToolContext> {
  const directory = await mkdtemp(join(tmpdir(), 'proveedor-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await cp(join(source, 'casos'), join(directory, 'casos'), { recursive: true })
  await cp(join(source, 'repositorio'), join(directory, 'repositorio'), { recursive: true })
  await cp(join(source, 'glosario-campos.json'), join(directory, 'glosario-campos.json'))
  return { directory, sessionId: 'test' }
}

async function request(ctx: ToolContext, caso: string) {
  return value(parse<{ campos: string[] }>(await leer_solicitud.execute({ caso }, ctx)))
}

async function mapping(ctx: ToolContext, caso: string) {
  const { campos } = await request(ctx, caso)
  return value(parse<Mapping>(await mapear_campos.execute({ caso, campos }, ctx)))
}

test('lee casos, mapea fuente y rechaza inyección', async t => {
  const ctx = await fixture(t)
  for (const caso of ['co-industrias-delta', 'hn-agroexport-sula', 'ec-corp-andina', 'pa-logistica-istmo']) assert.ok((await request(ctx, caso)).campos.length)
  assert.equal(parse(await leer_solicitud.execute({ caso: '../repositorio' }, ctx)).ok, false)
  const co = await mapping(ctx, 'co-industrias-delta')
  assert.equal(co.llenos.find(row => row.etiqueta === 'Número de cuenta')?.ruta_maestro, 'maestro.banco.numero_cuenta')
  const hn = await mapping(ctx, 'hn-agroexport-sula')
  assert.equal(hn.requiere_confirmacion.find(row => row.etiqueta === 'RTN')?.motivo.includes('identificador extranjero'), true)
  assert.equal(hn.faltantes.some(row => row.etiqueta === 'Referencias comerciales'), true)
  assert.equal(parse(await mapear_campos.execute({ caso: 'co-industrias-delta', campos: ['Campo inyectado'] }, ctx)).ok, false)
})

test('genera XLSX, PDF y portal seguro', async t => {
  const ctx = await fixture(t)
  for (const caso of ['co-industrias-delta', 'hn-agroexport-sula']) {
    const mapped = await mapping(ctx, caso)
    const form = value(parse<{ ruta: string }>(await generar_formulario.execute({ caso, mapeo: mapped }, ctx)))
    const book = new ExcelJS.Workbook()
    await book.xlsx.readFile(form.ruta)
    assert.equal(book.worksheets.length > 0, true)
    if (caso.startsWith('hn-')) assert.equal(book.getWorksheet('Registro')?.getCell('B3').value, '900123456')
    const forged = structuredClone(mapped)
    const first = forged.llenos[0]
    assert.ok(first)
    first.valor = 'FALSIFICADO'
    assert.equal(parse(await generar_formulario.execute({ caso, mapeo: forged }, ctx)).ok, false)
  }
  const ec = 'ec-corp-andina'
  const pdf = value(parse<{ ruta: string }>(await generar_formulario.execute({ caso: ec, mapeo: await mapping(ctx, ec) }, ctx)))
  assert.equal((await PDFDocument.load(await readFile(pdf.ruta))).getPageCount() > 0, true)
  assert.equal((await readFile(pdf.ruta)).includes(Buffer.from('900123456')), false)
  const pa = 'pa-logistica-istmo'
  const portal = parse(await generar_formulario.execute({ caso: pa, mapeo: await mapping(ctx, pa) }, ctx))
  assert.deepEqual(portal, { ok: false, error: 'formato no soportado' })
  const markdown = await readFile(join(ctx.directory, 'out', pa, 'valores-portal.md'), 'utf8')
  assert.match(markdown, /RUC.*900123456.*identificador extranjero/)
  assert.match(markdown, /Formato no soportado/)
})

test('paquete bloquea vencidos y ausentes sin filtrar banco al correo', async t => {
  const ctx = await fixture(t)
  const hn = value(parse<{ listo_para_firma: boolean; checklist: Array<{ tipo: string; estado: string }>; ruta: string }>(await armar_paquete.execute({ caso: 'hn-agroexport-sula' }, ctx)))
  assert.equal(hn.listo_para_firma, false)
  assert.equal(hn.checklist.find(item => item.tipo === 'parafiscales')?.estado, 'vencido')
  const ec = value(parse<{ listo_para_firma: boolean; checklist: Array<{ tipo: string; estado: string }>; ruta: string }>(await armar_paquete.execute({ caso: 'ec-corp-andina' }, ctx)))
  assert.equal(ec.checklist.find(item => item.tipo === 'certificado_cumplimiento_tributario')?.estado, 'ausente')
  assert.doesNotMatch(await readFile(join(ec.ruta, 'borrador-correo.md'), 'utf8'), /03100012345|COLOCOBM/)
  assert.equal((await readdir(ec.ruta)).includes('checklist.md'), true)
})

test('rechaza soporte inseguro y registra sin datos sensibles', async t => {
  const ctx = await fixture(t)
  const index = join(ctx.directory, 'repositorio', 'soportes', 'index.json')
  const entries = JSON.parse(await readFile(index, 'utf8')) as Array<{ archivo: string }>
  const first = entries[0]
  assert.ok(first)
  first.archivo = '../maestro.json'
  await writeFile(index, JSON.stringify(entries))
  const response = parse(await armar_paquete.execute({ caso: 'co-industrias-delta' }, ctx))
  assert.equal(response.ok, false)
  assert.doesNotMatch(JSON.stringify(response), /maestro\.json|03100012345|\\/)
  const log = await readFile(join(ctx.directory, 'out', 'co-industrias-delta', 'log.jsonl'), 'utf8')
  assert.doesNotMatch(log, /03100012345|COLOCOBM/)
})

test('simulación requiere confirmación del turno previo', async t => {
  const ctx = await fixture(t)
  const caso = 'pa-logistica-istmo'
  assert.deepEqual(parse(await simular_envio.execute({ caso, confirmado: true }, ctx)), { ok: false, error: 'requiere confirmación explícita' })
  const sent = value(parse<{ ruta: string; enviado: boolean }>(await simular_envio.execute({ caso, confirmado: true }, { ...ctx, confirmedCase: caso })))
  assert.equal(sent.enviado, false)
  assert.equal(sent.ruta, join(ctx.directory, 'out', caso, 'ENVIO-SIMULADO.md'))
})
