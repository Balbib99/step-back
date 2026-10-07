# SPEC-news — Noticias

Depende de: core · Índice: [SPEC.md](SPEC.md)

## Objective
Un feed unificado de noticias de la NBA, filtrable por equipo y jugador, con prioridad a los favoritos, mezclando fuentes en inglés y español.

## Fuentes (configurables en `sources.json`)
- ESPN news (`.../basketball/nba/news`).
- RSS: Yahoo Sports NBA, CBS Sports NBA, HoopsHype, r/nba (`.rss`).
- Español: RSS de Gigantes.com (GIGANTESbasket). **Verificar que el feed existe** durante la implementación.
- Cada fuente declara `id`, `name`, `lang`, `url`, `type`. Añadir una fuente no requiere cambiar código.

## Fuentes verificadas (2026-10-07)
| id | Fuente | Dirección | Medio | Notas |
|---|---|---|---|---|
| `espn` | ESPN | `site.api.espn.com/apis/site/v2/sports/basketball/nba/news` | foto de la noticia; los clips (`Media`) son vídeo con miniatura | Etiqueta equipos y jugadores ella misma. Los clips "Game Highlights" llevan ambos equipos. Una pieza con más de 4 equipos (el ranking de los 30) se trata como de la liga. Sin reproductor embebible: el vídeo abre su página. |
| `yahoo` | Yahoo Sports | `sports.yahoo.com/nba/rss/` | primera imagen del texto (`imageFromContent`) | Agrega varios medios (SB Nation, NBC Sports...). Pesa 0.5 MB con artículos completos; de ellos solo se guarda titular, resumen e imagen. Algunas piezas no traen imagen. |
| `cbs` | CBS Sports | `cbssports.com/rss/headlines/nba/` | `<enclosure>` (PNG de 2-3 MB) | ETag soportado. Mezcla algún artículo de otros deportes. |
| `reddit` | r/nba | `reddit.com/r/nba/.rss` (Atom) | `media:thumbnail`, descartando los de 140 px | Se omiten los hilos diarios (`skipTitles`). |
| `gigantes` | Gigantes del Basket | `gigantes.com/nba/feed/` (WordPress) | ninguno | **El feed existe.** `gigantes.com/feed` da todo el baloncesto y esta es la sección NBA (10 piezas). Las imágenes del texto son portadas de revistas, no del artículo, así que no se usan; sacar la `og:image` exigiría descargar cada página. |

No incluidas: **HoopsHype** responde 402 "Access Restricted" a clientes no navegador. Si se quiere, se añade como línea de `sources.json` el día que su feed funcione.

## Modelo
`news_items(id, source_id, url, title, summary, lang, published_utc, fetched_at, media_kind, media_url, embed_url, media_duration_s)` con `url` único para evitar duplicados (`media_kind`: `none | image | video`); `news_tags(news_id, kind team|player, ref)`.

## Etiquetado
- ESPN etiqueta ella misma equipos (por su id) y jugadores: se usan tal cual.
- Resto de fuentes: se buscan en título y resumen los nombres de equipo (apodo del equipo, con mayúscula y palabra completa; alias como "Sixers", "Wolves", "Blazers"; "Magic Johnson" no es Orlando) y los nombres completos de jugadores que ESPN ya ha etiquetado antes (tabla `news_players`, que se limpia con la purga). No se descargan plantillas: el diccionario de jugadores crece solo con lo que ESPN etiqueta.
- Un artículo puede tener varias etiquetas.

## API
- `GET /api/news?team=&player=&lang=&media=&before=&limit=` — más recientes primero. `team` admite varios separados por comas (`MIN,LAL`); `player` es el nombre exacto sin distinguir mayúsculas; `lang` es `en` o `es`; `media=video`; `limit` 1-50 (20 por defecto). Devuelve `{ news, nextBefore }`; `nextBefore` es el `before` de la página siguiente, `null` al final. Parámetro inválido: 400 `invalid_query`.
- `GET /api/news/:id` — 404 si no existe.
- `GET /api/news/:id/image` — la imagen servida desde este servidor: se descarga una vez de su fuente (solo `https` con nombre público, nunca una dirección interna), se comprueba por sus primeros bytes que es una imagen y se guarda en `NEWS_IMAGES_DIR` (por defecto `news-images` junto a la base de datos). 404 si la noticia no tiene imagen; 502 si no se pudo descargar. La página nunca ve la dirección de terceros.

## Tareas programadas
Una tarea por fuente (`news:espn`, `news:yahoo`...), cada 12 minutos, con `ETag`/`If-Modified-Since`: una fuente caída aparece por su nombre en `/api/health` y no afecta a las demás. `news:cleanup` (diaria) purga noticias de más de 90 días con sus imágenes.

## Formato de presentación
Cada noticia se muestra como **post** con el medio (imagen o vídeo) como protagonista, según [docs/design.md](docs/design.md). Fuentes con medio: ESPN (imágenes y vídeos "Game Highlights" ya etiquetados por equipo), r/nba (clips), YouTube (vía `highlights`) y Gigantes (imagen de la web). Las imágenes se sirven desde el propio servidor (caché) y los vídeos se embeben, nunca se alojan.

## Acceptance
- Una noticia con imagen o vídeo en su fuente conserva el medio y se muestra en 16:9; una sin medio se muestra solo con texto.
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
