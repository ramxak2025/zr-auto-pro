# Implementation Plan

## Порядок реализации

### Шаг 1 — Утилиты (чистый код, нет UI рисков)
1. `mobile/src/utils/plateMask.ts` — добавить `normalizePlateForSearch`, `normalizeForeignPlate`
2. `mobile/src/utils/persistentCache.ts` — НОВ: hydrateCache + attachPersistence
3. `mobile/src/utils/__tests__/plateMask.test.ts` — расширить тесты

### Шаг 2 — Hooks
4. `mobile/src/hooks/useTabBarHeight.ts` — НОВ

### Шаг 3 — Компоненты
5. `mobile/src/components/PlateModeSwitcher.tsx` — НОВ (segmented control)
6. `mobile/src/components/RussianPlateInput.tsx` — расширить props (`mode`, `onModeChange`, `showSwitcher`)

### Шаг 4 — Глобальные обёртки
7. `mobile/App.tsx` — hydrate cache, attach persistence, поднять staleTime/gcTime
8. `mobile/src/contexts/AuthContext.tsx` — prefetch после login

### Шаг 5 — Tab Bar
9. `mobile/src/navigation/TabBar.ios.tsx` — premium Liquid Glass редизайн

### Шаг 6 — Главные экраны
10. `mobile/src/screens/ProductsScreen.tsx` — фикс ложного «0 товаров» в header, paddingBottom
11. `mobile/src/screens/CheckCreateScreen.tsx` — интеграция PlateModeSwitcher + normalizePlateForSearch + paddingBottom для tab bar
12. `mobile/src/screens/ScheduleScreen.tsx` — paddingBottom + KeyboardAvoidingView в popup
13. `mobile/src/screens/ChecksScreen.tsx` — paddingBottom + (опционально) FlashList
14. `mobile/src/screens/DashboardScreen.tsx` — paddingBottom для scroll
15. `mobile/src/screens/MoreScreen.tsx` — paddingBottom

### Шаг 7 — Финальные проверки
16. `npx tsc --noEmit`
17. `npx eslint "src/**/*.{ts,tsx}" --max-warnings=10000`
18. Тесты `npx jest` (если настроены)

### Шаг 8 — Документация
19. `docs/ios-redesign/HOW_TO_RUN_FOR_OWNER.md` — инструкция для владельца
20. `docs/ios-redesign/FINAL_REPORT.md` — итоговый отчёт
21. `docs/ios-redesign/TEST_PLAN.md` — план тестирования
22. `docs/ios-redesign/ASSUMPTIONS.md` — принятые допущения

### Шаг 9 — Commit + push
23. `git add -A && git commit -m "feat(ios): full iOS redesign + plate fix + persistent cache"`
24. `git push -u origin claude/fix-auteksa-freezing-zuMJS`

## Критерии готовности

- [ ] TypeScript: без ошибок
- [ ] ESLint: < 50 новых warnings (старые игнорируем — `--max-warnings=10000`)
- [ ] Все 8 документов созданы и заполнены
- [ ] Ничего не сломано в Android-only коде (TabBar.android.tsx не тронут)
- [ ] Backend контракты не изменены
- [ ] Коммит с понятным сообщением

## Архитектурные выборы

1. **Persistent cache через AsyncStorage напрямую** — не через `@tanstack/query-async-storage-persister`. Причина: меньше зависимостей, проще debug, контроль над тем что персистится.

2. **Plate mode — controlled state в родителе** — не внутренний state в `RussianPlateInput`. Причина: родитель должен знать режим чтобы правильно нормализовать перед поиском.

3. **TabBar premium редизайн — backwards-compatible** — `TabBar.android.tsx` не трогаем вообще. `TabBarShared.ts` — без изменений в API.

4. **useTabBarHeight() — iOS-only логика** — на Android возвращает 0 (Android tabBar — solid surface, контент уже не плавает).

5. **Skeleton states вместо empty states при `data === undefined`** — пользователь не должен видеть `0 товаров` пока идёт загрузка.

## Откладываем (не в этой итерации)

- Dark mode
- Полная переработка Schedule UI
- Offline-first (только кеш-первый)
- Push-уведомления
- iPad layout
- Widgets

## Риски

1. **GridTab Schedule scroll sync** — если изменим decelerationRate, может рассинхрониться. Тестируем на iPhone 17 Pro.
2. **AsyncStorage capacity** — на Android до 6MB, на iOS до 64MB. Кеш warehouse при 1000 товаров = ~150KB. Норма.
3. **Hydration race** — если query успеет смонтироваться до hydration, она запросит сетевые данные. Решение: `useEffect` в App.tsx делает hydration **синхронно перед первым рендером** через флаг `cacheReady`.
