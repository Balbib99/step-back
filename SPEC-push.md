# SPEC-push — Notificaciones Web Push

Depende de: core, games, app-shell · Índice: [SPEC.md](SPEC.md)

## Objective
Avisar en el móvil de lo relevante de Timberwolves, Lakers y 76ers sin abrir la app.

## Eventos
- **Inicio de partido** y **final con resultado** de cualquier equipo de la NBA. Los favoritos (Timberwolves, Lakers, 76ers) los tienen activados por defecto; el resto, desactivados hasta que el usuario los active en Ajustes (equipo a equipo, o todos a la vez).
- **Recordatorio** antes del inicio (0, 15, 30 o 60 min; 30 por defecto): solo para los equipos favoritos.
- **Noticia destacada** (decidido 2026-10-08), solo para favoritos y desactivada por defecto. «Destacada» = noticia reciente (menos de 2 h) de una fuente marcada `"priority": true` en `sources.json`, etiquetada con ese equipo. Máximo 5 al día. La fuente prioritaria es **ESPN**: NBA.com no ofrece un RSS utilizable (404 y bloqueo 403 desde el servidor) y ESPN sí, con señal de calidad (insiders como Shams Charania). No hay datos fiables de «mejor feedback» entre fuentes; se revisará con el uso.
- **Marcador en vivo** (decidido 2026-10-10): una única notificación por partido, **sin sonido**, que se actualiza en el sitio con cada cambio del marcador o del cuarto (misma `tag`, `live:<id>`) y se retira cuando llega el resultado final. Es automática para los partidos de los equipos favoritos (ajuste `live` por equipo, activado por defecto) y, para cualquier otro partido, se activa a mano con «Seguir el marcador en el móvil» desde su pantalla, mientras el partido no haya terminado. Los partidos seguidos se olvidan a las 36 h. Límites: es un aviso de notificaciones, no una burbuja flotante ni una Live Activity (eso exige una app nativa); no corre el reloj, se actualiza como mucho cada 30 s y la web permite al usuario descartarla deslizándola.
- Un partido entre dos equipos con avisos activos genera **una** notificación, no dos.

## Técnica
Web Push con claves VAPID (`web-push`). Funciona en Android con la PWA instalada y HTTPS.

## Modelo y API
`push_subscriptions(endpoint, p256dh, auth, created_at)` · `push_settings(team, start, end, reminder_minutes, news, live)` (una fila por equipo; sin fila, o con `live` vacío, = valores por defecto) · `push_follows(game_id, created_at)` (partidos seguidos uno a uno) · `push_log(event_key, sent_at)` para no repetir envíos; la clave del marcador en vivo lleva el marcador y el cuarto (`live:<partido>:<visitante>-<local>:<cuarto>`), de modo que cada estado se envía una vez.
- `POST /api/push/subscribe` · `DELETE /api/push/subscribe`
- `GET/PUT /api/push/settings` (los 30 equipos; las noticias solo se aceptan para favoritos)
- `GET /api/push/follows` · `PUT/DELETE /api/push/follows/:gameId` (máximo 30 a la vez)
- `POST /api/push/test`: notificación de prueba al dispositivo que la pide
- Suscripciones caducadas (410/404) se eliminan automáticamente.

## Acceptance
- Un partido de un favorito que empieza o termina genera exactamente una notificación por evento (idempotente ante reinicios y reintentos).
- Pulsar la notificación abre el detalle del partido.
- El marcador en vivo no suena, no se repite si el marcador no cambia, y el resultado final lo sustituye.
- Desactivar un equipo en Ajustes detiene sus avisos.
- Una suscripción inválida no bloquea el envío al resto.
- Tests con proveedor push simulado y reloj falso.

## Tareas (esbozo)
1. Claves VAPID y endpoints de suscripción.
2. Detector de eventos a partir de cambios de estado en `games`.
3. Envío con idempotencia y limpieza.
4. UI de ajustes y permiso de notificaciones (en `app-shell`).

## Boundaries
- Ask first: añadir tipos de notificación nuevos.
- Never: pedir permiso de notificaciones al abrir por primera vez; solo desde Ajustes tras una acción del usuario.
