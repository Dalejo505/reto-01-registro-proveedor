# Registro de proveedores

Aplicación operativa para leer solicitudes locales, mapearlas contra el maestro, generar XLSX/PDF, preparar soportes y exigir confirmación humana antes de registrar un envío simulado.

## Requisitos e instalación

Node.js 20 o superior.

```bash
npm install
npm --prefix web install
npm run dev
```

El frontend queda en `http://127.0.0.1:5173` y usa el API local en `http://127.0.0.1:3000` mediante proxy de Vite. Es el único comando de desarrollo necesario después de instalar dependencias.

## Variables

Copie `.env.example` a `.env` y configure `ANTHROPIC_API_KEY` para usar Claude mediante el SDK oficial de Anthropic. `CLAUDE_MODEL` usa `claude-opus-5` por defecto. Sin clave, la aplicación sigue operativa en modo determinista y lo informa en la interfaz. La clave nunca se entrega al navegador ni se registra.

## Demo y verificación

```bash
npm run demo
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run demo` limpia `out/`, procesa todos los casos sin LLM y continúa cuando un caso falla. Las salidas se crean únicamente en `out/<caso>/`.

## API

- `GET /api/health` devuelve proveedor y modelo sin claves.
- `GET /api/cases` lista casos disponibles.
- `POST /api/chat` recibe `{ "sessionId": "...", "message": "..." }`.
- `GET /api/sessions/:id` devuelve el historial.
- `GET /api/download/:caso/:file` descarga solo entregables permitidos.

La confirmación se acepta únicamente con el mensaje exacto `Confirmar simulación de envío` cuando la sesión dejó un caso pendiente en el turno anterior.

## Arquitectura

React/Vite y componentes instalados de shadcn/ui consumen una API Hono. `src/agent.ts` separa el ciclo del adaptador Claude con SDK oficial de Anthropic (`src/llm/claude.ts`) y de las herramientas deterministas (`src/tools/proveedor.ts`). El comportamiento vive en `agent/prompt.md` y las reglas en `src/knowledge/registro-proveedor.md`.

## Despliegue

No se realizó despliegue público. El link de prueba es local: `http://127.0.0.1:5173` durante `npm run dev`. Para la entrega final, el repositorio o ZIP debe excluir `node_modules/`, `web/node_modules/`, `out/` y `.env`.
