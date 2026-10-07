# Tasks: step-back

Detalle por tarea. Índice y riesgos en [plan.md](plan.md). Tamaño: S = 1-2 archivos, M = 3-5.
Comando de verificación estándar (V): `npm test`, `npm run lint`, `npm run typecheck`.

---

## Phase 1: Foundation (`core`)

- [x] **T1 — Esqueleto del monorepo** (S)
  - Acceptance: workspaces `shared`, `server`, `web`; TypeScript estricto; ESLint, Prettier y Vitest configurados; scripts de `SPEC.md#Commands`.
  - Verify: V pasa con una prueba trivial en `server`.
  - Deps: —  · Files: `package.json`, `tsconfig.base.json`, `eslint.config.js`, `server/package.json`, `shared/package.json`

- [x] **T2 — Configuración validada y logger** (S)
  - Acceptance: `.env` validado con zod; si falta una variable obligatoria el proceso termina nombrándola; `.env.example` sin secretos.
  - Verify: tests de config válida e inválida.
  - Deps: T1 · Files: `server/src/core/config.ts`, `logger.ts`, `.env.example`, tests

- [x] **T3 — SQLite, migraciones, `kv_cache`, `job_runs`** (M)
  - Acceptance: migraciones numeradas e idempotentes al arrancar; tablas `kv_cache` y `job_runs`.
  - Verify: tests con BD en memoria; dos arranques seguidos no duplican nada.
  - Deps: T2 · Files: `server/src/core/db.ts`, `migrations/0001_core.sql`, tests

- [x] **T4 — Cliente HTTP y scheduler** (M)
  - Acceptance: cliente con `User-Agent`, timeout, reintento y límite de tasa por host; scheduler con backoff que registra éxito/error y nunca tumba el proceso.
  - Verify: tests con reloj falso y servidor HTTP simulado; una tarea que lanza error se reintenta y el resto sigue.
  - Deps: T3 · Files: `core/http.ts`, `core/scheduler.ts`, tests

- [x] **T5 — Registro de módulos, `/api/health`, `/api/config`** (M)
  - Acceptance: `registerModule` monta rutas, tareas y migraciones; `/api/health` lista última ejecución por tarea; `/api/config` devuelve zona horaria y favoritos `MIN,LAL,PHI`.
  - Verify: tests de integración; el servidor arranca y responde `/api/health` en < 2 s.
  - Deps: T3, T4 · Files: `core/modules.ts`, `core/routes.ts`, `server/src/index.ts`, `shared/src/config.ts`, tests

### Checkpoint A: Foundation
- [ ] V pasa; el servidor arranca; `curl /api/health` responde; revisión con el usuario.

---

## Phase 2: Primer corte vertical (`games` + `app-shell`)

- [x] **T6 — Dirección visual** (S, documental)
  - Acceptance: `docs/design.md` con paleta, tipografía, componentes clave, tono "noticiero/red social" y 2-3 maquetas estáticas de Hoy, Calendario y Noticias; **aprobado por el usuario**.
  - Verify: el usuario revisa y aprueba (visión previa en el navegador).
  - Deps: — (puede ir en paralelo a T1-T5) · Files: `docs/design.md`, `docs/mockups/*`

- [x] **T7 — Esqueleto de la web** (M)
  - Acceptance: Vite + React + Router + TanStack Query + Tailwind; tema oscuro/claro; layout móvil con navegación inferior (Hoy, Calendario, Clasificación, Noticias, Jugadas); proxy a `/api` en dev.
  - Verify: `npm run dev -w web` carga; test de componente del layout; V pasa.
  - Deps: T1, T6 · Files: `web/src/{main,App}.tsx`, `styles`, `components/Layout.tsx`, `web/vite.config.ts`

- [x] **T8 — Adaptador ESPN de equipos y partidos** (M)
  - Acceptance: esquemas zod para scoreboard y schedule; mapeo a `Game` y `Team`; fixtures reales grabadas (programado, en juego, final, aplazado).
  - Verify: tests del adaptador contra fixtures; sin llamadas de red en tests.
  - Deps: T4 · Files: `modules/games/adapter.ts`, `shared/src/games.ts`, `test/fixtures/espn/*`, tests

