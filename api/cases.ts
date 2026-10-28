import type { IncomingMessage, ServerResponse } from 'node:http'

const cases = [
  { id: 'co-industrias-delta', cliente: 'Industrias Delta S.A.S.', formato: 'xlsx', pais: 'CO' },
  { id: 'ec-corp-andina', cliente: 'Corporación Andina de Servicios S.A.', formato: 'pdf', pais: 'EC' },
  { id: 'hn-agroexport-sula', cliente: 'Agroexport Sula S. de R.L.', formato: 'xlsx', pais: 'HN' },
  { id: 'pa-logistica-istmo', cliente: 'Logística del Istmo S.A.', formato: 'portal', pais: 'PA' }
]

export default function handler(_request: IncomingMessage, response: ServerResponse) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ cases }))
}
