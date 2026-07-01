#!/bin/bash
# ============================================================
# ZR Auto Pro — Safe Deploy Script
# АВТОМАТИЧЕСКИ делает бэкап базы перед каждым обновлением.
# Данные клиентов НИКОГДА не удаляются.
#
# Использование: ./deploy.sh
# ============================================================

set -e

# When run from webhook container, repo is at /deploy/repo
# When run from host, it should be at /opt/zr-auto-pro
if [ -d "/deploy/repo" ]; then
    REPO_DIR="/deploy/repo"
else
    REPO_DIR="/opt/zr-auto-pro"
fi

BRANCH="${DEPLOY_BRANCH:-refactor/full-audit-2026}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# ── Deploy lock (защита от ПАРАЛЛЕЛЬНЫХ деплоев) ─────────────────────────────
# cron (scripts/auto-pull.sh на хосте) и webhook-контейнер могут вызвать этот
# скрипт ОДНОВРЕМЕННО — два параллельных `docker compose build/up` портят
# образы и гоняют recreate друг против друга. Лок-файл лежит в корне репо:
# репо bind-mounted в webhook-контейнер как /deploy/repo, поэтому хост и
# контейнер контендятся на ОДНОМ и том же inode. flock -n: второй деплой не
# ждёт, а тихо выходит (exit 0) — cron всё равно повторит через минуту, когда
# текущий деплой завершится. Fd 200 держит лок до конца процесса.
exec 200>"$REPO_DIR/.deploy.lock"
if command -v flock >/dev/null 2>&1; then
    flock -n 200 || {
        log "Another deploy is already in progress (lock: $REPO_DIR/.deploy.lock) — skipping."
        exit 0
    }
else
    # flock отсутствует (нестандартное окружение) — НЕ блокируем деплой,
    # иначе деплои перестали бы выполняться вовсе. Просто предупреждаем.
    log "WARNING: flock not available — proceeding WITHOUT deploy lock."
fi

# ── recreate_and_wait <service> [timeout_s] ──────────────────────────────────
# Force-recreate ONE service and block until its container is healthy (or
# timeout). Used for the rolling, one-replica-at-a-time backend recreate so the
# OTHER replica keeps serving /api the whole time. Returns non-zero on timeout
# (caller aborts the deploy).
recreate_and_wait() {
    local svc="$1"
    local timeout="${2:-90}"
    log "Rolling recreate: $svc ..."
    docker compose up -d --no-deps --force-recreate "$svc" 2>&1
    local deadline=$(( $(date +%s) + timeout ))
    local attempt=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        attempt=$((attempt + 1))
        local cid
        cid=$(docker compose ps -q "$svc" 2>/dev/null | head -1)
        local inside=0
        local dhealth="unknown"
        if [ -n "$cid" ]; then
            if docker exec "$cid" node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
                inside=1
            fi
            dhealth=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$cid" 2>/dev/null || echo "unknown")
        fi
        if [ "$dhealth" = "healthy" ] || [ "$inside" = "1" ]; then
            log "$svc healthy (attempt $attempt): docker=$dhealth inside=$inside"
            return 0
        fi
        log "$svc not ready yet (attempt $attempt): docker=$dhealth inside=$inside — retrying..."
        sleep 3
    done
    log "ERROR: $svc did NOT become healthy within ${timeout}s."
    docker compose logs --tail=50 "$svc" 2>&1 || true
    return 1
}

log "=== Starting deploy ==="
log "Repo: $REPO_DIR"
log "Branch: $BRANCH"

cd "$REPO_DIR"

