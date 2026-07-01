#!/bin/bash
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump -U postgres zr_auto_pro > "${BACKUP_DIR}/${FILENAME}"

echo "Backup saved to ${BACKUP_DIR}/${FILENAME}"

# ── Uploads volume (фото товаров/клиентов, документы сотрудников) ────────────
# Compose-проект /opt/zr-auto-pro → volume zr-auto-pro_uploads (top-level
# `name:` в docker-compose.yml не задан). Абсолютный путь для -v обязателен:
# bind-пути интерпретирует docker-демон, а не этот скрипт.
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"
UPLOADS_VOLUME="zr-auto-pro_uploads"
if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
    # Fallback: имя compose-проекта нестандартное — ищем volume по compose-label.
    UPLOADS_VOLUME="$(docker volume ls -q --filter label=com.docker.compose.volume=uploads 2>/dev/null | head -1)"
fi

if [ -n "$UPLOADS_VOLUME" ] && docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
    if docker run --rm \
        -v "${UPLOADS_VOLUME}":/data:ro \
        -v "${BACKUP_DIR_ABS}":/backup \
        alpine tar czf "/backup/uploads_${TIMESTAMP}.tar.gz" -C /data .; then
        echo "Uploads backup saved to ${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"
    else
        # НЕ фатально: дамп БД уже создан — не роняем скрипт из-за архива фото.
        echo "WARNING: uploads backup failed — DB dump is intact."
    fi
else
    echo "WARNING: uploads volume not found — skipping uploads backup."
fi
