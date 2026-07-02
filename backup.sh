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

# Репо-каталог нужен ТОЛЬКО чтобы прочитать offsite-переменные из .env:
# с хоста это /opt/zr-auto-pro, из webhook-контейнера — /deploy/repo
# (bind того же каталога; та же логика определения, что в deploy.sh).
if [ -d "/deploy/repo" ]; then
    REPO_DIR="/deploy/repo"
else
    REPO_DIR="/opt/zr-auto-pro"
fi

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

# ============================================================
# Offsite-копия в S3-совместимое хранилище (ОПЦИОНАЛЬНО).
# Закрывает риск «сгорел VDS — потеряны и прод, и бэкапы»: все файлы
# выше лежат на ТОМ ЖЕ диске, что и база.
#
# Включается только когда заданы ВСЕ четыре переменные S3_BACKUP_*
# (в окружении или в $REPO_DIR/.env — читаем так же, как deploy.sh
# читает GHCR_READ_TOKEN; значения НИКОГДА не логируем). Переменных
# нет → одна тихая строка и выход: поведение бэкапа не меняется,
# пока владелец не заведёт бакет (см. docs/OFFSITE_BACKUPS.md).
#
# Выгрузка — докеризованный rclone (rclone/rclone:latest) БЕЗ
# конфиг-файла: remote «offsite» целиком описывается переменными
# окружения RCLONE_CONFIG_OFFSITE_*. Секреты передаются docker-клиенту
# именованными -e (значение берётся из окружения процесса) — их нет
# ни в командной строке, ни в выводе.
#
# ЛЮБАЯ ошибка offsite — только громкий WARNING: локальный бэкап уже
# создан и проверен, ронять его (и деплой) нельзя.
# Зеркальная копия этого блока — в scripts/backup.sh.
# ============================================================

offsite_log() { log "[offsite] $1"; }

offsite_read_env() {
    # $1 — имя переменной. Приоритет: окружение → $REPO_DIR/.env.
    local val="${!1:-}"
    if [ -z "$val" ] && [ -f "$REPO_DIR/.env" ]; then
        val="$(grep -E "^${1}=" "$REPO_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')" || val=""
    fi
    printf '%s' "$val"
}

offsite_backup() {
    local endpoint bucket access_key secret_key retention_days
    endpoint="$(offsite_read_env S3_BACKUP_ENDPOINT)"
    bucket="$(offsite_read_env S3_BACKUP_BUCKET)"
    access_key="$(offsite_read_env S3_BACKUP_ACCESS_KEY)"
    secret_key="$(offsite_read_env S3_BACKUP_SECRET_KEY)"

    if [ -z "$endpoint" ] || [ -z "$bucket" ] || [ -z "$access_key" ] || [ -z "$secret_key" ]; then
        offsite_log "offsite не настроен — пропускаю."
        return 0
    fi

    retention_days="$(offsite_read_env S3_BACKUP_RETENTION_DAYS)"
    case "$retention_days" in
        '' | *[!0-9]*) retention_days=30 ;;
    esac

    export RCLONE_CONFIG_OFFSITE_TYPE="s3"
    export RCLONE_CONFIG_OFFSITE_PROVIDER="Other"
    export RCLONE_CONFIG_OFFSITE_ENDPOINT="$endpoint"
    export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$access_key"
    export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$secret_key"

    # ${BACKUP_DIR} — путь ХОСТА: -v интерпретирует docker-демон, поэтому
    # работает и с хоста, и из webhook-контейнера (как alpine-tar выше).
    offsite_rclone() {
        docker run --rm \
            -v "${BACKUP_DIR}":/backups:ro \
            -e RCLONE_CONFIG_OFFSITE_TYPE \
            -e RCLONE_CONFIG_OFFSITE_PROVIDER \
            -e RCLONE_CONFIG_OFFSITE_ENDPOINT \
            -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID \
            -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY \
            rclone/rclone:latest "$@"
    }

    local failed=0 f base
    for f in "$BACKUP_FILE" "$UPLOADS_FILE"; do
        # Выгружаем только реально созданные В ЭТОМ запуске файлы:
        # uploads-архива может не быть (volume не найден / tar упал).
        [ -s "$f" ] || continue
        base="$(basename "$f")"
        offsite_log "Загружаю ${base} → ${bucket}/autexa/ ..."
        if offsite_rclone copy "/backups/${base}" "offsite:${bucket}/autexa/" \
            --s3-no-check-bucket --contimeout 10s --retries 2 2>&1; then
            offsite_log "OK: ${base} загружен."
        else
            failed=1
            offsite_log "WARNING: НЕ удалось загрузить ${base} — offsite-копии этого файла НЕТ (локальный бэкап цел)."
        fi
    done

    # Удалённая ретенция: удаляем в бакете только файлы старше N дней.
    if offsite_rclone delete "offsite:${bucket}/autexa/" \
        --min-age "${retention_days}d" --contimeout 10s --retries 2 2>&1; then
        offsite_log "Ретенция: offsite-файлы старше ${retention_days} дн. удалены."
    else
        failed=1
        offsite_log "WARNING: ретенция offsite не выполнилась — старые файлы могли остаться в бакете."
    fi

    if [ "$failed" = "1" ]; then
        offsite_log "WARNING: offsite-выгрузка прошла С ОШИБКАМИ (см. выше). Локальный бэкап и деплой НЕ пострадали."
    else
        offsite_log "Offsite-копия готова: ${bucket}/autexa/ (ретенция ${retention_days} дн.)."
    fi
    return 0
}

# `|| ...`-обвязка: скрипт под `set -e`, offsite не должен уронить бэкап
# даже при неожиданном сбое (docker недоступен, нет сети и т.п.).
offsite_backup || offsite_log "WARNING: offsite-шаг завершился аварийно — локальный бэкап цел."
