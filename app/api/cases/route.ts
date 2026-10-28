import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cases = [
  { id: 'co-industrias-delta', cliente: 'Industrias Delta S.A.S.', formato: 'xlsx', pais: 'CO' },
  { id: 'ec-corp-andina', cliente: 'Corporación Andina de Servicios S.A.', formato: 'pdf', pais: 'EC' },
  { id: 'hn-agroexport-sula', cliente: 'Agroexport Sula S. de R.L.', formato: 'xlsx', pais: 'HN' },
  { id: 'pa-logistica-istmo', cliente: 'Logística del Istmo S.A.', formato: 'portal', pais: 'PA' }
]

export function GET() {
  return NextResponse.json({ cases })
}
