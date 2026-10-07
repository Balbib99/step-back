# SPEC-games — Calendario, resultados y directo

Depende de: core · Índice: [SPEC.md](SPEC.md)

## Objective
Tener todos los partidos de pretemporada y temporada regular 2026-27 con fecha, equipos, estado y marcador, y mantener al día los que se juegan hoy.

## Fuente
ESPN: `site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD` (por día) y `.../teams/{id}/schedule` (por equipo). Respuesta validada con zod; las fixtures grabadas viven en `server/test/fixtures/espn`.

## Modelo (SQLite)
`teams(id, abbr, name, short_name, location, logo_url)` (los colores viven en `shared/src/team-palettes.json`) · `games(id, season, season_type, start_utc, status, home_id, away_id, home_score, away_score, period, clock, venue, updated_at)`.
`status`: `scheduled | live | final | postponed | canceled`. Un partido puede ser contra un equipo que no es de la NBA (pretemporada, p. ej. London Lions), así que `home_id`/`away_id` no llevan clave foránea a `teams` y el nombre del rival se guarda en el propio partido. `season_type`: `preseason | regular | playoffs`.

## API
Los días (`date`, `from`, `to`) son **días locales de la zona configurada** (Europe/Madrid), los mismos que ve la app, no los días de EE. UU. con los que ESPN agrupa su marcador. Un partido de las 19:00 ET entra en el día siguiente de Madrid.

- `GET /api/games?date=YYYY-MM-DD` — partidos de un día.
- `GET /api/games?team=MIN&from=&to=` — calendario de un equipo.
- `GET /api/games/:id` — detalle (marcador por cuarto, líderes si la fuente lo da).
- `GET /api/teams` — los 30 equipos.
- Respuestas: `{ games: Game[] }`, `{ teams: Team[] }` y `Game` (esquemas en `shared/src/games.ts`). Consultas inválidas: 400 `invalid_query`.

## Datos que ESPN publica (comprobado el 2026-10-07)
- Calendario por equipo: 5-6 partidos de pretemporada y **80** de temporada regular (ESPN cuenta 1.206 de 1.230 en total: los que faltan aún no están publicados; la carga semanal y el refresco diario los irán añadiendo).
- Una llamada a `/teams/{id}/schedule` sin `seasontype` solo devuelve la fase actual; por eso se pide cada fase (1, 2 y 3).
- El marcador no acepta rangos de fechas (400).

## Tareas programadas
- Carga inicial: toda la temporada, recorriendo calendarios por equipo (una vez al desplegar y semanalmente).
- Hoy y mañana: cada 10 min. Mientras haya partidos en juego: cada 30 s a 1 min. Sin partidos hoy: cada hora.

## Acceptance
- Tras la carga inicial hay el calendario completo de pretemporada y regular, sin duplicados por reintento.
- Un partido pasa de `scheduled` a `live` a `final` sin intervención y el marcador cambia en ≤ 1 min.
- Un aplazamiento actualiza fecha y estado.
- Si ESPN falla, se sirven los últimos datos y `/api/health` marca la tarea como fallida.
- Tests con fixtures de partido programado, en juego, final y aplazado.

## Tareas (esbozo)
1. Adaptador ESPN + esquemas + fixtures.
2. Migración y repo de `teams` y `games`.
3. Carga inicial de equipos y calendario.
4. Refresco adaptativo (hoy/directo).
5. Rutas y tests de integración.

## Boundaries
- Ask first: añadir una segunda fuente de datos de respaldo (`nba_api`, balldontlie).
- Never: llamar a ESPN desde el navegador.
