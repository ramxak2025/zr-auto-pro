# Autexa — Security & Performance audit

Дата: 2026-05-07. Iter#9. Этот документ — точечный аудит безопасности и производительности проекта; **исправления внесены только там, где это безопасно и не выходит за пределы mobile**. Изменения backend / API / DB схемы НЕ вносятся без отдельного разрешения владельца — они задокументированы как рекомендации.

## Iter#9 — что добавилось

### Multi-tenant data isolation (mobile)

Новый раунд аудита по запросу владельца — гарантировать, что данные одного автосервиса не утекают другому через mobile-кеш.

**SEC-NEW-A (P0, исправлено):** `mobile/src/utils/persistentCache.ts` — `hydrateCache` теперь читает `AsyncStorage.getItem('token')` ПЕРВЫМ. Если токена нет (logout / fresh install / killed app mid-logout) — функция (a) НЕ загружает persisted query data в `QueryClient`, (b) **активно вычищает все ключи с префиксом `@autexa/qc/`** из AsyncStorage. Это закрывает race-condition: «User A logout прерван kill'ом процесса → User B запускает приложение → видел кеш A». Теперь невозможно даже теоретически.

**SEC-NEW-B (P0, задокументирован, требует prebuild):** `mobile/src/api/axios.ts` — JWT всё ещё в plain `AsyncStorage`. На iOS файлы AsyncStorage хранятся в незащищённом sandbox; jailbreak / резервная копия = чтение токена. Правильный фикс — `expo-secure-store` (iOS Keychain / Android Keystore). **Не внесён в этой итерации**, потому что добавление native-зависимости требует `expo prebuild --clean` + `pod install` + native rebuild, и без этих шагов running build падает на `SecureStore.getItemAsync`. Запланировано в следующую итерацию с полным native rebuild цикл.

**SEC-NEW-C (P1, документ):** Query keys в `useQuery` не содержат `tenantId` — они глобальны по entity-name (`['products', ...]`, `['clients', ...]`). Backend корректно фильтрует по `tenantID` из JWT (см. `backend/src/auth/jwt.strategy.ts:40-54`, контроллеры используют `@CurrentUser()`), поэтому через API утечь данные нельзя. Но в client-side cache два tenant'а на одном устройстве делят слоты по entity-name. Сегодня защищены через clear-on-logout + новый hydrate-gate (SEC-NEW-A). Defense-in-depth: следующая итерация — расширить `queryKey` префиксом tenantId (`['t', user.tenantId, 'products', ...]`), тогда даже без clear-on-logout кросс-tenant хит невозможен.

**SEC-NEW-D (информация, не уязвимость):** Backend audit подтверждает корректность tenant isolation на server-side: `JwtStrategy.validate()` извлекает `tenantID` из БД через userID и пишет в `JwtPayload`; контроллеры читают `tenantID` через `@CurrentUser()` декоратор, не из request params/query. Mobile НЕ может spoof'нуть tenantId через API. Backend secure.

**SEC-NEW-E (информация):** `grep -r 'console.log' mobile/src` → 0 результатов. Sensitive data в логах не утекает.

**SEC-NEW-F (информация):** `FeatureGate` обходит paywall для `superadmin` на client-side, но реальная проверка происходит на backend через `RolesGuard` + `@Roles(...)`. Подделать роль на client невозможно (роль приходит из JWT).

### Performance + UX (iter#9)

