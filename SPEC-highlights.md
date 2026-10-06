# SPEC-highlights — Mejores jugadas

Depende de: core, games · Índice: [SPEC.md](SPEC.md)

## Objective
Enlazar a cada partido terminado su vídeo de mejores jugadas y ofrecer un feed de jugadas recientes, reproducibles sin salir de la app.

## Fuente
RSS de YouTube del canal oficial de la NBA: `https://www.youtube.com/feeds/videos.xml?channel_id=<ID>`. **Verificar el `channel_id`** al implementar. Reproducción por embed (`youtube-nocookie.com`). No se descargan ni alojan vídeos.

## Vinculación vídeo ↔ partido
Los títulos de la NBA siguen el patrón `"<EQUIPO A> vs <EQUIPO B> | Full Game Highlights"` y las jugadas sueltas `"<jugador> ... "`. Regla: vídeo con ambos equipos en el título y publicado dentro de ±36 h del final del partido → se asocia a ese `game_id`. El resto se guarda como jugada suelta y se etiqueta por equipo/jugador como en `news`.

## Modelo
`videos(id, yt_id, title, published_utc, thumb_url, game_id NULL, kind full_highlights|clip)`.

## API
- `GET /api/highlights?team=&limit=&before=`
- `GET /api/games/:id/highlights`

## Tareas programadas
Cada 15 min; cada 5 min en la hora posterior al final de un partido favorito.

## Acceptance
- ≥ 90 % de los partidos terminados tienen su vídeo enlazado en 24 h.
- El embed funciona en Android dentro de la PWA.
- Un partido sin vídeo muestra “aún sin jugadas” y no un error.
- Tests del emparejador con títulos reales (incluidos abreviaturas y nombres como "76ers").

## Tareas (esbozo)
1. Adaptador RSS YouTube + fixture.
2. Emparejador título → partido con tests.
3. Migración, repo, rutas.
4. Programación reforzada tras partidos favoritos.

## Boundaries
- Ask first: usar la YouTube Data API (clave) si el RSS se queda corto.
- Never: descargar vídeos.
