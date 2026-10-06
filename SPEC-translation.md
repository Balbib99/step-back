# SPEC-translation — Traducción a demanda

Depende de: core, news · Índice: [SPEC.md](SPEC.md)

## Objective
Un botón por noticia que muestra titular y resumen en español cuando la fuente está en inglés. Nunca traduce automáticamente.

## Proveedor
DeepL API Free (500.000 caracteres/mes). La clave se guarda en `DEEPL_API_KEY` en el `.env` del servidor y nunca llega al navegador.

## API
- `POST /api/news/:id/translate` → `{ title, summary, cached: boolean }`.
- Caché de corta duración: la traducción se guarda en `translations(news_id, lang, title, summary, created_at)` solo para no gastar cuota si se vuelve a pulsar o se recarga la noticia. Se borra a los 7 días y siempre junto con la noticia al purgarse. No es un archivo de traducciones.

## Reglas
- Solo se traduce al pulsar el botón; se omite si `lang = es`.
- Contador mensual de caracteres en BD. Al llegar al 90 % se avisa en `/api/health`; al 100 % se desactiva el botón con un mensaje claro.
- Si DeepL falla, el botón muestra un error y el original sigue visible.

## Acceptance
- Segunda petición de la misma noticia dentro de 7 días no consume cuota (viene de caché).
- Las traducciones de más de 7 días se eliminan en la limpieza diaria.
- No se llama a DeepL con noticias ya en español.
- Superado el límite el servidor responde 429 con mensaje comprensible y no llama a DeepL.
- Tests con el cliente DeepL simulado.

## Tareas (esbozo)
1. Cliente DeepL con interfaz sustituible.
2. Migración, caché y contador de cuota.
3. Ruta y tests.

## Boundaries
- Ask first: cambiar de proveedor (por ejemplo la API de Claude) o pasar a plan de pago.
- Never: exponer la clave al frontend.
