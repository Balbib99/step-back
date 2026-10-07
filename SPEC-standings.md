# SPEC-standings — Clasificación por conferencia

Depende de: core, games (solo para saber cuándo termina un partido) · Índice: [SPEC.md](SPEC.md)

## Objective
Clasificación actualizada de las conferencias Este y Oeste, con la información que el usuario consulta en Google.

## Fuente
ESPN: `site.api.espn.com/apis/v2/sports/basketball/nba/standings` (ojo: `/apis/v2`, no `/apis/site/v2` como el marcador). Verificado el 2026-10-07.

- Las entradas **no vienen ordenadas**: la posición es la estadística `playoffseed`.
- Las estadísticas se buscan por su `type` (`wins`, `playoffseed`, `lasttengames`...), no por su nombre.
- **En pretemporada ESPN devuelve una tabla de pretemporada** (`seasonType: 1`) calculada con los partidos amistosos, aunque se pida la temporada regular. No es la clasificación oficial. La API lo dice en `seasonType` y la pantalla debe decirlo.
- En pretemporada hay **empates de posición** (varios equipos con el mismo `rank`, p. ej. 5, 5, 5, 5, 9...). En temporada regular el seed es único del 1 al 15.
- `?season=2026` devuelve la temporada pasada completa (útil como fixture real).

## Modelo (SQLite)
`standings(conference, team_id, season, season_type, rank, abbr, name, wins, losses, win_pct, games_behind, streak, home, road, last10, conference_record, division_record, clincher, points_for, points_against, updated_at)`, clave `(conference, team_id)`. Cada descarga **sustituye entera** la tabla de cada conferencia, en una transacción (todo o nada). Si ESPN falla o cambia de formato, se conserva la última tabla buena.

`clincher` (marca de ESPN): `z` mejor récord, `y` título de división, `x` playoffs, `xp` play-in, `pb` plaza de play-in, `e` eliminado.

## API
- `GET /api/standings` → `{ standings: [{ conference: 'east' | 'west', season, seasonType, updatedAt, entries: [...] }] }`, Este primero. Antes de la primera descarga, la lista va vacía (no es un error).
- `GET /api/standings?conference=east|west` → solo esa conferencia (sin distinguir mayúsculas). Otro valor: 400 `invalid_query`.
- Cada entrada: `rank, abbr, name, wins, losses, winPct, gamesBehind, streak, home, road, last10, conferenceRecord, divisionRecord, clincher, pointsFor, pointsAgainst`. Los valores que ESPN escribe como `-` llegan como `null`.

## Tarea `standings:refresh`
Se despierta cada 2 minutos y solo descarga si toca:
- la primera vez, o si la tabla tiene una hora;
- 2 minutos después de que un partido haya terminado desde la última descarga (ESPN tarda un momento en actualizarla);
- cada 5 minutos durante media hora tras terminar un partido, por si ESPN se retrasó.

## Acceptance
- Muestra 15 equipos por conferencia con V-D, %, local/visitante, últimos 10 y racha.
- Zonas de la clasificación (play-off directo 1-6, play-in 7-10, fuera 11-15) solo en temporada regular.
- En pretemporada no inventa datos: dice que es la clasificación de pretemporada.
- Si ESPN falla, se sirve la última tabla y `/api/health` marca la tarea como fallida.
- Tests con fixtures reales (2025-26 completa y la de pretemporada actual) y caso de fuente caída.

## Boundaries
- Never: calcular la clasificación a mano si la fuente la da.
