# SPEC-app-shell — PWA, diseño y navegación

Depende de: core · Índice: [SPEC.md](SPEC.md)

## Objective
La interfaz completa de la app: instalable en Android, pensada primero para móvil, con aspecto de noticiero / red social deportiva, **con identidad visual propia diseñada desde cero**.

## Pantallas
1. **Hoy** (portada): partidos de hoy (los favoritos primero), última hora de tus equipos, jugadas recientes.
2. **Calendario**: vista por día con selector de fecha, filtro por equipo y por tipo de temporada.
3. **Clasificación**: pestañas Este/Oeste, favoritos resaltados.
4. **Noticias**: feed con filtros de equipo, jugador e idioma; botón “Traducir”.
5. **Jugadas**: feed de vídeos con reproductor embebido.
6. **Partido** (detalle): marcador, estado, jugadas del partido, noticias relacionadas.
7. **Equipo**: calendario, noticias y jugadas del equipo.
8. **Ajustes**: notificaciones por equipo, zona horaria, tema.

## Diseño
- Dirección visual aprobada (2026-10-07): **La camiseta**, en [docs/design.md](docs/design.md) con paleta propia de los 30 equipos en [shared/src/team-palettes.json](shared/src/team-palettes.json). Antes: fase de dirección visual previa (se usarán las skills de diseño frontend): paleta, tipografía, componentes y movimiento definidos en `docs/design.md` antes de programar pantallas, y aprobados por el usuario.
- Móvil primero (≥ 360 px), responsive hasta escritorio. Modo oscuro por defecto; claro opcional.
- Los equipos favoritos usan un indicador visual constante. Textos en español.
- Accesibilidad: contraste AA, objetivos táctiles ≥ 44 px, `prefers-reduced-motion` respetado.

## Comportamiento PWA
- `manifest` con nombre, iconos (maskable) y `display: standalone`.
- Service worker: *app shell* precacheada; respuestas de `/api` con *stale-while-revalidate*; indicador “sin conexión · actualizado hace X”.
- Los favoritos (`MIN, LAL, PHI`) vienen de `/api/config`; no hay edición en v1.

## Acceptance
- Lighthouse en móvil: Performance ≥ 85, Accessibility ≥ 90, PWA instalable.
- Instalada en Android abre sin barra del navegador.
- Sin conexión abre y muestra lo último cargado, indicándolo.
- Cada pantalla tiene estados de carga, vacío y error.
- Funciona con datos del servidor de pruebas sin tocar la red externa.

## Tareas (esbozo)
1. Dirección visual y `docs/design.md` (para aprobación).
2. Esqueleto Vite + router + capa de datos (TanStack Query) + tema.
3. Componentes base (tarjeta de partido, tarjeta de noticia, escudos).
4. Pantallas por orden: Hoy, Calendario, Clasificación, Noticias, Partido, Equipo, Jugadas, Ajustes.
5. PWA: manifest, service worker, offline.
6. Pruebas de componentes y e2e.

## Boundaries
- Always: las llamadas van solo a `/api` del propio servidor.
- Ask first: nuevas librerías de UI o animación.
- Never: reutilizar código o estilos de NBA Insight.
