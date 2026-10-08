# step-back

Panel personal y privado de la NBA: calendario y resultados, clasificación, noticias con imagen o vídeo, mejores jugadas y notificaciones de Timberwolves, Lakers y 76ers. Es una PWA en español, de solo lectura, instalable en Android y alojada en una Raspberry Pi 5.

Datos de ESPN (API pública no oficial), RSS de varias webs y el canal de la NBA en YouTube. Traducción de noticias a demanda con DeepL.

## Cómo está hecho

Monorepo de npm con tres paquetes, todo en TypeScript:

| Carpeta | Qué contiene |
|---|---|
| `shared/` | Tipos y esquemas zod compartidos entre servidor y web (el contrato de la API). |
| `server/` | Fastify + SQLite. Un módulo por función en `server/src/modules/` (`games`, `standings`, `news`, `highlights`, `translation`, `push`) y lo común en `server/src/core/`. |
| `web/` | React + Vite + Tailwind, con service worker propio (`web/sw/sw.js`). |
| `deploy/` | Dockerfile (ARM64), compose, ejemplo de Caddyfile y scripts de copia y restauración. |
| `docs/` | `deploy.md` (operación) y `design.md` (dirección visual). |

El navegador solo habla con `/api`; las fuentes externas las consulta el servidor, con caché y límites de ritmo. Cada fuente está aislada tras un adaptador con pruebas sobre respuestas reales grabadas, de modo que si una cambia falla un adaptador, no la app.

## Desarrollo

Requiere Node 22.

```bash
npm install
npm run dev          # servidor (puerto 3000) y web (puerto 5173) juntos
npm test             # todas las pruebas
npm run lint
npm run typecheck
npm run e2e -w web   # pruebas de extremo a extremo con Chrome (compila la web antes)
npm run build        # compila la web y empaqueta el servidor
```

Configuración opcional en un `.env` (hay una plantilla en `.env.example`): equipos favoritos, clave de DeepL y claves VAPID para las notificaciones.

## Despliegue y operación

Todo está en [docs/deploy.md](docs/deploy.md): instalar, actualizar, copias de seguridad y restauración, activar las notificaciones y qué hacer cuando una fuente falla.

## Especificación

El producto se describe en [SPEC.md](SPEC.md) y un `SPEC-<módulo>.md` por módulo; el plan y las tareas están en [tasks/](tasks/).