- [x] **T9 — Carga de equipos y calendario, rutas** (M)
  - Acceptance: migración `teams` y `games`; carga inicial de toda la temporada 2026-27 sin duplicados; `/api/teams`, `/api/games?date=` y `/api/games?team=&from=&to=`.
  - Verify: tests de integración; contar en la BD real: 30 equipos y calendario de pretemporada + regular.
  - Deps: T5, T8 · Files: `modules/games/{repo,routes,jobs}.ts`, `migrations/0002_games.sql`, tests

- [x] **T10 — Pantalla Calendario** (M)
  - Acceptance: selector de fecha, filtro por equipo y tipo de temporada; tarjeta de partido con escudos; hora en `Europe/Madrid`; estados de carga, vacío y error.
  - Verify: tests de componente; revisión visual en el móvil emulado.
  - Deps: T7, T9 · Files: `web/src/pages/Calendar.tsx`, `components/GameCard.tsx`, `lib/api.ts`, tests

- [x] **T10b — Escudos servidos por el servidor** (S)
  - Acceptance: `GET /api/crests/:abbr.png` devuelve el escudo reducido (~96 px) y cacheado en disco; se descarga de ESPN una sola vez; la web usa esa ruta en vez de la URL de ESPN, así que no se ve ningún disco en blanco al cargar y los escudos funcionan sin conexión. `/api/teams` incluye `crestUrl` de cada equipo.
  - Verify: test del endpoint con ESPN simulado (primera petición descarga, segunda sirve de caché); tamaño de cada escudo < 15 KB.
  - Deps: T9 · Files: `server/src/modules/games/crests.ts`, `web/src/components/TeamCrest.tsx`, tests

- [x] **T11 — Refresco adaptativo y pantalla Hoy** (M)
  - Acceptance: refresco cada 10 min hoy/mañana, 30-60 s durante partidos en juego, 1 h sin partidos; portada con partidos de hoy y favoritos primero; la web se actualiza sola.
  - Verify: tests del scheduler adaptativo con reloj falso; test de ordenación de favoritos.
  - Deps: T9, T10 · Files: `modules/games/jobs.ts`, `web/src/pages/Today.tsx`, tests

### Checkpoint B: Primer corte en local
- [ ] V pasa; calendario real visible; un partido de pretemporada cambia de estado solo; revisión con el usuario.

---

## Phase 3: Esqueleto andante en la Pi (`deploy`, parte 1)

- [x] **T12 — Docker ARM64, compose y Caddyfile** (M)
  - Acceptance: Dockerfile multi-etapa (usuario no root, solo producción), `compose.yaml` con volumen de datos, healthcheck y límite de memoria; `Caddyfile.example` con `basic_auth` para `step-back.duckdns.org`; el servidor sirve los estáticos de `web`.
  - Verify: `docker buildx build --platform linux/arm64` termina; el contenedor responde `/api/health` en local.
  - Deps: T11 · Files: `deploy/Dockerfile`, `deploy/compose.yaml`, `deploy/Caddyfile.example`, `server/src/core/static.ts`

- [x] **T13 — Despliegue real y PWA instalable** (S, con el usuario)
  - Acceptance: accesible por HTTPS en `step-back.duckdns.org`; sin credenciales devuelve 401; manifest mínimo; la app se instala en Android. **Requiere cambios en el Caddy del usuario (preguntar antes).**
  - Hecho en el repositorio (sin Docker disponible hasta llegar a la Pi): manifest con iconos (192, 512 y maskable), service worker vacío para que Android ofrezca instalar, enlace al manifest con `crossorigin="use-credentials"` por la contraseña, y su test. Pendiente en la Pi: construir la imagen, enlazar con Caddy y probar la instalación.
  - Verify: `curl -I` da 401 sin auth y 200 con auth; instalación en el móvil real.
  - Deps: T12 · Files: `web/public/manifest.webmanifest`, iconos, `docs/deploy.md` (borrador)

### Checkpoint C: Desplegado y privado
- [x] Abierta desde el móvil por HTTPS con contraseña; instalada como PWA; revisión con el usuario.

---

## Phase 4: Datos (`standings`, `news`)

