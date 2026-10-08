#!/bin/sh
# Puts a backup made by backup.sh back as the live database.
#
#   deploy/restore.sh ~/step-back-backups/step-back-2026-10-08.db.gz
#
# It stops the app, keeps the database it replaces next to it as step-back.db.before-restore,
# writes the backup into the data volume and starts the app again. Run it from the repository,
# on the Raspberry Pi. It asks before doing anything.
#
# Settings (environment variables, all optional):
#   STEP_BACK_VOLUME   name of the data volume   (default: step-back_data)
#   ASSUME_YES=1       do not ask for confirmation

set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 <backup file .db.gz>" >&2
  exit 2
fi

BACKUP="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE="docker compose -f $HERE/compose.yaml"
VOLUME="${STEP_BACK_VOLUME:-step-back_data}"
# The app image already has everything this needs; no other image has to be downloaded.
IMAGE="${STEP_BACK_IMAGE:-step-back:latest}"

[ -f "$BACKUP" ] || { echo "there is no file $BACKUP" >&2; exit 1; }
gzip -t "$BACKUP" || { echo "$BACKUP is not a valid .gz file" >&2; exit 1; }
docker volume inspect "$VOLUME" >/dev/null 2>&1 || {
  echo "there is no volume $VOLUME (set STEP_BACK_VOLUME; see: docker volume ls)" >&2
  exit 1
}

if [ "${ASSUME_YES:-}" != "1" ]; then
  printf 'This replaces the current step-back database with %s.\nThe current one is kept as step-back.db.before-restore. Continue? [y/N] ' "$BACKUP"
  read -r answer
  case "$answer" in y | Y | yes) ;; *) echo "cancelled"; exit 1 ;; esac
fi

as_root() {
  docker run --rm -i --user root --entrypoint sh -v "$VOLUME:/data" "$IMAGE" -c "$1"
}

$COMPOSE stop step-back

# From here on, whatever happens, the app must start again.
trap '$COMPOSE start step-back' EXIT

as_root 'rm -f /data/step-back.db.before-restore /data/step-back.db-wal /data/step-back.db-shm
         [ ! -f /data/step-back.db ] || mv /data/step-back.db /data/step-back.db.before-restore'
if ! gunzip -c "$BACKUP" | as_root 'cat > /data/step-back.db && [ -s /data/step-back.db ] && chown node:node /data/step-back.db'; then
  # Never start the app on a missing or half-written database: put the old one back.
  echo "the restore failed; putting the previous database back" >&2
  as_root '[ ! -f /data/step-back.db.before-restore ] || mv -f /data/step-back.db.before-restore /data/step-back.db'
  exit 1
fi

echo "restored $BACKUP; starting the app"
