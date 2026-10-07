# SPEC-highlights — Mejores jugadas

Depende de: core, games · Índice: [SPEC.md](SPEC.md)

## Objective
Enlazar a cada partido terminado su vídeo de mejores jugadas y ofrecer un feed de jugadas recientes, reproducibles sin salir de la app.

## Fuente
RSS de YouTube del canal oficial de la NBA: `https://www.youtube.com/feeds/videos.xml?channel_id=<ID>`. **Verificar el `channel_id`** al implementar. Reproducción por embed (`youtube-nocookie.com`). No se descargan ni alojan vídeos.

## Verificado (2026-10-08)
- **Canal oficial de la NBA:** `channel_id` = `UCWJ2lWNubArHWmf3FIHbfcQ` (el feed se titula "NBA"). El feed solo contiene los **15 últimos vídeos** (unas 15 horas en un día normal), así que lo que no se lee a tiempo se pierde: por eso se lee cada 15 min (cada 5 min en la hora posterior a un partido favorito).
- **En pretemporada el canal no publica resúmenes de partido**: los 15 vídeos del día eran Shorts y clips sueltos (14 de 15 eran Shorts) más el "Top 5 jugadas de la noche". Por eso el criterio de ≥ 90 % de partidos enlazados **no se ha podido medir todavía**; hay que comprobarlo con los primeros partidos de temporada regular (Checkpoint E). Si el canal no los publica o no llegan a tiempo, la alternativa es usar los clips "Game Highlights" que ESPN ya etiqueta con ambos equipos (no se pueden embeber: abrirían su página) o la YouTube Data API (necesita clave: se pregunta antes).
- Los títulos de resumen que usa el emparejador (`NUGGETS at JAZZ | FULL GAME HIGHLIGHTS | fecha`, nombres completos, "Sixers", ciudad sola) son los formatos conocidos del canal y los títulos reales de ESPN del 6 de octubre; no son grabaciones del canal, porque hoy no hay ninguno.
- Ciudad sola ("Denver", "Portland"): solo cuenta en resúmenes de partido, y nunca "Los Angeles"/"LA" (dos equipos). En clips sueltos solo se etiqueta por apodo del equipo (con mayúscula) y jugadores que ESPN ya etiquetó.
- El embed usa `youtube-nocookie.com` con `referrerpolicy="strict-origin-when-cross-origin"` (YouTube lo exige). La Content-Security-Policy de T28 debe permitir `frame-src https://www.youtube-nocookie.com` y `img-src` solo propio (las miniaturas pasan por `/api/highlights/:id/thumb`).

## Vinculación vídeo ↔ partido
Los títulos de la NBA siguen el patrón `"<EQUIPO A> vs <EQUIPO B> | Full Game Highlights"` y las jugadas sueltas `"<jugador> ... "`. Regla: vídeo con ambos equipos en el título y publicado dentro de ±36 h del final del partido → se asocia a ese `game_id`. El resto se guarda como jugada suelta y se etiqueta por equipo/jugador como en `news`.

## Modelo
`videos(id, yt_id, title, published_utc, fetched_at, thumb_url, kind full_highlights|clip, game_id NULL, is_short)` y `video_tags(video_id, kind team|player, ref)`. Un resumen que sale antes de que su partido figure como terminado se enlaza en una pasada posterior (durante 7 días). Se purgan vídeos de más de 90 días.

## API
- `GET /api/highlights?team=&limit=&before=` — más recientes primero; `team` admite varios (`MIN,LAL`); `limit` 1-50 (20); devuelve `{ highlights, nextBefore }`. 400 `invalid_query` con el motivo.
- `GET /api/games/:id/highlights` — `{ game, highlights }`, el resumen primero y luego los clips. Un partido sin vídeos da lista vacía (200); un partido desconocido, 404.
- `GET /api/highlights/:id/thumb` — la miniatura servida desde este servidor (se descarga una vez, como las imágenes de noticias; carpeta `highlight-thumbs` junto a la de noticias).

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
