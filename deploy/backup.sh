#!/bin/sh
# Daily copy of the step-back database, kept for 14 days.
#
# Run it from cron on the Raspberry Pi (see docs/deploy.md):
#
#   15 4 * * * /home/pi/step-back/deploy/backup.sh >> /home/pi/step-back-backups/backup.log 2>&1
#
# The copy is made by the app itself (`node server.mjs backup`), which uses SQLite's online
# backup and checks the result, so the Pi needs nothing but Docker. Only what cannot be
# downloaded again is worth keeping: notification subscriptions and settings. Crests, news and
# the like are recovered from their sources.
#
# Settings (environment variables, all optional):
#   BACKUP_DIR            where copies go                      (default: ~/step-back-backups)
#   KEEP_DAYS             how many days of copies to keep      (default: 14)
#   STEP_BACK_CONTAINER   name of the running container        (default: step-back)

set -eu

CONTAINER="${STEP_BACK_CONTAINER:-step-back}"
DIR="${BACKUP_DIR:-$HOME/step-back-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d)"
INSIDE="/data/backup.tmp.db"
FINAL="$DIR/step-back-$STAMP.db.gz"
PART="$FINAL.part"

mkdir -p "$DIR"

cleanup() {
  docker exec "$CONTAINER" rm -f "$INSIDE" >/dev/null 2>&1 || true
  rm -f "$PART" "$DIR/step-back-$STAMP.db"
}
trap cleanup EXIT

# A leftover from an interrupted run would make the app refuse to write.
docker exec "$CONTAINER" rm -f "$INSIDE"
docker exec "$CONTAINER" node server.mjs backup "$INSIDE"
docker cp "$CONTAINER:$INSIDE" "$DIR/step-back-$STAMP.db"

gzip -c "$DIR/step-back-$STAMP.db" >"$PART"
gzip -t "$PART"
# Today's copy replaces an earlier one of the same day (a manual run, a second cron).
mv -f "$PART" "$FINAL"

# Only after a good copy: forget the old ones, so a failing backup never empties the folder.
find "$DIR" -name 'step-back-*.db.gz' -mtime +"$KEEP_DAYS" -delete

echo "$(date '+%Y-%m-%d %H:%M:%S') backup ok: $FINAL ($(du -h "$FINAL" | cut -f1)), $(find "$DIR" -name 'step-back-*.db.gz' | wc -l) kept"
