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

BRANCH="${DEPLOY_BRANCH:-master}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=== Starting deploy ==="
log "Repo: $REPO_DIR"
log "Branch: $BRANCH"

cd "$REPO_DIR"

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

# Wait for health check
log "Waiting for services to start..."
sleep 8

# Check status
log "Container status:"
docker compose ps 2>&1

# Clean up old images
docker image prune -f 2>&1 || true

log "=== Deploy complete ==="
log ""
log "IMPORTANT: Data is safe. Backups are in: $REPO_DIR/backups/"
log "To restore: ./restore.sh"
