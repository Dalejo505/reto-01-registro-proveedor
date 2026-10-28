# Reto 01 — Agente de registro como proveedor

Agente conversacional para que una analista administrativa prepare altas de proveedor a partir de solicitudes y fixtures locales. Lee el caso, mapea campos trazables contra el maestro, genera formularios XLSX/PDF, prepara soportes y solicita confirmación humana antes de cualquier simulación de envío.

## URL desplegada

[https://reto-01-registro-proveedor.vercel.app](https://reto-01-registro-proveedor.vercel.app)

## Entregables oficiales

| Entregable | Ubicación | Estado |
|---|---|---|
| Código TypeScript | `src/`, `app/`, `agent/` | Aplicación Next.js App Router, ciclo conversacional, herramientas Zod y adaptador `@anthropic-ai/sdk`. |
| Demo determinista | `demo.ts` | Recorre los cuatro casos, llama las herramientas directamente y no usa modelo ni API key. |
| Solución técnica | `SOLUCION.md` | Arquitectura, modelo, costos, trade-offs, cobertura de HUs, portal, riesgos y uso de IA. |
| Fixtures intactos | `casos/`, `repositorio/`, `glosario-campos.json` | Solo lectura. Las salidas se generan fuera de estas carpetas. |

## Requisitos

- Node.js 22.x
- Una clave de Anthropic solo para chat con LLM: `ANTHROPIC_API_KEY`

## Instalación y arranque local

```bash
npm install
npm run dev
```

La aplicación queda disponible en `http://127.0.0.1:3000` con la interfaz y las rutas API de Next.js App Router.

## Variables de entorno

Copia `.env.example` como `.env`:

```dotenv
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-opus-5
MAX_TOOL_ITERATIONS=25
SESSION_TOKEN_BUDGET=40000
```

- Sin `ANTHROPIC_API_KEY`, el flujo sigue disponible en modo determinista para demo.
- La clave permanece exclusivamente en el servidor; no se expone en respuestas, frontend, logs ni repositorio.
- En Vercel configura `ANTHROPIC_API_KEY` y, si aplica, `CLAUDE_MODEL` en las variables de entorno del proyecto.

## Verificación

```bash
npm run demo
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run demo` limpia `out/`, procesa todos los casos y continúa si un caso falla. En local las salidas se escriben en `out/<caso>/`. En Vercel se usan archivos temporales bajo `/tmp/out/<caso>/`, porque el filesystem del deployment es de solo lectura.

## API

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/health` | Estado del proveedor y modelo, sin secretos. |
| `GET` | `/api/cases` | Casos de demostración disponibles. |
| `POST` | `/api/chat` | Recibe `{ sessionId, message }`; responde conversación, tool calls y `needsConfirmation`. |
| `GET` | `/api/sessions/:id` | Recupera el historial disponible de la sesión. |
| `GET` | `/api/download/:caso/:file` | Descarga un entregable permitido del caso. |

La confirmación de envío simulado requiere el mensaje exacto `Confirmar simulación de envío`. Las respuestas `No confirmar`, `Cancelar`, `Seguir revisando` o `Rechazar` cierran la solicitud y no generan ninguna acción externa.

## Arquitectura

- `app/`: interfaz Next.js App Router y Route Handlers Node.
- `src/tools/proveedor.ts`: cinco herramientas importables, validadas con Zod y sin excepciones hacia el agente.
- `src/agent.ts`: ciclo, límites de herramientas/tokens, sesiones y compuerta de confirmación.
- `src/llm/claude.ts`: adaptador del SDK oficial `@anthropic-ai/sdk`.
- `agent/prompt.md`: comportamiento del agente.
- `src/knowledge/registro-proveedor.md`: reglas operativas.
- `casos/`, `repositorio/`, `glosario-campos.json`: fuente de verdad de solo lectura.

## Despliegue

El proyecto usa Next.js, detectado automáticamente por Vercel. No se versionan `node_modules/`, `.next/`, `out/`, `.env` ni logs. Para la entrega en ZIP, excluye esos mismos directorios y archivos.
