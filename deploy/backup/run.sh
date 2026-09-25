#!/bin/sh
# The backup service: wait for the database, then back up every $BACKUP_INTERVAL_HOURS hours.
set -eu

interval=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
until pg_isready --dbname="$DATABASE_URL" --quiet; do sleep 2; done

while true; do
  sh /deploy/backup.sh || echo "Backup failed; trying again at the next interval" >&2
  sleep "$interval"
done
