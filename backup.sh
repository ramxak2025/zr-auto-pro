#!/bin/bash
# ============================================================
# ZR Auto Pro — Backup Script (PostgreSQL + uploads)
# Создаёт дамп базы данных перед каждым обновлением
# + архив uploads-volume (фото товаров/клиентов, документы).
# Хранит последние 30 бэкапов каждого типа, старые удаляет.
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

# ============================================================
# Uploads volume backup (фото товаров/клиентов, документы
# сотрудников). Раньше НЕ бэкапились вовсе — только pg_dump.
# Compose-проект = /opt/zr-auto-pro → volume zr-auto-pro_uploads
# (top-level `name:` в docker-compose.yml не задан). Оба -v пути
# интерпретирует docker-ДЕМОН на хосте, поэтому архив попадает в
# ${BACKUP_DIR} на хосте независимо от места запуска скрипта.
# ============================================================
UPLOADS_FILE="${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"
UPLOADS_VOLUME="zr-auto-pro_uploads"
if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
    # Fallback: имя compose-проекта нестандартное — ищем volume по compose-label.
    UPLOADS_VOLUME="$(docker volume ls -q --filter label=com.docker.compose.volume=uploads 2>/dev/null | head -1)"
fi

if [ -n "$UPLOADS_VOLUME" ] && docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
    log "Backing up uploads volume '${UPLOADS_VOLUME}' -> ${UPLOADS_FILE}"
    if docker run --rm \
        -v "${UPLOADS_VOLUME}":/data:ro \
        -v "${BACKUP_DIR}":/backup \
        alpine tar czf "/backup/uploads_${TIMESTAMP}.tar.gz" -C /data . \
        && [ -s "$UPLOADS_FILE" ]; then
        UPLOADS_SIZE=$(du -h "$UPLOADS_FILE" | cut -f1)
        log "Uploads backup created: ${UPLOADS_FILE} (${UPLOADS_SIZE})"
    else
        # НЕ фатально: дамп БД уже создан и проверен выше — не роняем
        # весь бэкап из-за архива фото. Просто громко предупреждаем.
        log "WARNING: uploads backup FAILED — DB dump is intact, continuing."
        rm -f "$UPLOADS_FILE"
    fi
else
    log "WARNING: uploads volume not found — skipping uploads backup."
fi

# Clean up old uploads archives (same retention as SQL dumps)
UPLOADS_COUNT=$(ls -1 "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | wc -l)
if [ "$UPLOADS_COUNT" -gt "$MAX_BACKUPS" ]; then
    DELETE_COUNT=$((UPLOADS_COUNT - MAX_BACKUPS))
    log "Cleaning up ${DELETE_COUNT} old uploads archive(s)..."
    ls -1t "$BACKUP_DIR"/uploads_*.tar.gz | tail -n "$DELETE_COUNT" | xargs rm -f
fi

log "Backup complete. Total backups: $(ls -1 "$BACKUP_DIR"/zr_auto_pro_*.sql.gz 2>/dev/null | wc -l) SQL, $(ls -1 "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | wc -l) uploads"
