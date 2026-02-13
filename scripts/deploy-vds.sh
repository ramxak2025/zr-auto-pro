#!/bin/bash
# =============================================================================
# ZR Auto Pro — VDS Deployment Script
# Запуск: bash deploy-vds.sh
# Сервер: Ubuntu 22.04+ / Debian 11+
# =============================================================================

set -euo pipefail

SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
APP_DIR="/opt/zr-auto-pro"
REPO_URL="https://github.com/ramxak2025/zr-auto-pro.git"

echo "============================================="
echo "  ZR Auto Pro — Деплой на VDS"
echo "  IP: ${SERVER_IP}"
echo "============================================="

# ─── 1. Обновление системы и установка зависимостей ──────────────────────────
echo ""
echo ">>> [1/6] Обновление системы..."
apt-get update -y
apt-get install -y curl git ca-certificates gnupg lsb-release ufw

# ─── 2. Установка Docker ─────────────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo ""
  echo ">>> [2/6] Установка Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo ""
  echo ">>> [2/6] Docker уже установлен: $(docker --version)"
fi

# Docker Compose plugin
if ! docker compose version &> /dev/null; then
  echo ">>> Установка Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
fi

echo "Docker Compose: $(docker compose version)"

# ─── 3. Настройка фаервола ────────────────────────────────────────────────────
echo ""
echo ">>> [3/6] Настройка UFW (firewall)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable || true
ufw status

# ─── 4. Клонирование / обновление репозитория ─────────────────────────────────
echo ""
echo ">>> [4/6] Клонирование репозитория..."
if [ -d "$APP_DIR/.git" ]; then
  echo "Репозиторий уже существует, обновляю..."
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ─── 5. Создание .env файла ──────────────────────────────────────────────────
echo ""
echo ">>> [5/6] Настройка .env..."

JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
# Database
DB_PASSWORD=${DB_PASSWORD}

# JWT
JWT_SECRET=${JWT_SECRET}

# Frontend API URL
VITE_API_URL=http://${SERVER_IP}/api

# S3 Storage (заполните если нужно)
S3_ENDPOINT=https://s3.timeweb.cloud
S3_REGION=ru-1
S3_BUCKET=zr-auto-pro
S3_ACCESS_KEY=
S3_SECRET_KEY=
EOF
  echo ".env создан с безопасными паролями"
else
  echo ".env уже существует, пропускаю"
  # Но обновим VITE_API_URL на актуальный IP
  if grep -q "VITE_API_URL" "$APP_DIR/.env"; then
    sed -i "s|VITE_API_URL=.*|VITE_API_URL=http://${SERVER_IP}/api|" "$APP_DIR/.env"
    echo "VITE_API_URL обновлён на http://${SERVER_IP}/api"
  fi
fi

echo ""
echo ">>> [6/6] Запуск Docker Compose..."
cd "$APP_DIR"

# Останавливаем старые контейнеры если есть
docker compose down --remove-orphans 2>/dev/null || true

# Собираем и запускаем
docker compose up -d --build

echo ""
echo ">>> Ожидание запуска сервисов (30 сек)..."
sleep 30

# ─── Проверка ─────────────────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  Проверка сервисов"
echo "============================================="

docker compose ps

echo ""

# Проверяем backend
if curl -sf http://localhost:3000/api > /dev/null 2>&1; then
  echo "✓ Backend работает на порту 3000"
else
  echo "⚠ Backend пока не отвечает (может загружаться)"
  echo "  Проверьте логи: docker compose logs backend"
fi

# Проверяем frontend/nginx
if curl -sf http://localhost:80 > /dev/null 2>&1; then
  echo "✓ Frontend работает на порту 80"
else
  echo "⚠ Frontend пока не отвечает"
  echo "  Проверьте логи: docker compose logs frontend"
fi

echo ""
echo "============================================="
echo "  Деплой завершён!"
echo "============================================="
echo ""
echo "  Приложение: http://${SERVER_IP}"
echo "  API:        http://${SERVER_IP}/api"
echo ""
echo "  Полезные команды:"
echo "    cd ${APP_DIR}"
echo "    docker compose logs -f          # логи всех сервисов"
echo "    docker compose logs -f backend  # логи бэкенда"
echo "    docker compose restart          # перезапуск"
echo "    docker compose down             # остановка"
echo "    docker compose up -d --build    # пересборка"
echo ""
echo "  Бэкап БД:"
echo "    bash ${APP_DIR}/scripts/backup.sh"
echo ""
