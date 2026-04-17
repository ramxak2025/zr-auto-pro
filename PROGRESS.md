# PROGRESS.md — refactor/full-audit-2026

Прогресс-файл автономной ночной работы. Обновляется после каждого блока.

---

## Блок 1. Тулчейн + CI ✅
**Статус:** завершён
**Коммитов:** 6
**Файлов затронуто:** ~25 (конфиги + package.json/lock)

### Что сделано
1. **Prettier** — `.prettierrc.json` + `.editorconfig` в корне. Единый стиль форматирования.
2. **ESLint backend** — `@typescript-eslint/recommended` + prettier. Baseline: 0 errors, 667 warnings.
3. **ESLint frontend** — + `react-hooks`, `jsx-a11y`. Baseline: 0 errors, 1799 warnings.
4. **ESLint mobile** — + `react-native/all`. Baseline: 0 errors, 2201 warnings.
5. **Husky + lint-staged** — pre-commit hook: prettier + eslint --fix на staged файлах.
6. **GitHub Actions CI** — 3 parallel jobs: backend (typecheck+lint+build), frontend (typecheck+lint+build), mobile (typecheck+lint).

### Решения, принятые самостоятельно
- **ESLint 8** вместо 9 — более зрелый, совместим со всеми плагинами (react-hooks, jsx-a11y, react-native).
- **`no-explicit-any` = warn** на всех проектах — если бы error, CI сразу бы упал на 400+ местах. Тайтнится в блоках 2/6/8.
- **`no-useless-escape` = warn** — в backend 33 эскейпа в regex character classes, безопасные, чинить потом.

### Баги, которые нашёл и починил
- **UsersScreen.tsx**: `useMemo(filteredProducts)` вызывался ПОСЛЕ двух early return (`if (!hasPermission)` и `if (isLoading)`). Это нарушение rules-of-hooks — при изменении permission/loading React мог переупорядочить хуки и сломать рендер. Перенёс useMemo перед все early returns.

### Что не делали (по плану)
- Не устраняли `any` (Block 2, 6, 8)
- Не запускали prettier --write на весь codebase (сделаем отдельным style-коммитом если надо)
- Не трогали Dockerfile/nginx/docker-compose
- Не переписывали runtime-код (кроме hook-fix)

---

## Блок 2. Backend strict типизация + DTO ⚠️ частично
**Статус:** основная часть завершена, DTO creation отложена
**Коммитов:** 1

### Что сделано
1. **`strict: true`** в tsconfig — включены noImplicitAny, strictPropertyInitialization, strictFunctionTypes, useUnknownInCatchVariables
2. **@types/pg** — устранено 24 TS7016 ошибки (implicit any on pg module import)
3. **6 DTO файлов** — добавлены definite assignment assertions (!) на 14 свойств
4. **checks.service.ts** — 2 параметра типизированы как Record<string, unknown>
5. **Результат**: 0 TypeScript errors в strict mode, build проходит

### Что осталось (отложено по правилу 4-часового таймбокса)
- 32 контроллерных endpoint'а всё ещё используют `@Body() dto: any` — нужны DTO-классы с class-validator. Это 15-20 новых файлов, ~3 часа чистой работы. Документировано, вернёмся при следующей итерации.

---

## Блок 4. Security headers + Helmet + CSP
**Статус:** в работе
