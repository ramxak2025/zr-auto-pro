#!/bin/bash
# ============================================================
# Autexa / zr-auto-pro — VDS auto-deploy poller
#
# Запускается cron'ом каждую минуту на VDS (root crontab):
#   * * * * * /opt/zr-auto-pro/scripts/auto-pull.sh >> /var/log/zr-autodeploy.log 2>&1
#
# Следит за веткой refactor/full-audit-2026. При появлении нового
# коммита вызывает deploy.sh (backup БД + ребилд backend+frontend,
# postgres-контейнер не пересобирается).
#
# Логи: /var/log/zr-autodeploy.log
# ============================================================

set -e

REPO_DIR="${REPO_DIR:-/opt/zr-auto-pro}"
BRANCH="${DEPLOY_BRANCH:-refactor/full-audit-2026}"

cd "$REPO_DIR"

LOCAL=$(git rev-parse HEAD)
git fetch origin "$BRANCH" -q
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] New commit on $BRANCH ($LOCAL -> $REMOTE), deploying..."
    bash "$REPO_DIR/deploy.sh"
fi
