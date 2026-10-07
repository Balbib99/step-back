# Despliegue en la Raspberry Pi

Borrador de T12. La versión final (actualización, copias de seguridad, qué hacer si una fuente falla) se escribe en T30.

## Qué se despliega

Un solo contenedor, `step-back`, que hace de servidor (API y tareas programadas) y sirve la web ya compilada. No publica ningún puerto en la Pi: tu Caddy llega a él por una red de Docker compartida y es **Caddy quien pide la contraseña**. La app no tiene autenticación propia, así que nunca debe quedar accesible de otra forma.

```
móvil ──HTTPS──▶ Caddy (step-back.duckdns.org, basic_auth) ──▶ step-back:3000 ──▶ volumen /data
```

Todo lo que debe sobrevivir a una actualización (base de datos, escudos) vive en el volumen `data`, montado en `/data`.

## Archivos

| Archivo | Para qué |
|---|---|
| `deploy/Dockerfile` | Construye la imagen (3 etapas: compilar, dependencias de producción, imagen final sin compiladores y sin root). |
| `deploy/compose.yaml` | Contenedor para la Pi, detrás de tu Caddy. |
| `deploy/compose.local.yaml` | El mismo contenedor para probarlo en un ordenador, sin Caddy ni contraseña. **No usar en la Pi.** |
| `deploy/Caddyfile.example` | El bloque que hay que añadir a tu Caddyfile. |
| `deploy/production.env.example` | Ajustes personales y secretos (clave de DeepL, claves VAPID). |

## Requisitos en la Pi

- Docker con Compose v2.24 o superior (`docker compose version`). Lo pide la opción `env_file ... required: false`.
- Tu Caddy en Docker. Necesito saber el **nombre de la red de Docker** que usa (`docker network ls`). Por defecto el compose usa `edge` (la red que ya comparten tu Caddy y tus otras webs); si algún día cambia, arranca con `CADDY_NETWORK=nombre`.
- Los puertos 80 y 443 de tu router apuntando a la Pi, y `step-back.duckdns.org` apuntando a tu IP pública, para que Caddy consiga el certificado.

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

## Comprobar que funciona

```bash
docker compose -f deploy/compose.yaml ps                       # step-back debería salir "healthy"
curl -I https://step-back.duckdns.org                           # 401 sin contraseña
curl -I -u usuario https://step-back.duckdns.org                # 200 con contraseña
curl -s -u usuario https://step-back.duckdns.org/api/health     # status: ok
```

## Cosas que conviene saber

- **Al instalar como PWA con contraseña**: el navegador pide el `manifest` sin credenciales y recibiría un 401. T13 lo resuelve con `crossorigin="use-credentials"` en el enlace al manifest; por eso la instalación se prueba en T13 y no antes.
- **Memoria**: el contenedor tiene un límite de 400 MB y Node trabaja con un máximo de 192 MB de heap.
- **Registros**: Docker guarda como máximo 3 archivos de 10 MB, para no llenar la tarjeta SD.
- **El contenedor sigue sin tener el sistema de archivos en solo lectura**; eso se añade en T28 junto con las cabeceras de seguridad y las copias de seguridad.

## Instalar la app en el móvil (Android)

1. Abre `https://step-back.duckdns.org` en Chrome y escribe usuario y contraseña.
2. Menú de Chrome (⋮) → **Instalar aplicación** (o "Añadir a la pantalla de inicio").
3. Abre el icono nuevo: debe arrancar sin barra del navegador y con el fondo oscuro de la app.

Si "Instalar aplicación" no aparece, abre `chrome://inspect` desde un ordenador con el móvil conectado, o dime qué ves, y se revisa el manifiesto y el service worker (T13 los deja listos; el service worker actual no guarda nada, eso es T25).
