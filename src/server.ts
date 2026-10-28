import { serve } from '@hono/node-server'
import app from './app.ts'

serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000), hostname: process.env.HOST || '127.0.0.1' })
