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

## Блок 2. Backend strict типизация + DTO
**Статус:** в работе
