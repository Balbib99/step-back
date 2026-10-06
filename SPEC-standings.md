# SPEC-standings — Clasificación por conferencia

Depende de: core · Índice: [SPEC.md](SPEC.md)

## Objective
Clasificación actualizada de las conferencias Este y Oeste, con la información que el usuario consulta en Google.

## Fuente
ESPN: `site.api.espn.com/apis/v2/sports/basketball/nba/standings` (verificada el 2026-10-06; devuelve conferencias Este y Oeste).

## Modelo
`standings(season, team_id, conference, rank, wins, losses, pct, games_behind, home, away, last10, streak, updated_at)`.

## API
- `GET /api/standings?conference=east|west` — ordenada por posición.
- Marca visualmente zonas: play-off directo (1-6), play-in (7-10), fuera (11-15).

## Tareas programadas
Cada hora en general; cada 10 min mientras haya partidos acabando. Se recalcula también al marcar un partido `final` en `games`.

## Acceptance
- Muestra 15 equipos por conferencia con V-D, %, diferencia, local/visitante, últimos 10 y racha.
- En pretemporada no inventa datos: muestra el estado vacío o con 0-0 y lo dice.
- Coincide con ESPN en las comprobaciones manuales de contraste.
- Tests con fixture real de ESPN y caso de fuente caída.

## Tareas (esbozo)
1. Adaptador + esquema + fixture.
2. Migración, repo y ruta.
3. Programación y enganche con `games` (partido final).
4. Pruebas.

## Boundaries
- Never: calcular la clasificación a mano si la fuente la da.
