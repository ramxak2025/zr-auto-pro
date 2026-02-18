#!/bin/bash
set -e

echo "=== Updating zr-auto-pro ==="

# Backup database first
bash scripts/backup.sh

# Pull latest
BRANCH="${1:-claude/redesign-from-scratch-5xQJz}"
git pull origin "$BRANCH"

# Rebuild and restart
docker compose build
docker compose up -d

echo "=== Update complete ==="
