#!/bin/sh
# One backup: a pg_dump of the database (and a tarball of uploaded files) in $BACKUP_DIR.
# Keeps $BACKUP_KEEP_DAYS days of backups and records the last one, so the admin panel shows it.
#
#   DATABASE_URL=postgres://… BACKUP_DIR=/backups [UPLOADS_DIR=/uploads] sh backup.sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
UPLOADS_DIR="${UPLOADS_DIR:-}"

stamp=$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
dump="$BACKUP_DIR/ovl-$stamp.dump"

# Custom format: compressed, and pg_restore can restore single tables from it.
pg_dump --format=custom --no-owner --no-privileges --file="$dump.partial" "$DATABASE_URL"
mv "$dump.partial" "$dump"

if [ -n "$UPLOADS_DIR" ] && [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$BACKUP_DIR/ovl-files-$stamp.tar.gz.partial" -C "$UPLOADS_DIR" .
  mv "$BACKUP_DIR/ovl-files-$stamp.tar.gz.partial" "$BACKUP_DIR/ovl-files-$stamp.tar.gz"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ovl-*' -mtime +"$KEEP_DAYS" -delete

bytes=$(wc -c < "$dump" | tr -d ' ')
psql "$DATABASE_URL" --quiet --no-psqlrc -v ON_ERROR_STOP=1 -c "
  insert into platform_settings (key, value, updated_at)
  values ('backup', jsonb_build_object('at', now(), 'file', '$(basename "$dump")', 'bytes', $bytes), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at"

echo "Backup written: $dump ($bytes bytes)"