- [x] **T14 — Clasificación (servidor)** (M)
  - Acceptance: adaptador ESPN standings con fixture; migración `standings`; `/api/standings?conference=`; refresco cada hora y al terminar un partido.
  - Verify: tests con fixture real; contraste manual con ESPN.
  - Deps: T9 · Files: `modules/standings/{adapter,repo,routes,jobs}.ts`, `migrations/0003_standings.sql`, tests

- [x] **T15 — Pantalla Clasificación** (S)
  - Acceptance: pestañas Este/Oeste, 15 equipos con V-D, %, local/visitante, últimos 10 y racha; zonas de play-off y play-in; favoritos resaltados; estado vacío claro en pretemporada.
  - Verify: tests de componente y revisión visual.
  - Deps: T14, T7 · Files: `web/src/pages/Standings.tsx`, tests

- [ ] **T16 — Lector RSS/Atom y ESPN news** (M)
  - Acceptance: parser genérico RSS/Atom con `ETag`/`If-Modified-Since`; adaptador de ESPN news; normalización a `NewsItem` con `media_kind`, `media_url` y `embed_url` (ESPN Media/Story, RSS media:thumbnail, r/nba); fixtures reales.
  - Verify: tests con fixtures de al menos Yahoo, CBS y Atom de r/nba.
  - Deps: T4 · Files: `modules/news/{rss,espn-adapter}.ts`, `shared/src/news.ts`, fixtures, tests

- [ ] **T17 — Repo, deduplicación y etiquetado** (M)
  - Acceptance: migración `news_items` y `news_tags`; `url` único; etiquetado por equipo y jugador; purga de más de 90 días; `/api/news?team=&player=&lang=&before=&limit=`.
  - Verify: tests con duplicados y etiquetado; filtrar por LAL devuelve solo LAL.
  - Deps: T16, T9 · Files: `modules/news/{repo,tagger,routes,jobs}.ts`, `migrations/0004_news.sql`, tests

- [ ] **T18 — Fuentes configurables y feed de Gigantes** (S)
  - Acceptance: `sources.json` con ≥ 4 fuentes más Gigantes verificado; si no existe feed, se documenta y se propone alternativa; una fuente caída no afecta a las demás.
  - Verify: ejecutar el job real; `job_runs` muestra cada fuente.
  - Deps: T17 · Files: `modules/news/sources.json`, tests

- [ ] **T19 — Pantalla Noticias** (M)
  - Acceptance: feed de posts según `docs/design.md` (banda de equipo con su paleta, fuente, titular, medio 16:9 con imagen o vídeo embebido, enlace al original), filtros de equipo, jugador e idioma, paginación por cursor; favoritos primero en la portada.
  - Verify: tests de componente; revisión visual.
  - Deps: T17, T7 · Files: `web/src/pages/News.tsx`, `components/NewsCard.tsx`, tests

### Checkpoint D: Clasificación y noticias
- [ ] V pasa; despliegue actualizado en la Pi; revisión con el usuario.

---

## Phase 5: Jugadas y traducción

- [ ] **T20 — Adaptador YouTube RSS** (S)
  - Acceptance: verificado el `channel_id` oficial de la NBA; adaptador con fixture; migración `videos`.
  - Verify: tests con fixture real.
  - Deps: T4 · Files: `modules/highlights/{adapter,repo}.ts`, `migrations/0005_videos.sql`, tests

- [ ] **T21 — Emparejador vídeo ↔ partido** (M)
  - Acceptance: título con ambos equipos y publicación a ±36 h del final → `game_id`; resto como jugada suelta etiquetada; manejo de abreviaturas ("76ers", "Sixers").
  - Verify: tests con ≥ 20 títulos reales; ≥ 90 % de partidos terminados enlazados en el entorno real.
  - Deps: T20, T9 · Files: `modules/highlights/matcher.ts`, tests

- [ ] **T22 — Rutas y pantalla Jugadas** (M)
  - Acceptance: `/api/highlights` y `/api/games/:id/highlights`; refresco cada 15 min (5 min tras un partido favorito); embed `youtube-nocookie.com`; "aún sin jugadas" sin error.
  - Verify: tests de rutas; reproducción en el móvil.
  - Deps: T21, T7 · Files: `modules/highlights/{routes,jobs}.ts`, `web/src/pages/Highlights.tsx`, tests

