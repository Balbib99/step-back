# Despliegue y operación en la Raspberry Pi

Guía para instalar, actualizar, copiar, restaurar y vigilar step-back. Todos los comandos se ejecutan en la Pi, desde la carpeta del repositorio, salvo que se diga otra cosa.

## Qué se despliega

Un solo contenedor, `step-back`, que hace de servidor (API y tareas programadas) y sirve la web ya compilada. No publica ningún puerto en la Pi: tu Caddy llega a él por una red de Docker compartida y es **Caddy quien pide la contraseña**. La app no tiene autenticación propia, así que nunca debe quedar accesible de otra forma.

```
móvil ──HTTPS──▶ Caddy (step-back.duckdns.org, basic_auth) ──▶ step-back:3000 ──▶ volumen /data
```

Todo lo que debe sobrevivir a una actualización (base de datos, escudos, imágenes de noticias) vive en el volumen `data`, montado en `/data`.

## Archivos

| Archivo | Para qué |
|---|---|
| `deploy/Dockerfile` | Construye la imagen (3 etapas: compilar, dependencias de producción, imagen final sin compiladores y sin root). |
| `deploy/compose.yaml` | Contenedor para la Pi, detrás de tu Caddy. |
| `deploy/compose.local.yaml` | El mismo contenedor para probarlo en un ordenador, sin Caddy ni contraseña. **No usar en la Pi.** |
| `deploy/Caddyfile.example` | El bloque que hay que añadir a tu Caddyfile (contraseña y HSTS). |
| `deploy/production.env.example` | Ajustes personales y secretos (clave de DeepL, claves VAPID). |
| `deploy/backup.sh` | Copia diaria de la base de datos, con rotación de 14 días. |
| `deploy/restore.sh` | Devuelve una copia como base de datos en uso. |

## Requisitos en la Pi

- Docker con Compose v2.24 o superior (`docker compose version`). Lo pide la opción `env_file ... required: false`.
- Tu Caddy en Docker, en una red de Docker que el contenedor de step-back también pueda usar. Por defecto el compose usa la red `edge` (`docker network ls` la lista); si cambia, arranca con `CADDY_NETWORK=nombre`.
- Los puertos 80 y 443 del router apuntando a la Pi, y `step-back.duckdns.org` apuntando a tu IP pública, para que Caddy consiga el certificado.

## Probarlo primero en un ordenador

Con Docker instalado:

```bash
docker compose -f deploy/compose.local.yaml up --build
```

Abre `http://127.0.0.1:3000`. Los primeros 35 segundos el calendario se está cargando de ESPN.

## Instalar en la Pi

```bash
git clone git@github.com-personal:Balbib99/step-back.git
cd step-back
cp deploy/production.env.example deploy/production.env   # y rellénalo si hace falta
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml logs -f step-back
```

La primera construcción en la Pi tarda unos minutos. Después:

1. Genera el hash de tu contraseña: `docker run --rm caddy:2 caddy hash-password`.
2. Añade el bloque de `deploy/Caddyfile.example` a tu Caddyfile con ese hash.
3. Recarga Caddy (`docker exec <tu-contenedor-caddy> caddy reload --config /etc/caddy/Caddyfile`).
4. Programa la copia diaria (sección «Copias de seguridad»).

## Comprobar que funciona

```bash
docker compose -f deploy/compose.yaml ps                       # step-back debería salir "healthy"
curl -I https://step-back.duckdns.org                           # 401 sin contraseña
curl -I -u usuario https://step-back.duckdns.org                # 200 con contraseña, y las cabeceras de seguridad
curl -s -u usuario https://step-back.duckdns.org/api/health     # status: ok
```

En la respuesta con contraseña de `curl -I` deben aparecer `strict-transport-security`, `content-security-policy`, `x-content-type-options`, `referrer-policy`, `x-frame-options` y `permissions-policy`, y **no** una cabecera `server`.

## Actualizar

```bash
git pull
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps        # espera a "healthy"
```

La base de datos y todo lo del volumen se conservan: solo se sustituye la imagen. Las migraciones de la base de datos se aplican solas al arrancar y solo añaden. Si un arranque falla, `docker compose -f deploy/compose.yaml logs --tail 100 step-back` dice por qué.

En el móvil, la app se actualiza sola la próxima vez que se abre con conexión.

Para volver a una versión anterior: `git checkout <commit>` y el mismo `up -d --build`. Si la nueva versión añadió migraciones, restaura antes una copia anterior a la actualización (sección «Restaurar»); la versión vieja no entiende tablas o columnas que no conoce.

## Copias de seguridad

Qué se copia: la base de datos completa. Lo único que no se puede volver a descargar de las fuentes son las **suscripciones a notificaciones y los ajustes de avisos**; el resto (partidos, noticias, jugadas, escudos) se recupera solo. Por eso basta una copia local diaria de 14 días.

