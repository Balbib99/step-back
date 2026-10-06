# SPEC-core — Servidor, base de datos, tareas y caché

Depende de: — · Lo usan: todos los módulos · Índice: [SPEC.md](SPEC.md)

## Objective
Base común del backend: arranque del servidor, configuración, SQLite, programador de tareas con reintentos, caché HTTP/BD y logs. Define cómo se registra un módulo.

## Contrato
- `registerModule({ id, routes, jobs, migrations })`: cada módulo aporta rutas `/api/<id>`, tareas programadas y migraciones SQL.
- `scheduler.add({ id, every | cron, run, timeoutMs })`: una tarea que falla se reintenta con *backoff* y nunca tumba el proceso. Registra último éxito/error en la tabla `job_runs`.
- `http.get(url, params)`: cliente con `User-Agent` identificable, timeout, reintento y límite de tasa por host.
- `cache`: tabla `kv_cache(key, value, fetched_at, ttl_s)` para respuestas externas y traducciones.
- `GET /api/health`: estado del servidor y última ejecución por tarea (para saber qué fuente está caída).
- `GET /api/config`: zona horaria, equipos favoritos y flags de módulos activos.
- Migraciones SQL numeradas, aplicadas al arrancar, idempotentes.

## Configuración (`.env`)
`PORT`, `DB_PATH`, `TZ_DISPLAY=Europe/Madrid`, `FAVORITE_TEAMS=MIN,LAL,PHI`, `DEEPL_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Se valida con zod al arrancar y falla con mensaje claro si falta algo obligatorio.

## Acceptance
- El servidor arranca, aplica migraciones y responde `GET /api/health` en < 2 s en la Pi.
- Una tarea que lanza error queda registrada en `job_runs` y se reintenta; el resto sigue ejecutándose.
- Dos arranques seguidos no duplican migraciones ni tareas.
- Sin `.env` válido el proceso termina con un mensaje que nombra la variable que falta.
- Cobertura ≥ 80 %.

## Tareas (esbozo)
1. Esqueleto del workspace (`shared`, `server`, `web` vacío), lint, typecheck, Vitest.
2. Config con zod + logger.
3. SQLite + migraciones + `kv_cache` + `job_runs`.
4. Scheduler con reintentos y pruebas con reloj falso.
5. Cliente HTTP con límite de tasa.
6. `/api/health`, `/api/config` y registro de módulos.

## Boundaries
- Ask first: elegir otra librería de BD o de planificación.
- Never: lógica específica de un módulo dentro de `core`.
