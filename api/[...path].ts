import { getRequestListener } from '@hono/node-server'
import app from '../src/app.ts'

export default getRequestListener(app.fetch)