`deploy/backup.sh` la hace con el propio contenedor (`node server.mjs backup`), usando la copia en caliente de SQLite, y comprueba la integridad antes de darla por buena. No necesita instalar nada en la Pi.

Programa la copia diaria con `crontab -e` (ajusta la ruta de tu usuario):

```
15 4 * * * /home/pi/step-back/deploy/backup.sh >> /home/pi/step-back-backups/backup.log 2>&1
```

La primera vez, `chmod +x deploy/backup.sh deploy/restore.sh` y ejecútalo a mano para ver que funciona:

```bash
deploy/backup.sh
ls -lh ~/step-back-backups
```

Deja un archivo `step-back-AAAA-MM-DD.db.gz` por día y borra los de más de 14 días (solo después de una copia correcta: si la copia falla, no se borra nada). Variables opcionales: `BACKUP_DIR` (por defecto `~/step-back-backups`), `KEEP_DAYS` y `STEP_BACK_CONTAINER`.

Las copias están en la misma tarjeta que la base de datos: protegen de un error o de una actualización fallida, no de que se estropee la tarjeta. Si quieres cubrir eso, copia de vez en cuando esa carpeta a otro equipo (`scp -r pi@raspberrypi:step-back-backups .`).

## Restaurar

```bash
deploy/restore.sh ~/step-back-backups/step-back-2026-10-08.db.gz
```

Pregunta antes de hacer nada, para el contenedor, guarda la base de datos actual como `step-back.db.before-restore` dentro del volumen, escribe la copia y arranca de nuevo. Si algo falla a mitad, devuelve la base de datos anterior y no arranca la app sobre una base vacía.

Después comprueba `docker compose -f deploy/compose.yaml ps` (healthy) y abre Ajustes en la app: tus avisos y tu dispositivo deben seguir ahí.

**Haz esta prueba una vez, ahora que todo funciona**, para saber que la copia sirve cuando haga falta: ejecuta `deploy/backup.sh`, luego `deploy/restore.sh` con esa misma copia y comprueba lo anterior. No pierdes nada, porque la base de datos anterior queda guardada.

## Notificaciones (Web Push)

1. En la Pi (solo necesita Docker) genera las claves:

```bash
docker run --rm node:22-slim node -e "const c=require('crypto');const e=c.createECDH('prime256v1');e.generateKeys();console.log('VAPID_PUBLIC_KEY='+e.getPublicKey().toString('base64url'));console.log('VAPID_PRIVATE_KEY='+e.getPrivateKey().toString('base64url'))"
```

   Imprime dos líneas, `VAPID_PUBLIC_KEY=` (87 caracteres) y `VAPID_PRIVATE_KEY=` (43). Si la privada sale más corta, repite el comando.
2. Copia esas dos líneas en `deploy/production.env` y añade `VAPID_SUBJECT=mailto:tu@correo.com`. Las tres juntas: con una o dos, el servidor no arranca.
3. Reinicia el contenedor (`docker compose -f deploy/compose.yaml up -d`).
4. En el móvil, con la app instalada: icono de campana de la barra superior → **Activar notificaciones** y acepta el permiso.
5. Pulsa **Enviar notificación de prueba**: debe llegar en unos segundos. Si no llega, mira `docker compose -f deploy/compose.yaml logs step-back`.
6. **No cambies las claves después**: las suscripciones ya hechas dejan de recibir y hay que volver a activar las notificaciones en cada dispositivo.

La Pi necesita salir a internet por HTTPS hacia los servicios push de Google y Mozilla; nada entra desde fuera. Las suscripciones y los ajustes viven en la base de datos, así que forman parte de la copia de seguridad.

## Cuando una fuente falla

La app sigue funcionando con lo último que guardó: cada fuente es independiente, y una caída solo hace que esa sección no se actualice. La barra superior pasa a «Alguna fuente falla». Para ver cuál:

```bash
docker compose -f deploy/compose.yaml exec step-back node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(h=>console.log(JSON.stringify(h.jobs.filter(j=>j.status!=='ok'),null,2)))"
docker compose -f deploy/compose.yaml logs --tail 100 step-back
```

Cada tarea con problema sale con su `id`, la hora del último intento y el error:

| Tarea | Qué es | Qué hacer |
|---|---|---|
| `games:calendar`, `games:refresh` | Calendario y marcadores de ESPN | Casi siempre es una caída pasajera y se arregla sola. Si dura días o el error habla de un formato inesperado, ESPN cambió su API: hay que actualizar `server/src/modules/games/adapter.ts` y sus muestras de prueba. |
| `standings:refresh` | Clasificación de ESPN | Igual que la anterior (`server/src/modules/standings/`). |
| `news:espn`, `news:yahoo`, `news:cbs`, `news:reddit`, `news:gigantes` | Una fuente de noticias | Las demás siguen. Si una falla durante días, su dirección habrá cambiado: edita o quita esa línea en `server/src/modules/news/sources.json` y vuelve a desplegar. |
| `highlights:refresh` | Vídeos del canal de la NBA en YouTube | Pasajero casi siempre. Si dura, comprueba que el canal sigue existiendo y su feed responde. |
| `translation:quota` | Crédito de DeepL | Falla a propósito cuando queda menos del 10 %. Cuando se agota, el botón de traducir se desactiva y las noticias siguen en su idioma. Un crédito nuevo o una clave nueva en `production.env` lo arregla. |
| `push:dispatch` | Envío de notificaciones | Un dispositivo que falla no es un fallo de la tarea (queda en los registros como `push could not be delivered`). Si la tarea falla, mira el error en los registros. |