- **P11 (P0)** Product picker унифицирован к стилю warehouse: `ProductPickerModal.tsx` переписан на FlashList + warehouse-style row (photo 56×56, name 2 lines, category, sellPrice, optional cost, stock + alert + cart-qty badge), inline picker в `CheckCreateScreen.tsx` заменён на `<ProductPickerModal>` (минус ~370 строк дубликата). Cache-first через `placeholderData: prev => prev` + prefetch `['all-products-check']` в `AuthContext.prefetchAfterLogin`.
- **P12 (P0)** Журнал чеков (`ChecksScreen.tsx`) и тяжёлые списки (`Clients`, `Cars`, `Suppliers`, `Services`, `Employees`, `CashFlow`, `Salary`, `Reports`) переведены на cache-first SWR pattern: cold-start gate переключён с `isLoading` на `data === undefined`, EmptyState теперь требует `!isLoading`. Whitelist `PERSISTED_KEYS` расширен (`'checks'`, `'users-for-filter'`, `'stock-movements'`, `'supplier-deliveries'`, `'services'`, `'users-all'`, `'masters'`, `'cashflow'`, `'financial-report'`). Prefetch'и в AuthContext добавлены для `['checks', 1, '', '', '', '']`, `['users-for-filter']`, `['users-all']`, `['services', { search:'', page:1, limit:30 }]`. Никакого «flash of empty/white».
- **P13** Dashboard — добавлены три виджета для owner/director/superadmin: `TodayQuickStats` (выручка/прибыль/чеки сегодня), `LowStockWidget` (top 5 товаров с низким остатком + tap → Склад), `MissedCallsWidget` (пропущенные/не перезвонили сегодня + tap → Звонки). Все на доступных API (`checksApi.getDashboard`, `productsApi.getLowStock`, `callsApi.getCalls`). Backend не трогался. Prefetch'и + persistence whitelist обновлены (`'checks-dashboard'`, `'low-stock'`).
- **P14** Корзина склада перенесена из `MoreScreen` (раздел «Ещё») в `ProductsScreen` ops modal как 4-й пункт. `TrashScreen.tsx` принимает optional `onClose` prop, рендерится через full-screen RNModal. Доступ — за permission `warehouse_access`, как и было. Логически правильное место (склад).

## Iter#8 — что добавилось

### Performance (исправлено в iter#8)

- **P9** (P0) `mobile/src/screens/CheckCreateScreen.tsx`: на mount экрана Касса теперь префетчатся `'all-products-check'` (limit 500) и `'warehouse-categories'`. Ранее picker'у приходилось ждать первого `enabled: true` запроса. Теперь — instant cache hit при тапе ⊕.
- **P10** (P0) `mobile/src/screens/ChecksScreen.tsx`: `<LoadingSpinner />` для warehouse-docs заменён на `<ListSkeleton count={8} />`. Ноль белого пустого ожидания при первом open вкладки «Документы».

### UX (iter#8)

- **U1** TabBar возвращён к floating-island геометрии (TOP_LIFT 6 + safeBottom + BOTTOM_LIFT 8). Drop shadow убавлен (0.06/10 vs 0.12/16) — нет «тёмного кольца» вокруг острова.
- **U2** Plate region зона расширена (1.05× ГОСТ-square), `regionPadH` 13% → 16% — RUS/flag/digit имеют визуальный gap до рамки.
- **U3** Поставщики: добавлен **swipe action «Изменить»** (синий, pencil) рядом с «Удалить». Edit открывает существующую edit modal через `openEdit(item)`. Permission gate тот же.
- **U4** Склад: финансовая stats-row (себестоимость / в розн. ценах) **удалена** из header. Финансовые данные — задача Reports screen.

---

## 1. Найденные риски безопасности

### P0 — критично

| #   | Файл / зона                                                                                                           | Риск                                                                                                                                                       | Рекомендация                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| S1  | `backend/src/auth/auth.service.ts:135` — `Login FAILED: phone=${phone}` через `this.logger.warn`                      | Логирование сырых телефонов клиентов на проде. Если `pino` пишет в файл/Sentry — это **PII в логах**.                                                      | Заменить телефон на хеш / маскировать (`+7-***-***-XX99`). Не блокер — но влияет на 152-ФЗ. **Рекомендую владельцу.** |
| S2  | `backend/.env.example` присутствует и описывает `JWT_SECRET`, `S3_*`, `DEPLOY_SECRET`. Production `.env` живёт на VDS | Производственный JWT_SECRET ротируется только вручную. Утечка JWT_SECRET = форgeable token до ротации.                                                     | Регулярная ротация (квартал) + `revoked_tokens` уже есть (миграция `021`). **Рекомендую регламент владельцу.**        |
| S3  | `backend/src/main.ts` — `app.set('trust proxy', 'loopback, linklocal, uniquelocal')`                                  | OK для одного nginx-прокси на VDS, но если изменится топология (CDN перед nginx) — `request.ip` будет неверным → rate-limit обходим через X-Forwarded-For. | Проверить топологию перед сменой инфраструктуры. **Документ.**                                                        |

### P1 — важно

