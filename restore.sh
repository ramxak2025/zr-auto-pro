#!/bin/bash
# ============================================================
# ZR Auto Pro — PostgreSQL Restore Script
# Восстанавливает базу данных из бэкапа.
# Использование:
#   ./restore.sh                    — восстановить последний бэкап
#   ./restore.sh backups/файл.sql.gz — восстановить конкретный бэкап
# ============================================================

set -e

BACKUP_DIR="/opt/zr-auto-pro/backups"
CONTAINER_NAME="$(docker compose ps -q postgres 2>/dev/null || echo '')"

log() {
    echo "[RESTORE $(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check if postgres container is running
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME="$(docker ps --filter 'name=postgres' --format '{{.ID}}' | head -1)"
fi

if [ -z "$CONTAINER_NAME" ]; then
    log "ERROR: PostgreSQL container is not running."
    exit 1
fi

# Determine which backup to restore
if [ -n "$1" ]; then
    BACKUP_FILE="$1"
else
    BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/zr_auto_pro_*.sql.gz 2>/dev/null | head -1)"
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    log "ERROR: Backup file not found: ${BACKUP_FILE}"
    log "Available backups:"
    ls -1t "$BACKUP_DIR"/zr_auto_pro_*.sql.gz 2>/dev/null || echo "  (none)"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Restoring from: ${BACKUP_FILE} (${BACKUP_SIZE})"

echo ""
echo "=== WARNING ==="
echo "This will REPLACE all current data with the backup."
echo "Backup file: ${BACKUP_FILE}"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    log "Restore cancelled."
    exit 0
fi

log "Restoring database..."

# Restore: decompress and pipe into psql
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U postgres -d zr_auto_pro --quiet 2>&1 | tail -5

log "Restore complete!"
log "Restart backend to apply: docker compose restart backend"