Una tarea que falla se reintenta sola con esperas cada vez más largas. Para forzar un arranque limpio: `docker compose -f deploy/compose.yaml restart step-back`.

## Limpieza automática

No hace falta ocuparse del espacio: cada módulo borra lo suyo una vez al día.

| Qué | Cuánto se guarda |
|---|---|
| Noticias (y sus imágenes) | 90 días |
| Traducciones | 7 días |
| Historial de ejecuciones de tareas (`core:cleanup`) | 14 días (siempre se conserva la última ejecución de cada tarea) |
| Datos en caché caducados (`core:cleanup`) | al caducar |
| Registro de avisos enviados | 30 días |

El volumen de datos suele ocupar unas decenas de MB. El registro de Docker está limitado a 3 archivos de 10 MB.

## Seguridad

- **Autenticación:** solo la de Caddy. Sin contraseña, `/` y `/api/*` devuelven 401.
- **Cabeceras:** HSTS lo pone Caddy (solo tiene sentido con HTTPS). El resto (`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`) las envía la propia app; el CSP solo permite contenido propio y el reproductor de `youtube-nocookie.com`. Si algún día añades una fuente de imágenes o vídeo externa, hay que ampliarlo en `server/src/core/security-headers.ts`.
- **Contenedor:** sistema de archivos de solo lectura salvo `/data` y `/tmp`, sin privilegios, sin permisos de Linux (`cap_drop: ALL`), usuario sin root, 400 MB de memoria como máximo.
- **Secretos:** solo en `deploy/production.env` (no está en git ni en la imagen).

Si tras una actualización el contenedor no arranca y los registros hablan de `EROFS` (escritura en un sistema de solo lectura), avísame con el mensaje: significa que algo escribe fuera de `/data`. Para salir del paso, quita temporalmente `read_only: true` y `tmpfs` de `deploy/compose.yaml`.

## Ajustes (`deploy/production.env`)

Todos son opcionales. `HOST`, `PORT`, `DB_PATH` y `WEB_DIR` los fija el compose.

| Variable | Para qué |
|---|---|
| `TZ_DISPLAY` | Zona horaria en que se muestran las horas (`Europe/Madrid`). |
| `FAVORITE_TEAMS` | Equipos favoritos, por abreviatura de ESPN (`MIN,LAL,PHI`). |
| `LOG_LEVEL` | `info` por defecto; `debug` para investigar. |
| `DEEPL_API_KEY` | Activa el botón de traducir. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Activan las notificaciones (las tres juntas). |

Después de cambiarlas: `docker compose -f deploy/compose.yaml up -d`.

## Instalar la app en el móvil (Android)

1. Abre `https://step-back.duckdns.org` en Chrome y escribe usuario y contraseña.
2. Menú de Chrome (⋮) → **Instalar aplicación** (o «Añadir a la pantalla de inicio»).
3. Abre el icono nuevo: debe arrancar sin barra del navegador y con el fondo oscuro de la app.

Una vez instalada abre sin conexión mostrando lo último que guardó, con un aviso de que no está actualizada.

## Si la app se queda con una versión vieja o rara (service worker)

La app guarda una copia de sí misma en el móvil para abrir sin conexión. Normalmente se actualiza sola en cuanto abres la app con conexión. Si alguna vez algo no cuadra, en Chrome de Android: abre `https://step-back.duckdns.org`, menú ⋮ → **Información de la página** (el candado) → **Configuración del sitio** → **Borrar datos y restablecer permisos**. La próxima vez que abras la app se descarga entera otra vez (y habrá que volver a activar las notificaciones).

Para comprobar desde el servidor que se sirve la versión nueva del worker (cambia el `BUILD` cuando se despliega código nuevo):

```bash
docker compose -f deploy/compose.yaml exec step-back node -e "fetch('http://127.0.0.1:3000/sw.js').then(r=>r.text()).then(t=>console.log(t.match(/const BUILD = .*/)[0]))"
```

## Cosas que conviene saber

- **Al instalar como PWA con contraseña**: el navegador pide el `manifest` sin credenciales y recibiría un 401; por eso el enlace al manifest lleva `crossorigin="use-credentials"`.
- **Memoria**: el contenedor tiene un límite de 400 MB y Node trabaja con un máximo de 192 MB de heap.
- **Registros**: Docker guarda como máximo 3 archivos de 10 MB, para no llenar la tarjeta SD.