| #   | Файл                                                                                                         | Риск                                                                                                                       | Рекомендация                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4  | `mobile/src/api/axios.ts` — JWT хранится в `AsyncStorage` (NOT Keychain)                                     | На iOS AsyncStorage не зашифрован системно (хранится в незащищённом sandbox-файле). Jailbroken-устройство = чтение токена. | Переход на `expo-secure-store` (iOS Keychain / Android Keystore). **Безопасное точечное улучшение, рекомендую сделать в iter#8.** Не сделано в iter#7 — потребует интеграционной проверки auth flow. |
| S5  | `frontend/src/api/axios.ts` — JWT в `localStorage`                                                           | Web — тот же риск + XSS-эксфильтрация.                                                                                     | Перевести на httpOnly cookie + same-site=strict. **Backend-side изменение, требует разрешения владельца.**                                                                                           |
| S6  | `backend/src/common/guards/rate-limit.guard.ts` (login route)                                                | Rate-limit стоит, но нужно убедиться что Redis-bucket persistence не заменяется in-memory в проде                          | Проверить REDIS_URL на проде. Если in-memory — rate-limit обходим перезапуском. **Документ.**                                                                                                        |
| S7  | `backend/src/uploads/` — busboy + sharp                                                                      | Без явного MIME whitelist — пользователь может загрузить SVG с XSS-payload (если фронт когда-нибудь рендерит inline).      | Убедиться что sharp принудительно конвертирует в JPEG/PNG (и игнорит SVG). **Не проверено в этом audit'е — рекомендую владельцу.**                                                                   |
| S8  | `mobile/src/api/services.ts` — `uploadsApi.upload` отправляет `Content-Type: multipart/form-data` + raw file | OK, но проверить что backend валидирует расширение перед сохранением.                                                      | Backend audit не входит в iter#7. **Рекомендую.**                                                                                                                                                    |

### P2 — мелкие smells

| #   | Файл                                                                                                                                            | Риск                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S9  | `frontend/src/api/axios.ts` 401 handler делает `localStorage.removeItem` + redirect — в неконтролируемом таб-окне может race с другим запросом. | Уже есть `lastRedirectTime` debounce 2s. Acceptable.                                                                                                          |
| S10 | `backend/src/main.ts` — `bodyParser` лимит 50MB. CSV-импорт нужен, но 50MB DoS-вектор для злонамеренных POST.                                   | Acceptable, тк JwtAuthGuard global; неавторизованный 50MB не пройдёт.                                                                                         |
| S11 | `mobile/src/utils/persistentCache.ts` — кеш в AsyncStorage может содержать чувствительные данные клиентов / товары.                             | Не PII по умолчанию (имена, цены — internal), но всё же чувствительно. Рекомендую clear-on-logout (уже сделано через `clearPersistentCache` в AuthContext). ✓ |

---

## 2. Найденные узкие места производительности

### P0 — критично (исправлено в iter#7)

| #   | Зона                                                                                                                                               | Симптом                                                                                                            | Что сделано                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | `mobile/src/components/ProductPickerModal.tsx` — `refetchOnMount: 'always'` + `staleTime: 0` + уникальный query key `['products', 'picker', 5000]` | Каждое открытие picker'а перетягивало 500-5000 товаров с бэкенда. Slow open. Cache не разделялся с ProductsScreen. | **Iter#7 fix:** key переключён на `['all-products-check']` (тот же что AuthContext.prefetchAfterLogin), `placeholderData: prev => prev`, `staleTime: 60_000`. Открытие picker'а теперь моментально из cache. |
| P2  | `mobile/src/screens/ScheduleScreen.tsx` — JS-side scroll sync через `setTimeout` + `scrollEventThrottle: 1`                                        | На ProMotion 120Hz iPhone — 120 sync-passes/sec через JS bridge. Лаги.                                             | **Iter#3 fix (preserved):** `useAnimatedScrollHandler` + `scrollTo()` на UI-thread. ZERO JS bridge round-trips per frame.                                                                                    |
| P3  | Tab bar wrapper — `paddingBottom: safe-bottom + 10` оставлял "dead gray plane" под islanд'ом                                                       | Контент не воспринимался как edge-to-edge.                                                                         | **Iter#7 fix:** island растягивается до bottom edge экрана, glass material покрывает home-indicator zone. Иконки в top BAR_HEIGHT region.                                                                    |

### P1 — важно

