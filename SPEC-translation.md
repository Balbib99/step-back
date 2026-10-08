# SPEC-translation — Traducción a demanda

Depende de: core, news · Índice: [SPEC.md](SPEC.md)

## Objective
Un botón por noticia que muestra titular y resumen en español cuando la fuente está en inglés. Nunca traduce automáticamente.

## Proveedor
DeepL API, plan gratuito. **Ojo:** yo había supuesto el antiguo plan Free de 500.000 caracteres *al mes*. La página de DeepL que el usuario ve el 2026-10-08 ofrece un **crédito único de 1 millón de caracteres** (que no se renueva). Por eso la cuota no se cuenta con un contador mensual propio: se consulta a DeepL (`GET /v2/usage` devuelve `character_count` y `character_limit`), que vale igual para un crédito único que para un plan mensual. La clave se guarda en `DEEPL_API_KEY` en el `.env` del servidor y nunca llega al navegador.

## Verificado en la Pi (2026-10-08)
Con la clave real del usuario (plan Developer) el servidor traduce, lee la cuota (`/v2/usage`) y la pantalla la refleja: una noticia de los Lakers gastó 209 caracteres (de 1.000.000), unas 4.800 noticias de crédito.

## API
- `POST /api/news/:id/translate` → `{ title, summary, cached: boolean }`. Errores, siempre `{ error, message }` con el mensaje en español: 404 `not_found`, 400 `already_spanish`, 429 `quota_exceeded` (crédito agotado; no se llama a DeepL), 502 `translation_failed` (DeepL caído o clave rechazada), 503 `translation_disabled` (sin `DEEPL_API_KEY`). Una traducción ya hecha se sirve aunque el crédito esté agotado.
- `GET /api/translation/status` → `{ enabled, used, limit, percent, blocked }`, leído de DeepL y guardado 5 minutos (y sumando lo gastado). La pantalla lo usa para desactivar el botón y avisar desde el 90 %.
- Dirección de DeepL: por la clave (`:fx` → `api-free.deepl.com`, otra → `api.deepl.com`), o la de `DEEPL_API_URL` si se define.
- Tarea `translation:quota` (cada 6 h): falla desde el 90 % del crédito, así `/api/health` pasa a `degraded` y dice cuánto queda. `translation:cleanup` (diaria) borra traducciones de más de 7 días.
- Caché de corta duración: la traducción se guarda en `translations(news_id, lang, title, summary, created_at)` solo para no gastar cuota si se vuelve a pulsar o se recarga la noticia. Se borra a los 7 días y siempre junto con la noticia al purgarse. No es un archivo de traducciones.

## Reglas
- Solo se traduce al pulsar el botón; se omite si `lang = es`.
- La cuota se lee de DeepL (`/v2/usage`), no de un contador propio. Al llegar al 90 % se avisa en `/api/health`; al 100 % se desactiva el botón con un mensaje claro. Solo se traducen titular y resumen (unos 200-400 caracteres por noticia), no el artículo, y solo al pulsar: 1 millón de caracteres dan para unas 3.000 noticias.
- Si DeepL falla, el botón muestra un error y el original sigue visible.

## Acceptance
- Segunda petición de la misma noticia dentro de 7 días no consume cuota (viene de caché).
- Las traducciones de más de 7 días se eliminan en la limpieza diaria.
- No se llama a DeepL con noticias ya en español.
- Superado el límite (o agotado el crédito) el servidor responde 429 con mensaje comprensible y no llama a DeepL.
- Tests con el cliente DeepL simulado.

## Tareas (esbozo)
1. Cliente DeepL con interfaz sustituible.
2. Migración, caché y contador de cuota.
3. Ruta y tests.

## Boundaries
- Ask first: qué hacer cuando se agote el crédito único (pasar a plan de pago, cambiar de proveedor, la API de Claude u otro).
- Never: exponer la clave al frontend.
