#!/bin/bash
set -e

echo "============================================"
echo "  ZR Auto Pro — Full Server Setup"
echo "  Server: $(hostname) / $(curl -s ifconfig.me 2>/dev/null || echo 'unknown')"
echo "============================================"

# 1. Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo ">>> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installed!"
else
  echo "Docker already installed: $(docker --version)"
fi

# 2. Install Docker Compose plugin if not present
if ! docker compose version &>/dev/null; then
  echo ">>> Installing Docker Compose plugin..."
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin
  echo "Docker Compose installed!"
else
  echo "Docker Compose already installed: $(docker compose version)"
fi

# 3. Install Git if not present
if ! command -v git &>/dev/null; then
  echo ">>> Installing Git..."
  apt-get update -qq
  apt-get install -y -qq git
fi

# 4. Clone or update repository
APP_DIR="/opt/zr-auto-pro"
REPO_URL="https://github.com/ramxak2025/zr-auto-pro.git"
BRANCH="claude/redesign-from-scratch-5xQJz"

if [ -d "$APP_DIR/.git" ]; then
  echo ">>> Updating existing repo..."
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo ">>> Cloning repository..."
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# 5. Create .env with production values
if [ ! -f "$APP_DIR/.env" ]; then
  echo ">>> Creating .env..."
  cat > "$APP_DIR/.env" << 'ENVFILE'
# Database
DB_PASSWORD=ZrAut0Pr0_Db_2024!

# JWT (production secret)
JWT_SECRET=zr-auto-pro-jwt-secret-k8s9d7f2h4j6m8n0p2r4t6v8x0z

# S3 Storage (optional — leave empty for local uploads)
S3_ENDPOINT=
S3_REGION=ru-1
S3_BUCKET=zr-auto-pro
S3_ACCESS_KEY=
S3_SECRET_KEY=

# Frontend API URL (nginx proxies /api to backend)
VITE_API_URL=/api
ENVFILE
  echo ".env created with production values!"
else
  echo ".env already exists, keeping it."
fi

# 6. Stop old containers if running
echo ">>> Stopping old containers..."
cd "$APP_DIR"
docker compose down 2>/dev/null || true

# 7. Build and start
echo ">>> Building and starting containers..."
docker compose up -d --build

# 8. Wait for services to be ready
echo ">>> Waiting for services to start..."
sleep 10

# 9. Check status
echo ""
echo "============================================"
echo "  DEPLOYMENT COMPLETE!"
echo "============================================"
echo ""
docker compose ps
echo ""
echo "Frontend: http://212.8.229.254:8080"
echo "Backend:  http://212.8.229.254:3000/api"
echo ""
echo "Login: +798 (84) 444-44-36 / admin123"
echo ""
echo "Logs:  docker compose logs -f"
echo "============================================"
