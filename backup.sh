#!/bin/bash
# ============================================================
# ZR Auto Pro — PostgreSQL Backup Script
# Создаёт дамп базы данных перед каждым обновлением.
# Хранит последние 30 бэкапов, старые удаляет автоматически.
# ============================================================

set -e

BACKUP_DIR="/opt/zr-auto-pro/backups"
CONTAINER_NAME="$(docker compose ps -q postgres 2>/dev/null || echo '')"
MAX_BACKUPS=30
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
BACKUP_FILE="${BACKUP_DIR}/zr_auto_pro_${TIMESTAMP}.sql.gz"

log() {
    echo "[BACKUP $(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Check if postgres container is running
if [ -z "$CONTAINER_NAME" ]; then
    log "WARNING: PostgreSQL container not found or not running. Trying by service name..."
    CONTAINER_NAME="$(docker ps --filter 'name=postgres' --format '{{.ID}}' | head -1)"
fi

if [ -z "$CONTAINER_NAME" ]; then
    log "ERROR: PostgreSQL container is not running. Cannot backup."
    exit 1
fi

log "Starting backup..."
log "Container: ${CONTAINER_NAME}"
log "Output: ${BACKUP_FILE}"

# Create compressed backup using pg_dump inside the container
docker exec "$CONTAINER_NAME" pg_dump -U postgres -d zr_auto_pro --clean --if-exists | gzip > "$BACKUP_FILE"

# Verify backup was created and has content
if [ ! -s "$BACKUP_FILE" ]; then
    log "ERROR: Backup file is empty or was not created!"
    rm -f "$BACKUP_FILE"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Backup created successfully: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Clean up old backups (keep last MAX_BACKUPS)
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/zr_auto_pro_*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
    DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
    log "Cleaning up ${DELETE_COUNT} old backup(s)..."
    ls -1t "$BACKUP_DIR"/zr_auto_pro_*.sql.gz | tail -n "$DELETE_COUNT" | xargs rm -f
fi

log "Backup complete. Total backups: $(ls -1 "$BACKUP_DIR"/zr_auto_pro_*.sql.gz 2>/dev/null | wc -l)"
