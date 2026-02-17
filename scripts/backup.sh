#!/bin/bash
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="backup_${TIMESTAMP}.sql"

mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump -U postgres zr_auto_pro > "${BACKUP_DIR}/${FILENAME}"

echo "Backup saved to ${BACKUP_DIR}/${FILENAME}"
