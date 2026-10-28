import type { VercelRequest, VercelResponse } from '@vercel/node'
import app from '../src/app.ts'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const origin = `https://${request.headers.host ?? 'localhost'}`
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.body ?? {})
    const honoResponse = await app.fetch(new Request(`${origin}${request.url ?? '/api/health'}`, {
      method: request.method,
      headers: new Headers(Object.entries(request.headers).reduce<Array<[string, string]>>((headers, [key, value]) => {
        if (value !== undefined) headers.push([key, Array.isArray(value) ? value.join(',') : value])
        return headers
      }, [])),
      body
    }))
    response.status(honoResponse.status)
    honoResponse.headers.forEach((value, key) => response.setHeader(key, value))
    response.send(Buffer.from(await honoResponse.arrayBuffer()))
  } catch {
    response.status(500).json({ error: 'No se pudo inicializar la API del registro de proveedores.' })
  }
}
