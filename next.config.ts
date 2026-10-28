import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  outputFileTracingIncludes: {
    '/api/chat': ['casos/**/*', 'repositorio/**/*', 'glosario-campos.json', 'agent/**/*', 'src/knowledge/**/*'],
    '/api/download/[caso]/[file]': ['casos/**/*', 'repositorio/**/*', 'glosario-campos.json', 'agent/**/*', 'src/knowledge/**/*']
  }
}

export default nextConfig
