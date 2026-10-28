import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { NextResponse } from 'next/server'
import { slug } from '../../../../../src/contracts.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const allowed = ['formulario.xlsx', 'formulario.pdf', 'valores-portal.md', 'checklist.md', 'borrador-correo.md', 'ENVIO-SIMULADO.md']

export async function GET(_request: Request, context: { params: Promise<{ caso: string; file: string }> }) {
  const { caso: rawCase, file } = await context.params
  const caso = slug.safeParse(rawCase)
  if (!caso.success || !allowed.includes(file)) return NextResponse.json({ error: 'Archivo no disponible' }, { status: 404 })
  const base = resolve(process.env.VERCEL ? '/tmp' : process.cwd(), 'out', caso.data)
  const target = resolve(base, ['checklist.md', 'borrador-correo.md'].includes(file) ? join('paquete', file) : file)
  try {
    const actual = await realpath(target)
    if (!actual.startsWith(base + sep) || !(await stat(actual)).isFile()) return NextResponse.json({ error: 'Archivo no disponible' }, { status: 404 })
    const content = await readFile(actual)
    const type = file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain; charset=utf-8'
    return new NextResponse(content, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch {
    return NextResponse.json({ error: 'Archivo no disponible' }, { status: 404 })
  }
}
