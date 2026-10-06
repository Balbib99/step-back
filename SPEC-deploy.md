# SPEC-deploy — Docker, Caddy y operación en la Pi

Depende de: todos · Índice: [SPEC.md](SPEC.md)

## Objective
Desplegar en la Raspberry Pi 5 (Linux, ARM64, con Docker y Caddy ya en uso), de forma privada y recuperable.

## Entregables
- `deploy/Dockerfile` multi-etapa (build de web y servidor → imagen Node 22 slim, usuario no root, sin dependencias de desarrollo), para `linux/arm64`.
- `deploy/compose.yaml`: un servicio `step-back`, volumen `./data` para SQLite, `restart: unless-stopped`, *healthcheck* sobre `/api/health`, límite de memoria.
- `deploy/Caddyfile.example`: el sitio con HTTPS y **`basic_auth`** (contraseña hasheada con `caddy hash-password`) delante del contenedor. El contenedor no publica puertos en el host, solo en la red de Caddy.
- `deploy/backup.sh`: copia diaria de la BD (`sqlite3 .backup`) con rotación de 14 días.
- `docs/deploy.md`: instalación, actualización y recuperación paso a paso.

## Seguridad
- La app no tiene autenticación propia; toda la protección es Caddy. Sin Caddy delante no se publica.
- Cabeceras: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP que permita únicamente `self` y `youtube-nocookie.com`/imágenes necesarias.
- Secretos (`DEEPL_API_KEY`, claves VAPID) solo en `.env` del servidor, fuera del repo y de la imagen.
- Contenedor con sistema de ficheros de solo lectura salvo `/data`.

## Acceptance
- `docker compose up -d` deja la app disponible por HTTPS y pide credenciales.
- Sin credenciales, `/` y `/api/*` devuelven 401.
- Reiniciar la Pi recupera servicio y datos sin intervención.
- La imagen se construye para ARM64 y el contenedor usa < 300 MB de RAM en reposo.
- Restaurar la copia de seguridad en una BD limpia funciona (probado una vez).
- Se instala como PWA desde el dominio real.

## Tareas (esbozo)
1. Dockerfile y compose, construcción ARM64.
2. Caddyfile de ejemplo con autenticación y cabeceras.
3. Copias de seguridad y script de restauración.
4. Documentación y prueba de punta a punta.

## Boundaries
- Ask first: cualquier cambio en el Caddy o en los otros sitios que ya hay en la Pi; abrir puertos.
- Never: publicar la app sin autenticación o guardar secretos en la imagen.
