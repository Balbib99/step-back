# Spec: step-back — panel personal de la NBA

Estado: **APROBADO para planificar** (2026-10-06). Mapa de capacidades y preguntas abiertas resueltos. Siguiente fase: plan y tareas (`tasks/plan.md`, `tasks/todo.md`).

## Objective

Una web privada, de solo lectura, que reúne en un solo sitio lo que hoy el usuario consulta en Twitter y Google: calendario y resultados, clasificación por conferencia, noticias de jugadores y equipos y mejores jugadas de cada partido. Con aspecto de noticiero / red social, instalable como PWA en Android y alojada en una Raspberry Pi 5.

- **Usuario:** uno solo (el propietario). Sin registro, sin escritura de contenido, sin cuentas.
- **Favoritos:** Minnesota Timberwolves, Los Angeles Lakers, Philadelphia 76ers (priorizados en portada, calendario y notificaciones).
- **Idioma de la interfaz:** español. Contenido en inglés o español según la fuente; traducción al español a demanda.
- **Alcance v1:** NBA, temporada 2026-27 (pretemporada y temporada regular). Playoffs se contemplan en el modelo de datos pero no son criterio de aceptación.
- **Dirección visual:** La camiseta (ver [docs/design.md](docs/design.md)). Noticias en formato post con imagen o vídeo.
- **Fuera de alcance v1:** X/Twitter (módulo `x-source`, fase 2), apuestas, fantasy, estadísticas avanzadas, otras ligas, multiusuario.

### Fuentes de datos (decididas)

| Contenido | Fuente | Notas |
|---|---|---|
| Calendario, resultados, marcadores en directo, clasificación | API pública no oficial de ESPN (`site.api.espn.com`) | Sin clave. Verificada el 2026-10-06: devuelve temporada 2026-27, pretemporada. Puede cambiar sin aviso, así que se aísla tras un adaptador. |
| Noticias en inglés | ESPN news (misma API) + RSS (Yahoo Sports, CBS Sports, HoopsHype, r/nba) | Titular, resumen y enlace. No se copia el artículo completo. |
| Noticias en español | RSS de GIGANTESbasket / Gigantes.com (URL exacta por verificar) | Pendiente confirmar que el feed existe. |
| Mejores jugadas | RSS de YouTube del canal oficial NBA (`youtube.com/feeds/videos.xml?channel_id=...`) + embed | Se vincula cada vídeo a su partido por título y fecha. |
| Traducción | DeepL API gratuita (crédito único de 1 M de caracteres, según su web actual) | A demanda, con caché en SQLite. |
| X/Twitter | Fuera de v1 (decisión del usuario, 2026-10-07) | PasionBasketNBA solo existe en X; el usuario decide aplazar `x-source` a una v2. Su cuenta en Bluesky está inactiva desde enero de 2025. El formato post de la interfaz sirve ya para cualquier fuente. |

## Capability Map

| Módulo | Responsabilidad | Depende de | Spec |
|---|---|---|---|
| `core` | Servidor, SQLite, programador de tareas, caché, configuración, logs | — | [SPEC-core.md](SPEC-core.md) |
| `games` | Calendario, resultados y partidos en directo | core | [SPEC-games.md](SPEC-games.md) |
| `standings` | Clasificación por conferencia | core, games (ver cuándo termina un partido) | [SPEC-standings.md](SPEC-standings.md) |
| `news` | Noticias por RSS/ESPN con filtro por equipo y jugador | core | [SPEC-news.md](SPEC-news.md) |
| `highlights` | Mejores jugadas por partido | core, games | [SPEC-highlights.md](SPEC-highlights.md) |
| `translation` | Traducir una noticia al español a demanda | core, news | [SPEC-translation.md](SPEC-translation.md) |
| `app-shell` | PWA, diseño desde cero, navegación, portada, favoritos | core | [SPEC-app-shell.md](SPEC-app-shell.md) |
| `push` | Notificaciones Web Push de tus equipos | core, games, app-shell | [SPEC-push.md](SPEC-push.md) |
| `deploy` | Docker ARM64, Caddy, autenticación, copias de seguridad | todos | [SPEC-deploy.md](SPEC-deploy.md) |
| `x-source` | Fase 2: fuente X, desactivada por defecto | news | (no especificado aún) |

Orden de construcción: `core` → `games`, `standings`, `news` → `app-shell` → `highlights`, `translation` → `push` → `deploy`. `x-source` queda para la fase 2.

## Tech Stack

- **Lenguaje:** TypeScript en todo el proyecto, con Node.js 22 LTS.
- **Backend:** Fastify, `better-sqlite3`, `node-cron` (o planificador propio), `fast-xml-parser` para RSS, `web-push`, `zod` para validar respuestas externas.
- **Frontend:** React + Vite + TypeScript, React Router, TanStack Query, Tailwind CSS, `vite-plugin-pwa`. **Diseño visual desde cero** (no se reutiliza nada de NBA Insight).
- **Pruebas:** Vitest (unitarias e integración), Playwright (pocas pruebas e2e del frontend).
- **Despliegue:** un contenedor Docker ARM64 (el servidor sirve API y estáticos) detrás del Caddy existente en la Pi.
- **Sin** PostgreSQL, Python, Express ni cuentas de usuario.

## Commands

Se definirán definitivamente en `core`; el contrato es este (raíz del repo, npm workspaces):

```
Instalar:        npm install
Dev (todo):      npm run dev
Dev servidor:    npm run dev -w server
Dev web:         npm run dev -w web
Build:           npm run build
Tests:           npm test
Tests (watch):   npm test -- --watch
Cobertura:       npm test -- --coverage
Lint:            npm run lint
Tipos:           npm run typecheck
E2E:             npm run e2e -w web
Imagen Docker:   docker buildx build --platform linux/arm64 -t step-back:local .
```

