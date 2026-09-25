#!/bin/sh
# Restore a backup made by backup.sh into DATABASE_URL. Stop the API first; start it again after.
#
#   DATABASE_URL=postgres://… sh restore.sh /backups/ovl-20260925-030000.dump [/backups/ovl-files-….tar.gz]
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
dump="${1:?usage: restore.sh <ovl-….dump> [ovl-files-….tar.gz]}"
files="${2:-}"

pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --dbname="$DATABASE_URL" "$dump"
echo "Database restored from $dump"

if [ -n "$files" ]; then
  : "${UPLOADS_DIR:?set UPLOADS_DIR to restore the uploaded files}"
  tar -xzf "$files" -C "$UPLOADS_DIR"
  echo "Files restored into $UPLOADS_DIR"
fi
