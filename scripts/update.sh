#!/bin/bash
set -e

echo "=== Updating zr-auto-pro ==="

# Backup database first
bash scripts/backup.sh

# Pull latest
git pull origin main

# Rebuild and restart
docker compose build
docker compose up -d

echo "=== Update complete ==="
