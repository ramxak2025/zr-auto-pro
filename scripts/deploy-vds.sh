#!/bin/bash
set -e

echo "=== Deploying zr-auto-pro ==="

# Pull latest code
git pull origin main

# Copy env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — please edit it!"
fi

# Build and start containers
docker compose build --no-cache
docker compose up -d

echo "=== Deployment complete ==="
echo "Frontend: http://localhost:8080"
echo "Backend:  http://localhost:3000"
echo "Default login: +798 (84) 444-44-36 / admin123"
