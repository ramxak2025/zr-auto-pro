#!/bin/bash
# Auto-deploy script for ZR Auto Pro
# Works both from host and from webhook container (with docker socket mounted)
# Usage: ./deploy.sh

set -e

# When run from webhook container, repo is at /deploy/repo
# When run from host, it should be at /opt/zr-auto-pro
if [ -d "/deploy/repo" ]; then
    REPO_DIR="/deploy/repo"
else
    REPO_DIR="/opt/zr-auto-pro"
fi

BRANCH="${DEPLOY_BRANCH:-claude/redesign-from-scratch-5xQJz}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=== Starting deploy ==="
log "Repo: $REPO_DIR"
log "Branch: $BRANCH"

cd "$REPO_DIR"

# Pull latest changes
log "Fetching branch: $BRANCH"
git fetch origin "$BRANCH" 2>&1
git checkout "$BRANCH" 2>&1 || true
git reset --hard "origin/$BRANCH" 2>&1

log "Git pull complete. Latest commit:"
git log --oneline -1 2>&1

# Rebuild and restart (only backend + frontend, not webhook itself)
log "Rebuilding backend and frontend containers..."
docker compose up -d --build --no-deps backend frontend 2>&1

# Wait for health check
log "Waiting for services to start..."
sleep 8

# Check status
log "Container status:"
docker compose ps 2>&1

# Clean up old images
docker image prune -f 2>&1 || true

log "=== Deploy complete ==="
