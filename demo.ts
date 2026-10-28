import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos } from './src/tools/proveedor.ts'

type Result = { ok: boolean; data?: unknown; error?: string }
const parse = (value: string) => JSON.parse(value) as Result
const directory = process.cwd()

async function main() {
  await rm(join(directory, 'out'), { recursive: true, force: true })
  const cases = (await readdir(join(directory, 'casos'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  let errors = 0
  for (const caso of cases) {
    const ctx = { directory, sessionId: `demo-${caso}` }
    const summary: Record<string, string> = { caso }
    try {
      const request = parse(await leer_solicitud.execute({ caso }, ctx))
      if (!request.ok || !request.data || typeof request.data !== 'object') throw new Error(request.error ?? 'lectura fallida')
      summary.leer_solicitud = 'ok'
      const campos = (request.data as { campos: string[] }).campos
      const mapped = parse(await mapear_campos.execute({ caso, campos }, ctx))
      if (!mapped.ok || !mapped.data) throw new Error(mapped.error ?? 'mapeo fallido')
      summary.mapear_campos = 'ok'
      const form = parse(await generar_formulario.execute({ caso, mapeo: mapped.data as never }, ctx))
      summary.generar_formulario = form.ok ? 'ok' : form.error ?? 'error'
      if (!form.ok && form.error !== 'formato no soportado') errors++
      const pack = parse(await armar_paquete.execute({ caso }, ctx))
      if (!pack.ok) { errors++; summary.armar_paquete = pack.error ?? 'error' } else summary.armar_paquete = 'ok'
    } catch (error) {
      errors++
      summary.error = error instanceof Error ? error.message : 'error desconocido'
    }
    console.log(JSON.stringify(summary))
  }
  console.log(JSON.stringify({ casos: cases.length, errores: errors }))
  if (errors) process.exitCode = 1
}

void main()
