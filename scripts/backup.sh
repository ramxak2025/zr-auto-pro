#!/bin/bash
# =============================================================================
# Database Backup Script for ZR Auto Pro
# Usage: ./scripts/backup.sh
# Cron example (daily at 3 AM): 0 3 * * * /path/to/zr-auto-pro/scripts/backup.sh
# =============================================================================

set -euo pipefail

# Configuration (override via environment variables)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-zr_auto_pro}"
DB_USER="${DB_USERNAME:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/home/user/zr-auto-pro/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${DB_NAME}_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "[$(date)] Starting backup of ${DB_NAME}..."

# Run pg_dump and compress
if command -v docker &> /dev/null && docker ps --format '{{.Names}}' | grep -q 'postgres'; then
  # If running via Docker Compose
  docker exec -t "$(docker ps --filter 'name=postgres' --format '{{.Names}}' | head -1)" \
    pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$FILEPATH"
else
  # Direct pg_dump
  PGPASSWORD="${DB_PASSWORD:-postgres}" pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    "$DB_NAME" | gzip > "$FILEPATH"
fi

# Check result
if [ -s "$FILEPATH" ]; then
  SIZE=$(du -h "$FILEPATH" | cut -f1)
  echo "[$(date)] Backup created: ${FILEPATH} (${SIZE})"
else
  echo "[$(date)] ERROR: Backup file is empty!" >&2
  rm -f "$FILEPATH"
  exit 1
fi

# Remove old backups
if [ "$KEEP_DAYS" -gt 0 ]; then
  DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
  if [ "$DELETED" -gt 0 ]; then
    echo "[$(date)] Removed ${DELETED} old backup(s) (older than ${KEEP_DAYS} days)"
  fi
fi

echo "[$(date)] Backup completed successfully."
