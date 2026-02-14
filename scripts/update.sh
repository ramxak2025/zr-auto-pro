#!/bin/bash
# =============================================================================
# ZR Auto Pro — Quick Update Script
# Обновляет код из git и пересобирает Docker контейнеры
# Запуск: bash /opt/zr-auto-pro/scripts/update.sh [branch-name]
# =============================================================================

set -euo pipefail

APP_DIR="/opt/zr-auto-pro"
BRANCH="${1:-claude/auto-service-crm-app-SPKll}"

echo "============================================="
echo "  ZR Auto Pro — Обновление"
echo "  Ветка: ${BRANCH}"
echo "============================================="

cd "$APP_DIR"

echo ""
echo ">>> [1/4] Обновление кода из Git..."
git fetch origin
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

echo ""
echo ">>> [2/4] Остановка контейнеров..."
docker compose down --remove-orphans 2>/dev/null || true

echo ""
echo ">>> [3/4] Пересборка и запуск..."
docker compose up -d --build

echo ""
echo ">>> [4/4] Ожидание запуска (20 сек)..."
sleep 20

echo ""
echo "============================================="
echo "  Проверка сервисов"
echo "============================================="
docker compose ps

echo ""
if curl -sf http://localhost:3000/api > /dev/null 2>&1; then
  echo "Backend OK"
else
  echo "Backend loading... (check: docker compose logs backend)"
fi

if curl -sf http://localhost:80 > /dev/null 2>&1; then
  echo "Frontend OK"
else
  echo "Frontend loading... (check: docker compose logs frontend)"
fi

echo ""
echo "Обновление завершено!"
echo ""
echo "Логи: docker compose logs -f"
echo ""
