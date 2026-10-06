# SPEC-news — Noticias

Depende de: core · Índice: [SPEC.md](SPEC.md)

## Objective
Un feed unificado de noticias de la NBA, filtrable por equipo y jugador, con prioridad a los favoritos, mezclando fuentes en inglés y español.

## Fuentes (configurables en `sources.json`)
- ESPN news (`.../basketball/nba/news`).
- RSS: Yahoo Sports NBA, CBS Sports NBA, HoopsHype, r/nba (`.rss`).
- Español: RSS de Gigantes.com (GIGANTESbasket). **Verificar que el feed existe** durante la implementación.
- Cada fuente declara `id`, `name`, `lang`, `url`, `type`. Añadir una fuente no requiere cambiar código.

## Modelo
`news_items(id, source_id, url, title, summary, image_url, lang, published_utc, fetched_at)` con `url` único para evitar duplicados; `news_tags(news_id, kind team|player, ref)`.

## Etiquetado
Por coincidencia de nombres de equipos y jugadores plantilla en título/resumen (lista de equipos desde `games`, jugadores desde ESPN rosters). Un artículo puede tener varias etiquetas.

## API
- `GET /api/news?team=&player=&lang=&before=&limit=` — paginación por cursor.
- `GET /api/news/:id`.

## Tareas programadas
Cada 10-15 min por fuente, con respeto a `ETag`/`If-Modified-Since`. Se purgan noticias con más de 90 días.

## Acceptance
- Aparecen noticias de ≥ 4 fuentes distintas, sin duplicados.
- Filtrar por Lakers devuelve solo noticias etiquetadas con LAL.
- Cada tarjeta enlaza a la fuente original y muestra su nombre; el servidor no guarda el artículo completo, solo titular, resumen e imagen.
- Una fuente caída no afecta a las demás.
- Tests con fixtures RSS/Atom reales y duplicados.

## Tareas (esbozo)
1. Lector RSS/Atom genérico + normalización.
2. Adaptador ESPN news.
3. Migración, repo y deduplicación.
4. Etiquetado por equipo y jugador.
5. Rutas y programación.
6. Verificar y añadir el feed de Gigantes.

## Boundaries
- Never: scrapear páginas protegidas o reproducir artículos íntegros.
- Ask first: añadir fuentes que requieran login.
