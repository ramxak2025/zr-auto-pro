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
# Держим только 10 самых свежих дампов в backups/ (по времени модификации).
if [ -d "$REPO_DIR/backups" ]; then
    ls -t "$REPO_DIR"/backups/* 2>/dev/null | tail -n +11 | xargs -r rm -f 2>&1 || true
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
# STEP 2: Rebuild ONLY backend + frontend (NOT postgres!)
# Volume pgdata is NEVER touched — data is safe.
# ═══════════════════════════════════════════════════════
log "Rebuilding backend and frontend containers (no cache)..."
docker compose build --no-cache backend frontend 2>&1
docker compose up -d --no-deps --force-recreate backend frontend 2>&1

# ═══════════════════════════════════════════════════════
# STEP 2.5: Health-gate — wait until the NEW backend actually answers.
# Replaces the old blind `sleep 8`, which could declare a deploy "complete"
# while backend was still booting (migrations, JIT warm-up) → users hit 502.
# We poll the backend's own /api/health from INSIDE the backend container
# (no host port exposed for backend), and also confirm the public path through
# the frontend (localhost:8080/api/health) so we know nginx re-resolved the new
# container IP. Either signal alone is enough to consider backend "up".
# Timeout ~90s; on timeout → loud error + non-zero exit (deploy NOT successful).
# ═══════════════════════════════════════════════════════
log "Waiting for backend health (timeout 90s)..."
HEALTH_TIMEOUT=90
HEALTH_DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
HEALTH_OK=0
ATTEMPT=0

while [ "$(date +%s)" -lt "$HEALTH_DEADLINE" ]; do
    ATTEMPT=$((ATTEMPT + 1))

    # 1) Docker-reported health status of the backend container (if defined).
    BACKEND_CID=$(docker compose ps -q backend 2>/dev/null | head -1)
    DOCKER_HEALTH="unknown"
    if [ -n "$BACKEND_CID" ]; then
        DOCKER_HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$BACKEND_CID" 2>/dev/null || echo "unknown")
    fi

    # 2) Backend answers its own /api/health from inside its container.
    INSIDE_OK=0
    if [ -n "$BACKEND_CID" ]; then
        if docker exec "$BACKEND_CID" node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" 2>/dev/null; then
            INSIDE_OK=1
        fi
    fi

    # 3) Public path through frontend nginx (confirms nginx re-resolved new IP).
    PUBLIC_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8080/api/health 2>/dev/null || echo "000")

    if [ "$DOCKER_HEALTH" = "healthy" ] || [ "$INSIDE_OK" = "1" ] || [ "$PUBLIC_CODE" = "200" ]; then
        HEALTH_OK=1
        log "Backend healthy (attempt $ATTEMPT): docker=$DOCKER_HEALTH inside=$INSIDE_OK public=$PUBLIC_CODE"
        break
    fi

    log "Backend not ready yet (attempt $ATTEMPT): docker=$DOCKER_HEALTH inside=$INSIDE_OK public=$PUBLIC_CODE — retrying..."
    sleep 3
done

if [ "$HEALTH_OK" != "1" ]; then
    log "ERROR: Backend did NOT become healthy within ${HEALTH_TIMEOUT}s."
    log "Recent backend logs:"
    docker compose logs --tail=50 backend 2>&1 || true
    log "Container status:"
    docker compose ps 2>&1 || true
    log "=== Deploy FAILED (backend unhealthy) ==="
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

# deploy trigger: 2026-06-13 (self-heal cycle for early-prune deploy.sh)