# ═══════════════════════════════════════════════════════
# STEP -1: Освобождаем диск ПЕРЕД бэкапом и сборкой.
# Причина: `docker compose build --no-cache` ниже создаёт полный
# набор слоёв образа на КАЖDOM деплое, а backup.sh пишет дамп БД
# каждый раз. За день из нескольких деплоев диск забивается старыми
# образами / build-cache / дампами → `docker build` падает на «no space»,
# и старый контейнер продолжает отдавать устаревший код. Эта очистка
# делает деплой самовосстанавливающимся и идемпотентна.
# pgdata НЕ трогаем: prune без --volumes, ротация только в backups/.
# ═══════════════════════════════════════════════════════
log "=== Freeing disk before deploy (prune unused images + build cache, rotate backups) ==="
df -h / 2>&1 | tail -1 || true
docker image prune -af 2>&1 || true
docker builder prune -af 2>&1 || true
# Держим только 10 самых свежих файлов КАЖДОГО типа в backups/ (по mtime).
# Раздельные паттерны: большие uploads-архивы не должны вытеснять SQL-дампы
# из окна хранения (и наоборот).
if [ -d "$REPO_DIR/backups" ]; then
    ls -t "$REPO_DIR"/backups/*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
    ls -t "$REPO_DIR"/backups/*.sql 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
    ls -t "$REPO_DIR"/backups/uploads_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
fi
df -h / 2>&1 | tail -1 || true

# ═══════════════════════════════════════════════════════
# STEP 0: AUTOMATIC BACKUP before any changes
# ═══════════════════════════════════════════════════════
log "=== Creating backup before deploy ==="
if bash "$REPO_DIR/backup.sh" 2>&1; then
    log "Backup completed successfully"
else
    log "WARNING: Backup failed, but continuing deploy..."
    log "Check backup.sh manually if needed"
fi

# ═══════════════════════════════════════════════════════
# STEP 1: Pull latest code (safely)
# ═══════════════════════════════════════════════════════
log "Fetching branch: $BRANCH"
git fetch origin "$BRANCH" 2>&1
git checkout "$BRANCH" 2>&1 || true

# Stash any local changes instead of destroying them
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    log "Stashing local changes..."
    git stash push -m "auto-stash before deploy $(date '+%Y%m%d-%H%M%S')" 2>&1 || true
fi

git merge --ff-only "origin/$BRANCH" 2>&1 || {
    log "ERROR: Cannot fast-forward merge. Manual intervention required."
    log "Local branch has diverged from origin/$BRANCH"
    exit 1
}

log "Git pull complete. Latest commit:"
git log --oneline -1 2>&1

# ═══════════════════════════════════════════════════════
# STEP 1.5: Копируем последний APK в папку для скачивания
# ═══════════════════════════════════════════════════════
mkdir -p "$REPO_DIR/downloads"
LATEST_APK=$(ls -t "$REPO_DIR"/Autexa-v*.apk 2>/dev/null | head -1)
if [ -n "$LATEST_APK" ]; then
    cp "$LATEST_APK" "$REPO_DIR/downloads/Autexa.apk"
    log "APK для скачивания обновлён: $LATEST_APK → downloads/Autexa.apk"
else
    log "APK файл не найден — пропускаем"
fi

# ═══════════════════════════════════════════════════════
# STEP 2: ROLLING zero-downtime rebuild + recreate.
# Volume pgdata is NEVER touched — data is safe.
#
# Два backend-реплики (backend + backend2) за nginx-апстримом + idempotent
# proxy_next_upstream фейловер. Порядок критичен:
#   build → backend2 (recreate + ЖДЁМ healthy) → nginx -t гейт → frontend →
#   → лидер backend (recreate + ЖДЁМ healthy).
# Лидера трогаем ТОЛЬКО после того, как backend2 реально прошёл health-гейт.
# Раньше здесь был голый `up -d backend2` без ожидания — лидер убивался, пока
# backend2 ещё бутился/мигрировал → окно «обе реплики мертвы» (502/504).
# ═══════════════════════════════════════════════════════
log "Rebuilding backend + frontend images (no cache)..."
docker compose build --no-cache backend frontend 2>&1

# Пересоздать ВТОРУЮ реплику (HTTP-only) на новом образе и ДОЖДАТЬСЯ health.
# Пока backend2 бутится/мигрирует — лидер продолжает отдавать /api на старом
# коде. Если backend2 не поднялся — ABORT: лидер и старый frontend не тронуты,
# прод продолжает работать на старом коде.
if ! recreate_and_wait backend2; then
    log "=== Deploy FAILED (backend2 unhealthy after recreate — leader untouched, old code still serving) ==="
    docker compose ps 2>&1 || true
    exit 1
fi

# ── ГЛАВНЫЙ предохранитель против аварии «битый nginx уронил /api» ──────────
# Проверяем НОВЫЙ frontend-образ `nginx -t` во ВРЕМЕННОМ контейнере, прицепленном
# к compose-сети, чтобы `backend`/`backend2` в статическом upstream резолвились.
# Если конфиг битый — ABORT СЕЙЧАС: старый frontend продолжает отдавать сайт.
log "Validating new nginx config (nginx -t) in-network..."
if ! docker compose run --rm --no-deps frontend nginx -t 2>&1; then
    log "ERROR: new nginx config failed nginx -t — ABORTING deploy. Old frontend still serving."
    exit 1
fi
log "nginx config OK."

# Пересоздать frontend (новый nginx: 2-реплики upstream + фейловер). Короткий
# blip статики (~1-2с) — как и при обычном веб-деплое; /api переживает за счёт
# двух живых backend-реплик.
log "Recreating frontend (new nginx with failover)..."
docker compose up -d --no-deps --force-recreate frontend 2>&1

# Пересоздать ЛИДЕРА. backend2 уже здоров на новом коде (гейт выше) — nginx
# фейловерит на него, пока лидер пересоздаётся: пользователь не видит 502/504.
# Повторный recreate backend2 здесь НЕ нужен — он уже на новом образе.
if ! recreate_and_wait backend; then
    log "=== Deploy FAILED (backend unhealthy after recreate) ==="
    docker compose ps 2>&1 || true
    exit 1
fi

# ═══════════════════════════════════════════════════════
# STEP 2.5: Финальный public-path gate — nginx реально маршрутизирует на /api.
# Подтверждаем 200 через публичный путь (localhost:8080/api/health) — значит
# nginx переразрешил новые IP реплик и фейловер работает.
# ═══════════════════════════════════════════════════════
log "Confirming public /api/health (timeout 30s)..."
PUBLIC_DEADLINE=$(( $(date +%s) + 30 ))
PUBLIC_OK=0
while [ "$(date +%s)" -lt "$PUBLIC_DEADLINE" ]; do
    PUBLIC_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8080/api/health 2>/dev/null || echo "000")
    if [ "$PUBLIC_CODE" = "200" ]; then
        PUBLIC_OK=1
        log "Public /api/health: 200 OK"
        break
    fi
    log "Public /api/health not 200 yet ($PUBLIC_CODE) — retrying..."
    sleep 3
done
if [ "$PUBLIC_OK" != "1" ]; then
    log "ERROR: public /api/health never returned 200 after rolling deploy."
    docker compose logs --tail=50 frontend 2>&1 || true
    docker compose ps 2>&1 || true
    log "=== Deploy FAILED (public path unhealthy) ==="
    exit 1
fi

# Check status
log "Container status:"
docker compose ps 2>&1

# Clean up old images
docker image prune -f 2>&1 || true

log "=== Deploy complete ==="
log ""
log "IMPORTANT: Data is safe. Backups are in: $REPO_DIR/backups/"
log "To restore: ./restore.sh"

# deploy trigger: 2026-06-19 (rolling 2-replica zero-downtime + in-network nginx -t gate)
