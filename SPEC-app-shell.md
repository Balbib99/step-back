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
- Service worker (`web/sw/sw.js`, escrito a mano; `web/vite-plugin-sw.ts` le añade al compilar la lista de archivos y un identificador de versión; no se usa `vite-plugin-pwa`):
  - **App shell** (index, scripts, estilos, fuentes, iconos, manifest) guardada al instalar: la app abre sin conexión.
  - **Pantallas** (navegaciones): red primero (3 s) y, si no hay, el shell guardado. Cada página buena renueva el shell.
  - **Datos `/api`: red primero (4 s) y, si no hay red, está lenta o el servidor falla (5xx), la última copia.** *Se cambió el "stale-while-revalidate" del plan original*: mostraría primero el marcador de hace un minuto y la app no volvería a mirar hasta su siguiente refresco, y en un partido en directo eso es peor que esperar. Con conexión siempre se ve lo último. Se guardan hasta 150 respuestas (las más antiguas se descartan). Solo se guardan respuestas correctas: nunca un error ni una petición de contraseña.
  - **Imágenes** (`/api/crests`, imágenes de noticias y miniaturas): se guardan una vez y se reutilizan (hasta 100, unos 10-20 MB en uso normal; las más antiguas se descartan y vuelven a bajarse al verlas con conexión).
  - **`/api/health` no se guarda nunca**: es como la app sabe que el servidor no responde. Los POST (traducir) no pasan por el worker.
  - Una respuesta servida de lo guardado lleva las cabeceras `x-step-back-from-storage` y `x-step-back-saved-at`; con ellas la app muestra la banda **"Sin conexión · actualizado hace X"** (la copia más antigua en pantalla) y la quita sola al volver la conexión. Al volver (evento `online`, o cuando `/api/health` responde de nuevo) la app vuelve a pedir sus datos al momento.
  - Actualizaciones: cada versión nueva guarda su shell, borra el anterior y toma el control al momento (los archivos llevan hash, así la página abierta sigue funcionando). `sw.js` se sirve siempre sin caché.
  - TanStack Query usa `networkMode: 'always'`: si no, pausaría todas las consultas sin conexión y la pantalla se quedaría cargando, en vez de dejar que el worker responda.
- Los favoritos (`MIN, LAL, PHI`) vienen de `/api/config`; no hay edición en v1.

## Acceptance
- Lighthouse en móvil: Performance ≥ 85, Accessibility ≥ 90, PWA instalable.
- Instalada en Android abre sin barra del navegador.
- Sin conexión abre y muestra lo último cargado, indicándolo.

## Verificado (2026-10-08)
- Pruebas unitarias del worker (36) con un almacenamiento y una red simulados, y de la banda y el estado sin conexión.
- En **Chrome real** (modo headless, contra el servidor con la app compilada): el worker se instala y controla la página; guarda 12 archivos del shell, 7 respuestas de datos y 24 escudos tras visitar las cinco pantallas; **con el servidor parado, las cinco pantallas abren con sus datos y escudos y la banda dice "Sin conexión · actualizado ahora"**; una versión nueva reemplaza el shell anterior y la página sigue funcionando.
- El navegador integrado de la aplicación de escritorio **no permite registrar service workers** (error "unknown error when fetching the script"): no sirve para probarlos.
- Pendiente: Lighthouse (PWA instalable) en T29 y la prueba en el móvil real, con modo avión.
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