- [ ] **T23 — Pantallas Partido y Equipo** (M)
  - Acceptance: Partido: marcador, estado, jugadas y noticias relacionadas. Equipo: calendario, noticias y jugadas.
  - Verify: tests de componente; navegación desde tarjetas.
  - Deps: T10, T19, T22 · Files: `web/src/pages/{Game,Team}.tsx`, tests

- [ ] **T24 — Traducción DeepL** (M)
  - Acceptance: `POST /api/news/:id/translate`; caché de 7 días en `translations`, borrada con la noticia; contador mensual con aviso al 90 % y bloqueo al 100 %; botón "Traducir" por noticia; no se traduce lo que ya está en español.
  - Verify: tests con cliente DeepL simulado (2.ª petición sin consumo, 429 al límite); prueba manual con la clave real.
  - Deps: T17, T19 · Files: `modules/translation/{client,repo,routes}.ts`, `migrations/0006_translations.sql`, `web/src/components/TranslateButton.tsx`, tests

### Checkpoint E: Todo el contenido
- [ ] V pasa; todas las pantallas con datos reales; revisión con el usuario.

---

## Phase 6: PWA completa y notificaciones

- [ ] **T25 — Service worker y offline** (M)
  - Acceptance: shell precacheada; `/api` con stale-while-revalidate; indicador "sin conexión · actualizado hace X"; manifest con iconos maskable.
  - Verify: prueba en modo avión en el móvil; Lighthouse PWA instalable.
  - Deps: T23 · Files: `web/vite.config.ts` (plugin PWA), `web/src/lib/offline.ts`, manifest, tests

- [ ] **T26 — Ajustes y suscripción push** (M)
  - Acceptance: claves VAPID; `/api/push/subscribe` (POST/DELETE) y `/api/push/settings`; pantalla Ajustes con permiso solicitado solo tras pulsar; configuración por equipo.
  - Verify: tests de rutas; suscripción real desde el móvil.
  - Deps: T25, T5 · Files: `modules/push/{routes,repo}.ts`, `migrations/0007_push.sql`, `web/src/pages/Settings.tsx`, tests

- [ ] **T27 — Detector de eventos y envío** (M)
  - Acceptance: aviso al inicio y final de partidos favoritos (y recordatorio opcional); idempotente con `push_log`; limpia suscripciones caducadas; abrir la notificación lleva al detalle del partido.
  - Verify: tests con proveedor push simulado y reloj falso; prueba real con un partido.
  - Deps: T26, T11 · Files: `modules/push/{detector,sender}.ts`, service worker, tests

### Checkpoint F: Notificaciones en Android
- [ ] Llegan avisos reales de un partido; revisión con el usuario.

---

## Phase 7: Cierre

- [ ] **T28 — Copias, limpieza y cabeceras** (M)
  - Acceptance: `backup.sh` diario con rotación de 14 días y restauración probada; limpieza diaria (noticias > 90 días, traducciones > 7 días); cabeceras HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`; FS del contenedor de solo lectura salvo `/data`.
  - Verify: restaurar en una BD limpia; revisión de cabeceras con `curl -I`.
  - Deps: T24, T27 · Files: `deploy/backup.sh`, `server/src/core/cleanup.ts`, `Caddyfile.example`, tests

- [ ] **T29 — E2E, Lighthouse y rendimiento en la Pi** (M)
  - Acceptance: 3-5 e2e con Playwright; Lighthouse móvil (Perf ≥ 85, A11y ≥ 90); RAM < 300 MB en reposo; revisión de seguridad.
  - Verify: `npm run e2e -w web`; medición con `docker stats`.
  - Deps: T28 · Files: `web/e2e/*`, ajustes menores

- [ ] **T30 — Documentación operativa** (S)
  - Acceptance: `docs/deploy.md` con instalación, actualización, restauración, qué hacer cuando una fuente falla.
  - Verify: otra persona (o tú en un entorno limpio) sigue la guía.
  - Deps: T29 · Files: `docs/deploy.md`, `README.md`

### Checkpoint G: v1 completa
- [ ] Los 11 criterios de éxito de `SPEC.md` cumplidos; revisión final con el usuario.
