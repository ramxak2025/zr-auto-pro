# Autexa — Платформа управления автосервисом

SaaS CRM для автосервисов: заказ-наряды, склад, зарплата, маркетинг, расписание.

## Стек

| Компонент | Технология |
|-----------|-----------|
| Backend | NestJS 10 + PostgreSQL 16 |
| Frontend (PWA) | React 18 + Vite + Tailwind CSS |
| Mobile | React Native (Expo SDK 54) |
| Shared | TypeScript types + API client |
| Deploy | Docker Compose (nginx + backend + postgres) |

## Быстрый старт (локальная разработка)

```bash
# 1. Клонировать
git clone git@github.com:ramxak2025/zr-auto-pro.git
cd zr-auto-pro

# 2. Копировать .env
cp .env.example .env
# Заполнить DB_PASSWORD, JWT_SECRET (минимум)

# 3. Установить зависимости
npm run install:all

# 4. Запустить PostgreSQL (через Docker)
docker compose up postgres -d

# 5. Запустить backend (применит миграции автоматически)
npm run backend:dev

# 6. Запустить frontend
npm run frontend:dev

# 7. Открыть http://localhost:5173
```

## Мобильное приложение

```bash
cd mobile
npx expo start
# Сканировать QR-код в Expo Go или запустить на эмуляторе
```

Сборка APK:
```bash
eas build --profile preview --platform android
```

## Структура проекта

```
├── backend/          NestJS API + миграции
│   ├── src/          24 модуля (auth, checks, clients, products, ...)
│   └── migrations/   20 SQL-миграций (идемпотентные)
├── frontend/         React PWA
│   ├── src/pages/    31 страница (lazy-loaded)
│   └── public/       SW, manifest, иконки
├── mobile/           Expo/React Native
│   └── src/screens/  25 экранов
├── shared/           Общие типы + API-клиент
│   ├── types/        40+ TypeScript интерфейсов
│   ├── api/          23 API-модуля (factory pattern)
│   └── utils/        Форматирование, attendance
├── webhook/          Auto-deploy на push
└── docker-compose.yml
```

## Деплой на VDS

```bash
cd /opt/zr-auto-pro
git pull origin <branch>
docker compose up -d --build
```

Подробнее: см. `DEPLOYMENT.md` (в разработке).

## Переменные окружения

См. `.env.example` — документирован каждый параметр.

## Лицензия

Proprietary. All rights reserved.
