# Локальная разработка Autexa на MacBook

Цель: владелец качает проект на свой Mac, делает все правки и проверки локально, и только после ручного approve пушит в `refactor/full-audit-2026` (откуда webhook деплоит на VDS).

## 1. Однократная установка

```bash
# Инструменты
brew install node@20 git cocoapods watchman
brew install --cask docker          # Docker Desktop (нужен для локального Postgres)
xcode-select --install               # если ещё не стояло

# Xcode + iOS Simulator — из App Store. Минимально — Xcode 16.
# Для Android (когда тронут shared-код):
brew install --cask android-platform-tools android-studio

# Глобальные npm-инструменты
npm i -g eas-cli
```

## 2. Клонирование репо

```bash
cd ~/projects
git clone git@github.com:ramxak2025/zr-auto-pro.git
cd zr-auto-pro

# Актуальная ветка прода — refactor/full-audit-2026
git checkout refactor/full-audit-2026
git pull
```

## 3. Зависимости

```bash
npm run install:all   # ставит backend / frontend / mobile одной командой
```

## 4. Локальная база и backend

```bash
# Поднять Postgres локально (через Docker, чтобы не мешать другим проектам)
docker run -d \
  --name autexa-pg \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=autexa \
  -p 5432:5432 \
  postgres:16

# Скопировать .env.example → backend/.env и поправить значения
cp .env.example backend/.env
# Выставить:
#   DB_HOST=localhost
#   DB_PORT=5432
#   DB_USER=postgres
#   DB_PASSWORD=devpass
#   DB_NAME=autexa
#   JWT_SECRET=<любая строка ≥32 байт>

# Старт API
cd backend && npm run start:dev
# Миграции применяются автоматически в MigrationRunner при старте.
```

## 5. Web

```bash
cd frontend
cp .env.example .env   # выставить VITE_API_URL=http://localhost:3000/api
npm run dev
# открыть http://localhost:5173
```

## 6. Mobile в iOS Simulator

```bash
cd mobile

# Если изменился app.json / native module — обязательно prebuild + pods
npx expo prebuild --platform ios --clean
cd ios && pod install && cd ..

# Запустить
npm run ios
# Или из Xcode: open ios/Autexa.xcworkspace, выбрать симулятор, ▶ Run
```

## 7. Mobile на физическом iPhone

1. Включить Developer Mode на iPhone (Settings → Privacy & Security → Developer Mode).
2. Подключить iPhone к Mac кабелем или включить Wireless Debugging.
3. В Xcode выбрать устройство → ▶ Run.
4. На iPhone разрешить developer certificate (Settings → General → VPN & Device Management).

## 8. Android (когда тронут shared RN-код)

```bash
cd mobile
# Запустить эмулятор из Android Studio, затем:
npm run android
```

## 9. Цикл «правка → проверка → релиз»

```
1. Создать feature-branch от refactor/full-audit-2026:
     git checkout -b feature/<short-name>

2. Сделать правки локально. Скрипт проверок (Mac-friendly):

     # все три проекта
     npm run typecheck
     npm run lint

     # тесты mobile (jest не запускается в CI)
     cd mobile && npx jest && cd ..

     # plate-mask должен быть зелёным
     cd mobile && npx jest src/utils/__tests__/plateMask.test.ts && cd ..

     # web build (одновременно проверяет типы)
     cd frontend && npm run build && cd ..

     # iOS build (если менялся native)
     cd mobile && xcodebuild -workspace ios/Autexa.xcworkspace \
       -scheme Autexa -configuration Debug -sdk iphonesimulator build && cd ..

3. Smoke-проход:
   - iOS Simulator: главные экраны открываются, нет крашей
   - физический iPhone: ключевая фича работает (если она iOS-only)
   - web: dev-server, золотой путь

4. Commit + push в свою feature-branch:
     git push -u origin feature/<short-name>

5. Открыть PR в refactor/full-audit-2026 на GitHub. Просмотреть весь diff.

6. Merge через GitHub UI (squash merge — чище история).

7. Push в refactor/full-audit-2026 → автодеплой на VDS:
   - На VDS cron каждую минуту запускает /opt/zr-auto-pro/auto-pull.sh
   - Скрипт делает `git fetch origin refactor/full-audit-2026` и сравнивает SHA
   - При новом коммите вызывает /opt/zr-auto-pro/deploy.sh:
       backup БД (./backup.sh) → git pull --ff-only → docker compose build --no-cache backend frontend
       → docker compose up -d --no-deps --force-recreate backend frontend
   - Postgres-контейнер не пересобирается, volume pgdata цел.
   - До первого деплоя проходит до 60 секунд после push.
   - Логи: /var/log/zr-autodeploy.log на VDS.

8. Проверить прод: <prod-url>/api/health должен ответить ok.
```

**Важно про деплой:** `.github/workflows/deploy.yml` и контейнер `zr-auto-pro-webhook-1` сейчас фактически не используются — в их конфигурации устаревшие ветки (`main`, `claude/redesign-from-scratch-5xQJz`). Единственный рабочий механизм — cron + auto-pull.sh на хосте VDS. Скрипт `scripts/deploy-vds.sh` в репо тоже устарел (тянет `main`, пересобирает все контейнеры включая postgres). Не пользоваться им, не запускать руками.

## 10. Чего НЕ делать

- Не работать в `claude/*` ветках для прод-правок. Они для песочниц Claude Code на web и устаревают.
- Не пушить feature-branch напрямую в `refactor/full-audit-2026` — только через PR.
- Не коммитить `.env*` (есть в `.gitignore`).
- Не редактировать уже применённые миграции `backend/migrations/0XX_*.sql`.
- Не дёргать `mobile/ios/**` руками — оно регенерируется `expo prebuild --clean`.

## 11. Если что-то сломалось

| Симптом | Что попробовать |
|---|---|
| Metro не стартует | `cd mobile && npx expo start --clear` |
| `pod install` падает | `cd mobile/ios && rm -rf Pods Podfile.lock && pod install` |
| iOS build падает на signing | Xcode → Project → Signing & Capabilities → выбрать Team, поставить Automatic |
| Backend не видит БД | `docker ps`, `docker logs autexa-pg`, ENV в `backend/.env` |
| Миграция не применилась | посмотреть в логе `npm run start:dev` — `MigrationRunner` пишет, какой файл применяет |
| Web стучится на старый API | поправить `VITE_API_URL` в `frontend/.env` и перезапустить `npm run dev` |
| Метро видит старый кэш | `cd mobile && rm -rf node_modules/.cache && npx expo start --clear` |