## Project Structure

```
step-back/
├── SPEC.md, SPEC-<modulo>.md   → especificaciones
├── tasks/                      → plan.md y todo.md (fase Plan/Tasks)
├── shared/                     → tipos y esquemas zod compartidos
├── server/
│   ├── src/
│   │   ├── core/               → config, db, scheduler, logger, cache
│   │   ├── modules/<id>/       → un directorio por módulo (games, news, ...)
│   │   │   ├── adapter.ts      → llamada a la fuente externa + validación zod
│   │   │   ├── repo.ts         → acceso a SQLite
│   │   │   ├── routes.ts       → endpoints /api/<id>
│   │   │   └── *.test.ts
│   │   └── index.ts
│   └── test/fixtures/          → respuestas reales grabadas de ESPN/RSS
├── web/
│   ├── src/{pages,components,lib,styles}
│   └── e2e/
├── deploy/                     → Dockerfile, compose, ejemplo de Caddyfile
└── docs/                       → notas operativas
```

## Code Style

TypeScript estricto, módulos ES, funciones pequeñas, sin `any`. Los datos externos se validan con zod en el borde y se transforman a tipos propios; nada de formas de ESPN fuera del adaptador.

```ts
// server/src/modules/games/adapter.ts
const EspnEvent = z.object({
  id: z.string(),
  date: z.string(),
  competitions: z.array(z.object({ competitors: z.array(EspnCompetitor).length(2) })).min(1),
});

export async function fetchScoreboard(date: string): Promise<Game[]> {
  const res = await http.get(`${ESPN}/scoreboard`, { dates: date });
  return z.array(EspnEvent).parse(res.events).map(toGame);
}
```

- Archivos y carpetas en `kebab-case`; tipos en `PascalCase`; funciones y variables en `camelCase`.
- Fechas en ISO 8601 UTC en servidor y BD; conversión a `Europe/Madrid` solo en la interfaz.
- Textos de interfaz en español; código, commits y comentarios en inglés.
- Prettier + ESLint (config estándar de typescript-eslint).

## Testing Strategy

- **Adaptadores:** pruebas unitarias contra *fixtures* reales grabadas (`server/test/fixtures`), no contra la red. Si ESPN cambia el formato, un script de comprobación lo detecta.
- **Repos y rutas:** integración con SQLite en memoria.
- **Programador de tareas:** pruebas con reloj falso.
- **Frontend:** pruebas de componentes con Vitest + Testing Library; 3-5 e2e con Playwright (portada, calendario, clasificación, noticia con traducción, modo offline).
- **Cobertura:** ≥ 80 % en `server/src/modules/*` y `core`; sin umbral rígido en UI.
- **Regla:** cada bug corregido añade una prueba que lo reproduce. Ninguna prueba se borra o se salta sin aprobación.

## Boundaries

- **Always:** validar con zod toda respuesta externa; cachear y no llamar a las fuentes desde el navegador; respetar límites de las fuentes (intervalos mínimos y `User-Agent` identificable); ejecutar `npm test`, `npm run lint` y `npm run typecheck` antes de cada commit; mantener los secretos solo en `.env`.
- **Ask first:** añadir dependencias nuevas; cambiar el esquema de SQLite; cambiar de fuente de datos; activar `x-source`; tocar la configuración de Caddy o del servidor de producción; cualquier gasto (APIs de pago).
- **Never:** commitear claves o cookies; usar la cuenta principal de X para scrapear; copiar artículos completos de terceros; descargar o alojar vídeos (solo embed); exponer la app sin autenticación; borrar o saltar pruebas que fallan sin aprobación.

## Success Criteria (v1)

1. La app se instala como PWA en Android y abre en modo standalone.
2. Muestra el calendario completo de pretemporada y temporada regular 2026-27, con resultados de partidos acabados y marcador de los que están en juego.
3. La clasificación de Este y Oeste coincide con ESPN con un retraso ≤ 15 min en días de partido.
4. La portada destaca primero partidos, noticias y jugadas de Timberwolves, Lakers y 76ers.
5. Cada partido terminado enlaza su vídeo de mejores jugadas cuando existe (≥ 90 % de los partidos terminados en 24 h).
6. Una noticia en inglés se traduce al español con un toque; la traducción se cachea solo 7 días para no gastar cuota.
7. Llega una notificación push al inicio y al final de un partido de un equipo favorito.
8. Con datos ya cargados, la app abre sin conexión mostrando lo último guardado.
9. La app solo es accesible tras autenticación y bajo HTTPS.
10. Si una fuente externa falla, su sección lo indica y el resto sigue funcionando.
11. Corre en la Pi 5 usando < 300 MB de RAM en reposo.

## Open Questions

Resueltas (2026-10-06):
- Zona horaria de visualización: `Europe/Madrid`.
- Dominio: `step-back.duckdns.org`, con `basic_auth` de Caddy.
- Copias: la BD solo guarda datos recuperables de las fuentes, salvo suscripciones push y ajustes (las traducciones son caché de 7 días y no importan). Basta la copia diaria local con rotación de 14 días (`deploy/backup.sh`). La copia fuera de la Pi es opcional.

Pendientes (se verifican al implementar):
1. URL exacta del RSS de Gigantes.com y existencia de feed de PasionBasketNBA (en `news`).
2. `channel_id` exacto del canal oficial de la NBA en YouTube (en `highlights`).
