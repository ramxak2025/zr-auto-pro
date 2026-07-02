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
        # Частичный архив удаляем (как в корневом backup.sh), чтобы offsite-шаг
        # ниже не выгрузил битый файл.
        echo "WARNING: uploads backup failed — DB dump is intact."
        rm -f "${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"
    fi
else
    echo "WARNING: uploads volume not found — skipping uploads backup."
fi

# ============================================================
# Offsite-копия в S3-совместимое хранилище (ОПЦИОНАЛЬНО).
# Зеркало offsite-блока из корневого backup.sh — подробные комментарии там
# и в docs/OFFSITE_BACKUPS.md. Включается только когда заданы ВСЕ четыре
# S3_BACKUP_* (в окружении или в ./.env; значения НИКОГДА не логируем).
# Любая ошибка offsite — только WARNING: локальный бэкап уже создан.
# ============================================================

# Скрипт и так предполагает запуск из корня репо (docker compose, ./backups).
REPO_DIR="$(pwd)"

offsite_log() { echo "[offsite] $1"; }

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

    # ${BACKUP_DIR_ABS} — абсолютный путь хоста: -v интерпретирует
    # docker-демон, а не этот скрипт (как alpine-tar выше).
    offsite_rclone() {
        docker run --rm \
            -v "${BACKUP_DIR_ABS}":/backups:ro \
            -e RCLONE_CONFIG_OFFSITE_TYPE \
            -e RCLONE_CONFIG_OFFSITE_PROVIDER \
            -e RCLONE_CONFIG_OFFSITE_ENDPOINT \
            -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID \
            -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY \
            rclone/rclone:latest "$@"
    }

    local failed=0 f base
    for f in "${BACKUP_DIR}/${FILENAME}" "${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"; do
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
        offsite_log "WARNING: offsite-выгрузка прошла С ОШИБКАМИ (см. выше). Локальный бэкап НЕ пострадал."
    else
        offsite_log "Offsite-копия готова: ${bucket}/autexa/ (ретенция ${retention_days} дн.)."
    fi
    return 0
}

# `|| ...`-обвязка: скрипт под `set -e`, offsite не должен уронить бэкап.
offsite_backup || offsite_log "WARNING: offsite-шаг завершился аварийно — локальный бэкап цел."
