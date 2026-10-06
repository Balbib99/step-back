# SPEC-push — Notificaciones Web Push

Depende de: core, games, app-shell · Índice: [SPEC.md](SPEC.md)

## Objective
Avisar en el móvil de lo relevante de Timberwolves, Lakers y 76ers sin abrir la app.

## Eventos
- **Inicio de partido** de un equipo favorito (y recordatorio 30 min antes, configurable).
- **Final de partido** con resultado.
- **Noticia destacada** de un equipo favorito (opcional, desactivado por defecto; criterio simple: fuentes marcadas como prioritarias).

## Técnica
Web Push con claves VAPID (`web-push`). Funciona en Android con la PWA instalada y HTTPS.

## Modelo y API
`push_subscriptions(endpoint, p256dh, auth, created_at)` · `push_settings(team, start, end, news)` · `push_log(event_key, sent_at)` para no repetir envíos.
- `POST /api/push/subscribe` · `DELETE /api/push/subscribe`
- `GET/PUT /api/push/settings`
- Suscripciones caducadas (410/404) se eliminan automáticamente.

## Acceptance
- Un partido de un favorito que empieza o termina genera exactamente una notificación por evento (idempotente ante reinicios y reintentos).
- Pulsar la notificación abre el detalle del partido.
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
