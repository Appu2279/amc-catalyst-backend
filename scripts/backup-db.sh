#!/usr/bin/env bash
#
# Dumps the Postgres container to disk and prunes old dumps.
#
# The database runs on this instance, so this script is the only thing standing
# between a bad day and losing the question bank. Install it as a cron job:
#
#   crontab -e
#   0 3 * * * /home/ubuntu/amc-catalyst-backend/scripts/backup-db.sh >> /home/ubuntu/backup.log 2>&1
#
# Verify a restore at least once. An untested backup is a guess.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/amc-catalyst-backend}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

# shellcheck disable=SC1091
set -a; source "$APP_DIR/.env"; set +a

mkdir -p "$BACKUP_DIR"
timestamp=$(date +%Y%m%d-%H%M%S)
target="$BACKUP_DIR/amc_catalyst_$timestamp.sql.gz"

# -T: no TTY, required under cron.
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" "${DB_NAME:-amc_catalyst}" | gzip > "$target"

# A dump that failed part-way still leaves a file, so check it is plausible
# rather than trusting the exit code alone.
size=$(wc -c < "$target")
if [ "$size" -lt 10000 ]; then
  echo "$(date -Is) FAILED: $target is only ${size} bytes" >&2
  exit 1
fi

find "$BACKUP_DIR" -name 'amc_catalyst_*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

echo "$(date -Is) OK: $target ($((size / 1024)) KB)"

# Off the instance, so a lost volume or terminated machine does not take the
# backups with it. Uses the EC2 instance's IAM role — the same one the API
# container uses for notes/screenshots, whose policy already covers this
# bucket's full key space (see config/storage.js), so no extra AWS setup was
# needed beyond installing the CLI. Deliberately not the same key prefix as
# application data — a stray `aws s3 rm --recursive` on one must not touch the
# other.
aws s3 cp "$target" "s3://${S3_BUCKET:?set S3_BUCKET in .env}/backups/"
