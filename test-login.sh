#!/bin/bash
# Test login from all angles
echo "=== 1. Backend direct (port 3000) ==="
RESULT=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+79884444436","password":"admin123"}')
echo "$RESULT" | head -c 200
echo ""
echo ""

echo "=== 2. Via nginx (port 8080) ==="
RESULT2=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+79884444436","password":"admin123"}')
echo "$RESULT2" | head -c 200
echo ""
echo ""

echo "=== 3. Demo owner login ==="
RESULT3=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+70000000001","password":"demo123"}')
echo "$RESULT3" | head -c 200
echo ""
echo ""

echo "=== 4. Frontend phone format test ==="
RESULT4=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+7 (988) 444-44-36","password":"admin123"}')
echo "$RESULT4" | head -c 200
echo ""
echo ""

echo "=== 5. Container status ==="
docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null
echo ""

echo "=== 6. Backend logs (last 20 lines) ==="
docker compose logs backend --tail 20 2>/dev/null || docker-compose logs backend --tail 20 2>/dev/null