| #   | Зона                                                                                                                             | Симптом                                                      | Рекомендация                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| P4  | `mobile/src/screens/ProductsScreen.tsx` использует FlashList с `getItemType`, но row component не явно `React.memo`              | Скролл может re-render'ить статичные ряды                    | Memoize row component. Не блокер, но улучшение.                                                     |
| P5  | `mobile/src/contexts/AuthContext.tsx.prefetchAfterLogin` не warm-ит `['suppliers', '']`                                          | Открытие Поставщики с холода — задержка.                     | Добавить prefetch suppliers + clients в AuthContext. **Безопасно, но требует осторожной проверки.** |
| P6  | `frontend/src/App.tsx` — все страницы lazy через `lazyWithRetry`, но первая навигация после deploy всегда загружает chunk заново | Slow first paint после deploy                                | Already addressed by `lazyWithRetry` retry/reload pattern. Acceptable.                              |
| P7  | `backend/src/checks/checks.service.ts` (предполагаемо) — `findAll` с пагинацией                                                  | Возможна проблема с неоптимальными JOIN на больших магазинах | **Backend audit не входит в iter#7.** Рекомендую EXPLAIN-анализ при росте >10K чеков.               |

### P2 — оптимизации

- `mobile/src/screens/DashboardScreen.tsx` — много useQuery вызовов (~7-8). Consider parallel `useQueries` для меньшего числа re-renders. Nice-to-have.
- `mobile/src/screens/ProductsScreen.tsx` — long-press long delay 400ms может ощущаться slow. Reasonable iOS-default. Skip.
- `mobile/App.tsx` — `cacheReady` render-blocking guard <50ms. Acceptable, see comment. Skip.

---

## 3. Что исправлено в этой итерации (iter#7)

1. **Tab bar dead-zone fix** (`mobile/src/navigation/TabBar.ios.tsx`, `useTabBarHeight.ts`): island extends to screen bottom; icons stay in top BAR_HEIGHT region; no gray plane below bar.
2. **Plate proportions** (`CheckCreateScreen.tsx makePlateBadgeStyles`): regionFont 36% → 32%, regionPadV 8.5% → 12%, regionPadH 10% → 13% — region/RUS/flag не наезжают на рамку.
3. **ProductPickerModal cache fix**: shared key `['all-products-check']`, drop `refetchOnMount: 'always'`, add `placeholderData`, `staleTime: 60s`.
4. **Edge-to-edge layout** (Dashboard, Products, More, CheckCreate, CashFlow): SafeAreaView outer wrappers заменены на plain View; status bar zone теперь часть screen bg, не отдельная плашка.
5. **ProductsScreen** мигрирован на `IosScreenHeader` (iter#7) — единый стиль с Schedule/Журнал/Поставщики.

---

## 4. Что рекомендуется сделать следующим этапом

### P0

- **S4 → expo-secure-store** для JWT. Один файл `mobile/src/api/axios.ts` + проверка login flow.
- **S1 → mask phone** в backend log. Backend-side изменение, требует разрешения.

### P1

- **S5 → httpOnly cookie** для frontend JWT. Backend + frontend coordinated change.
- **P5 → prefetch suppliers/clients** в AuthContext. Простое расширение существующего паттерна.
- Migrate detail screens to IosScreenHeader (CheckDetail, ClientDetail, EmployeeDetail, SupplierDetail).

### P2

- Memoize FlashList row components.
- EXPLAIN-аналитика на наиболее частых backend queries (checks, products).
- Sentry sampling rate review (если активен).

---

## 5. Приоритеты по типу

| Тип            | Найдено | Исправлено iter#7                    | Перенесено     |
| -------------- | ------- | ------------------------------------ | -------------- |
| Security P0    | 3       | 0 (требуют backend-side / регламент) | 3              |
| Security P1    | 5       | 0                                    | 5              |
| Security P2    | 3       | 0                                    | 0 (acceptable) |
| Performance P0 | 3       | 3                                    | 0              |
| Performance P1 | 4       | 1 (ProductPicker)                    | 3              |
| Performance P2 | 3       | 0 (nice-to-have)                     | 3              |

---

## 6. Что НЕ трогалось

Backend NestJS код не редактировался. Изменения требуют отдельного разрешения владельца. Все security-фиксы backend-side задокументированы тут как `S1`, `S2`, `S5`, `S6`, `S7`, `S8` и приоритизированы.

Нет никаких изменений в `shared/api/createServices.ts` или `shared/types/index.ts` — API-контракты неизменны.

Web frontend не редактировался. Рекомендации `S5`, `P6` направлены владельцу.
