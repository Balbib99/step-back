# Implementation Plan: step-back (panel personal de la NBA)

Especificación: [SPEC.md](../SPEC.md) y `SPEC-<módulo>.md`. Lista de tareas con criterios y verificación: [todo.md](todo.md) (aquí solo el índice por fases).

## Overview

Backend Node/Fastify con SQLite que recoge datos de ESPN, RSS y YouTube, y una PWA React que los muestra. Se construye en **cortes verticales**: cada tarea entrega algo visible y probable de extremo a extremo (servidor + pantalla), en vez de hacer primero todo el backend y luego toda la interfaz.

## Architecture Decisions

- **Monorepo npm workspaces** (`shared`, `server`, `web`): los tipos y esquemas zod se comparten para que el contrato API no se desincronice.
- **Navegador solo habla con `/api`:** las fuentes externas se consultan desde el servidor, con caché y límites de tasa.
- **Adaptadores aislados por fuente** con fixtures grabadas: si ESPN o un RSS cambian, falla un adaptador y una prueba, no la app.
- **SQLite con `better-sqlite3`** y migraciones SQL numeradas.
- **Despliegue temprano ("esqueleto andante"):** se despliega en la Pi tras el primer corte vertical para validar pronto HTTPS con DuckDNS, `basic_auth` e instalación como PWA, que son el mayor riesgo de infraestructura.
- **Diseño antes de pantallas:** `docs/design.md` se aprueba antes de construir la UI definitiva.
- **Cambio respecto al orden del mapa:** el mapa original ponía `app-shell` después de los módulos de datos. Aquí el esqueleto de la web se adelanta, para que cada módulo de datos llegue con su pantalla.
- **Traducciones:** caché de 7 días, borradas con la noticia.

## Task List (índice; detalle en todo.md)

### Phase 1: Foundation (`core`)
- [x] T1 Esqueleto del monorepo, lint, typecheck y Vitest
- [x] T2 Configuración validada y logger
- [x] T3 SQLite, migraciones, `kv_cache` y `job_runs`
- [ ] T4 Cliente HTTP con límite de tasa y scheduler con reintentos
- [ ] T5 Registro de módulos, `/api/health` y `/api/config`

### Checkpoint A: Foundation

### Phase 2: Primer corte vertical y diseño (`games` + `app-shell`)
- [ ] T6 Dirección visual y `docs/design.md` (aprobación del usuario)
- [ ] T7 Esqueleto de la web: Vite, router, TanStack Query, tema, layout y navegación
- [ ] T8 Adaptador ESPN de equipos y partidos con fixtures
- [ ] T9 Carga de equipos y calendario completo, `/api/teams` y `/api/games`
- [ ] T10 Pantalla Calendario
- [ ] T11 Refresco adaptativo (hoy y directo) y pantalla Hoy con favoritos

### Checkpoint B: Primer corte funcionando en local

### Phase 3: Esqueleto andante en la Pi (`deploy`, parte 1)
- [ ] T12 Dockerfile ARM64, compose y Caddyfile con `basic_auth`
- [ ] T13 Despliegue real en `step-back.duckdns.org` y prueba de instalación PWA

### Checkpoint C: Desplegado, privado y accesible desde el móvil

### Phase 4: Datos (`standings`, `news`)
- [ ] T14 Adaptador de clasificación y `/api/standings`
- [ ] T15 Pantalla Clasificación
- [ ] T16 Lector RSS/Atom genérico y adaptador ESPN news
- [ ] T17 Repo de noticias, deduplicación y etiquetado por equipo/jugador
- [ ] T18 Verificar y añadir feed de Gigantes; fuentes en `sources.json`
- [ ] T19 Pantalla Noticias con filtros

### Checkpoint D: Clasificación y noticias funcionando

### Phase 5: Jugadas y traducción (`highlights`, `translation`)
- [ ] T20 Adaptador RSS YouTube y verificación del `channel_id`
- [ ] T21 Emparejador vídeo↔partido con pruebas
- [ ] T22 Rutas de jugadas y pantalla Jugadas con embed
- [ ] T23 Pantalla Partido (detalle) y pantalla Equipo
- [ ] T24 Traducción DeepL con caché de 7 días y botón en Noticias

### Checkpoint E: Todo el contenido disponible

### Phase 6: PWA completa y notificaciones (`app-shell`, `push`)
- [ ] T25 Service worker, offline y manifest definitivo
- [ ] T26 Ajustes y suscripción push
- [ ] T27 Detector de eventos y envío push idempotente

### Checkpoint F: Notificaciones funcionando en Android

### Phase 7: Cierre (`deploy`, parte 2)
- [ ] T28 Copias de seguridad, limpieza diaria y cabeceras de seguridad
- [ ] T29 Pruebas e2e, Lighthouse y revisión de rendimiento en la Pi
- [ ] T30 Documentación operativa

### Checkpoint G: v1 completa

## Parallelization

- Tras T5, la web (T6-T7) y el backend de `games` (T8-T9) pueden hacerse a la vez; comparten el contrato de `shared/`.
- En la fase 4, `standings` y `news` son independientes entre sí.
- `highlights` y `translation` son independientes entre sí una vez existen `games` y `news`.
- Lo que no se paraleliza: migraciones de SQLite y cambios en `shared/`.

## Risks and Mitigations

| Riesgo | Impacto | Mitigación |
|---|---|---|
| ESPN cambia o bloquea su API no oficial | Alto | Adaptador aislado, fixtures y script de comprobación de formato. Segunda fuente (`nba_api`/balldontlie) solo si ocurre, previa consulta. |
| DuckDNS, puertos o certificados no encajan con el Caddy actual | Alto | Despliegue en la fase 3, no al final. Probar HTTP-01 y, si no, plugin de DNS. |
| La PWA no se instala o las push no llegan en Android | Medio | Probar instalación en T13 y push en T26 con el móvil real. |
| El feed RSS de Gigantes no existe | Medio | Verificar en T18. Plan B: otras fuentes en español o web scraping ligero con permiso. |
| Emparejar vídeos con partidos falla | Medio | Pruebas con títulos reales, tolerancia de ±36 h y fallback a jugada suelta. |
| `better-sqlite3` no compila en ARM64 | Medio | Compilar en la imagen ARM64 en T12. Alternativa: `node:sqlite`. |
| Cuota de DeepL | Bajo | Solo a demanda, caché de 7 días y contador. |
| Rendimiento en la Pi | Bajo | Límite de memoria y refresco adaptativo. Medición en T29. |

## Open Questions

- Pendientes de verificar en la implementación: RSS de Gigantes (T18) y `channel_id` de la NBA en YouTube (T20).
- Dirección visual: el usuario la decide en T6.
