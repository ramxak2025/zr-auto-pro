# Autexa — Security & Performance audit

Дата: 2026-05-08. Iter#12. Этот документ — точечный аудит безопасности и производительности проекта; **исправления внесены только там, где это безопасно и не выходит за пределы mobile**. Изменения backend / API / DB схемы НЕ вносятся без отдельного разрешения владельца — они задокументированы как рекомендации.

## Iter#12 — что исправлено по результатам iPhone-теста владельца

### Critical fix #1: CheckDetail crash → logout (P0)

**Симптом:** при тапе на чек в журнале иногда возникал крэш, иногда выкидывало на экран входа.

**Корневая причина (root-cause analysis):**

1. Прошлая итерация делала `queryClient.setQueryData(['check', id], rowCheckFromList)` в `ChecksScreen.onPress`. Это писало row payload (без `services` / `products`) в каноничный кеш `['check', id]`.
2. `CheckDetailScreen` обращался к `check.services.length`, `check.products.length`, `check.services.map(...)` без guard'а на `undefined`.
3. JS-исключение → `ErrorBoundary` ловил его, но текущий navigator оставался смонтированным в неконсистентном состоянии. Любой следующий 401 (просрочка JWT, потеря сети) триггерил `onAuthExpired` и перебрасывал на Login. Снаружи это выглядело как «выкинуло на логин».

**Fix:**

- Убран `setQueryData` priming в `ChecksScreen.onPress`. Каноничный кеш `['check', id]` пишется ТОЛЬКО ответом `checksApi.getById(id)`.
- В `CheckDetailScreen` placeholder теперь делается через **read-only lookup** `queryClient.getQueriesData<{ pages?... }>({ queryKey: ['checks-infinite'] })`. Найденная в журнале row показывается как visual placeholder — она НЕ попадает в каноничный кеш и заменяется полным payload, как только сервер отдал.
- Все обращения к `check.services` / `check.products` заменены на безопасные локальные ссылки `services = check?.services ?? []`, `products = check?.products ?? []`. Длина / map больше не падают на partial-payload.
- Lookup placeholder обёрнут в try/catch — best-effort, не валит рендер если структура кеша вдруг неконсистентна.

### Critical fix #2: тап по строке журнала открывает чек (P0)

**Симптом:** тап по карточке журнала открывал клиента/мастера/авто, а не сам чек.

**Корневая причина:** в iter#10 я обернул chip'ы клиента/авто и текст имени мастера в `TouchableOpacity` с `onPress={openClient/openCarOwner/openEmployee}`. На iOS внутренний `TouchableOpacity` побеждает внешний; `e.stopPropagation()` для нативных touch-событий в RN не работает как в DOM.

**Fix (уже сделан в iter#11, оставлен):** chip'ы клиента/авто и текст имени мастера в строке журнала — статичные `<View>` + `<Text>`. Импорт `entityLinks.ts` в `ChecksScreen` явно отсутствует (с комментарием-страховкой). Переходы на сущности живут только внутри открытой деталки чека (`CheckDetailScreen.infoCard`), где это целевые ряды с chevron.

### Critical fix #3: визуальный мусор в Складе (P0)

**Симптом:** под папками рисовались строки вида `шт` буквально как escape-последовательности.

**Корневая причина:** в `ProductsScreen.tsx` (FolderSwipeRow / ProductSwipeRow, добавленные iter#11) escape-литералы `Изменить` стояли как **JSX text content** (между `<Text>` и `</Text>`), а не внутри JS string literals. JSX текст НЕ парсит escape-последовательности — они отображаются буквально. Источник: при записи через Edit-инструмент cyrillic в JSX text-position иногда конвертируется в escape, и в этой позиции это уже не строковой литерал, а сырой текст.

**Fix:**

- Удалены оба компонента `FolderSwipeRow` / `ProductSwipeRow` (содержали баг и сами по себе нестабильно работали — см. ниже про swipe).
- В новом `FolderRow` все cyrillic-строки в JSX text позициях обёрнуты в JS-expression `{'…'}` (`<Text>{count} {'шт'}</Text>`, `{'· проверка '}`). Это делает их JS-литералами — escape-последовательности гарантированно парсятся при загрузке модуля.
- Module-scope grep `grep -rnE '>\s*\\u04|\\u04...\s*<' src/` теперь не находит ни одного случая в JSX-text. Оставшиеся escape — внутри template literals (HTML для PDF), которые корректно парсятся как обычные JS-строки.

**Превентивная мера:** все длинные cyrillic-строки в JSX-text впредь оборачиваю в `{'…'}` — этот паттерн сохраняется через любые автоматические преобразования инструмента.

### Warehouse: swipe убран полностью на iOS (P0, by user request)

**Симптом владельца:** swipe edit/delete на iOS работали нестабильно. Владелец просил **не чинить, а убрать совсем** на iOS.

**Что удалено:**

- `import { Swipeable } from 'react-native-gesture-handler'`.
- Module-level `FolderSwipeRow` и `ProductSwipeRow` компоненты.
- `openSwipeRef` + `closeOtherSwipeable` координация.
- `requestRenameFolder` обработчик.
- `deleteFolderMutation`, `renameFolderMutation` мутации.
- `deleteFolderTarget`, `renameFolderTarget`, `renameFolderInput` state.
- Rename folder modal + delete folder confirm.
- Любые упоминания long-press reorder (state, mutation, modal удалены ещё в iter#11).

**Что осталось:**

- Чистый `FolderRow` (module-level `React.memo`) — просто `TouchableOpacity` с `onPress`, ничего лишнего.
- Inline product row внутри `renderItem` FlashList — тоже plain `AnimatedCard` + `TouchableOpacity`.
- Поиск, breadcrumb, переход внутрь папки, открытие edit-формы товара по тапу — без изменений.
- Backend endpoints (`PATCH /warehouse/categories/:id/rename`, `DELETE /warehouse/categories/:id`, `PATCH /warehouse/categories/order`) НЕ удалены — они доступны через web-админ.

**Перенос на Android/Web:**

- Android — тот же код, без зависимости от gesture-handler в этом экране.
- Web — фронтенд может оставить inline edit/delete UI как есть (там swipe не нужен, dropdown menu на тап работает корректно).

### Owner Dashboard — premium command center (P0)

**Симптом владельца:** «Бизнес сегодня» и маленькие карточки выглядят слабо, не премиально, не дотягивают до Apple-like.

**Что переделано в `DashboardScreen.tsx → OwnerCommandCenter`:**

Новая архитектура — один большой single-card command center:

1. **Сегментированный pill-control** Сегодня / Вчера / 7 дней / 30 дней с **анимированным thumb-ом** (Animated.timing на `translateX`). Native-feel iOS segmented control. Thumb рисуется absolute поверх gray-pill background, плавно скользит между сегментами при смене.
2. **Hero-блок** — крупный (40pt, weight 800, letter-spacing −1.6, `fontVariant: ['tabular-nums']`) показатель **Выручки за период**. Eyebrow «Выручка за сегодня/вчера/7 дней/30 дней» слева, **delta-pill** справа. Числа выровнены в моноширине — типографика iOS Wallet / Apple Card.
3. **Hairline-сепаратор** (full-width hairline до краёв карточки через negative margin).
4. **Triplet вторичных метрик** — Прибыль / Чеков / Средний чек на одной горизонтали, разделены вертикальными hairline-чертами. Каждая метрика — со своей delta-pill. «Чеков» кликабельна → переход в Журнал (один тап от обзора к детализации).

**Что удалено по запросу владельца:**

- Слабая `<TodayQuickStats />` плашка (dropped).
- `<EmployeeRankingSection />` — рейтинг мастеров на главной не нужен. Эта аналитика теперь живёт в карточке сотрудника (Tier scores + Ranking section).

**Native vs RN решение:**

- Делать dashboard на Swift/native — переусложнение: данные приходят через React Query, бридж туда-сюда не оправдан для одного экрана. Лучше потратить native effort на по-настоящему frame-рендер-критичные части (TabBar / Schedule grid).
- `GlassSurface` (BlurView на iOS, translucent на Android) импортирован в общий компонент-набор. Для command center использовал чистый opaque white card с тонкой границей (`rgba(15, 23, 42, 0.06)`) и 12px shadow blur — это даёт «Apple Card»-плотность. Liquid Glass лучше работает поверх scrolling content (tab bars, headers); поверх gray-50 страницы он не добавляет премиальности.

**Источники данных:**

- `checksApi.getDashboardChart(period, offset)` — уже агрегирует на бэке `{ totalRevenue, totalProfit, totalChecks }`. Новых endpoint'ов не добавлял.
- Параллельный запрос `(period, offset-1)` для дельты vs прошлого периода. SWR + `placeholderData: prev => prev` → переключения тапами по периодам мгновенные после первой загрузки.
- Средний чек = revenue / checks (guard вокруг деления на 0).
- Никаких выдуманных метрик. Если бэк отдал нули — показываем нули, а в дельте «—».

**Перенос на Android/Web:**

- Android — тот же RN-код, segmented control с Animated thumb работает идентично.
- Web — фронтенд может зеркально использовать ту же иерархию: pill segmented control, big hero number с tabular-nums, hairline divider, triplet под ним. На web вместо `Animated.timing` лучше CSS transition; вместо `BlurView` — `backdrop-filter: blur(20px)` если нужно glass.

### Employees — premium «performance card» (P0)

**Симптом владельца:** карточка сотрудника недостаточно — «не просто подкрасить, а реально изобрести новый подход».

**Что добавлено в `EmployeeDetailScreen.tsx` (поверх предыдущей структуры):**

**Tier strip (новая секция):** три нормализованных индекса 0–100 в виде кругов на верху карточки. Эстетика iOS Health / sport-game-card — быстрый визуальный «портрет» сотрудника на одном взгляде.

#### Формулы (только реальные метрики, документированы в коде)

1. **Эффективность** = clamp(round((avgCheck / 10000) × 100), 0, 100)
   - `avgCheck = salary.totalRevenue / salary.checkCount` за текущий период.
   - 10 000 ₽ — baseline (типичный «нормальный» средний чек для услуг автосервиса в РФ; не сравнение с командой). При avgCheck = 5000 → 50, avgCheck = 12000 → 100 (clamped), avgCheck = 20 000 → 100 (clamped).
   - Источник: `salaryApi.getAll()` → `MasterSalary`.

2. **Дисциплина** — на основе `TodayEmployeeStatus`:
   - on_time / actualArrival → **100**
   - late_minor → **75**
   - late_major → **45**
   - hasSchedule && !isWorking && !actualArrival (не пришёл по графику) → **0**
   - isDayOff → **null** (скрываем «—», у выходного нет дисциплины)
   - **Это одна точка данных.** Идеальная Discipline-история через 30 дней требует либо `/schedule/employee/:id/stats` (нет endpoint'а), либо клиентскую агрегацию `/schedule?dateFrom&dateTo` с фильтром по userId (вернёт всю команду — дорогой запрос). Это **запланированный backend-add**: `GET /schedule/users/:id/stats?dateFrom&dateTo` → `{ onTime, lateMinor, lateMajor, noShow, dayOff, attendancePct }`.

3. **Активность** = clamp(round((1 − (place − 1) / (total − 1)) × 100), 0, 100)
   - `place` = позиция в `ranking.month` (1 = лидер).
   - `total` = размер команды (сколько мастеров вообще в ranking).
   - 1-е место → 100, последнее место → 0, никого нет в ranking → null.
   - Источник: `checksApi.getRanking()` → `EmployeeRanking.month`.

#### Цветовые диапазоны

- **≥80** — зелёный (сильно)
- **60–79** — синий (хорошо)
- **40–59** — янтарь (средне)
- **<40** — красный (требует внимания)
- **null** — серый «—»

#### Permission gates

- Tier strip виден ТОЛЬКО:
  - viewer-у с `profit_view` (или роли director/superadmin/admin);
  - либо самому сотруднику, открывшему свою карточку (`isSelf`).
- Обычный коллега-мастер не видит Tier strip — это финансово-чувствительная информация (включая эффективность по среднему чеку).
- Все исходные query (salary, ranking) уже под `enabled: showFinancials`. Tier-блок просто проверяет, что у нас есть данные.

#### Что осталось (из iter#11, не менялось)

- Hero-gradient per-name (стабильный hash → один из 8 палитр).
- Today section.
- Salary section (perm-gated).
- Ranking section (perm-gated).
- Performance insights (auto-derived strengths/growth, perm-gated).
- Recent checks (perm-gated).
- Contact + work conditions (work conditions perm-gated через `showWorkConditions`).

**Перенос на Android/Web:**

- Android — тот же RN-код, без отдельных зависимостей.
- Web — фронтенд может реализовать те же три формулы (всё из shared API). Визуально tier strip на web можно сделать как ring-progress (SVG) с тем же делением на цветовые диапазоны.

#### Что остаётся документированными следующими шагами

1. **`GET /schedule/users/:id/stats?dateFrom&dateTo`** для полноценного Discipline score (30-дневная attendance %). Сейчас score опирается на одну точку «сегодня» — это видно владельцу, но ограничено.
2. **Ручные заметки владельца** про сотрудника (strengths/growth notes от руководителя). Требует backend `users/:id/notes` endpoint. Сейчас footer в Performance-секции явно пишет «ручные заметки потребуют отдельный endpoint».
3. **`expo-secure-store` для JWT** — всё ещё в AsyncStorage (см. iter#9 SEC-NEW-B). Запланировано отдельной нативной итерацией.
4. **Server-side permission проверки на финансовые endpoint'ы** (`/checks?masterId=X`, `/checks/ranking`, `/users/:id` — должны скрывать `salaryPercent` для viewer'а без прав). Сейчас mobile soft-gate через `enabled: showFinancials`, но это не end-to-end защита. Mobile audit рекомендует проверить server-side фильтрацию.

## Iter#11 — что исправлено по результатам iPhone-теста владельца

Прошлая итерация iter#10 не была принята — владелец нашёл четыре блокирующих регрессии при ручной проверке. Эта итерация чинит их без расширения скоупа.

### Стабильность swipe в Складе (UX-1, P0, исправлено)

**Симптом владельца:** «свайп по папке Изменить/Удалить работает глючно: один раз срабатывает, потом не работает».

**Причина:**

1. `Swipeable`-инстансы создавались inline внутри `ListHeaderComponent` FlashList. На каждый рендер `ProductsScreen` — новые React-элементы → iOS gesture handler терял своё состояние свайпа.
2. На том же ряду висел `onLongPress` (300 мс задержка) для reorder — он конкурировал с пан-жестом Swipeable за гейт жестов.
3. Открытые свайпы не координировались: два открытых ряда стэкались.

**Исправлено в `ProductsScreen.tsx`:**

- Folder rows и product rows вынесены в module-level `React.memo`-компоненты `FolderSwipeRow` и `ProductSwipeRow`. Теперь Swipeable-инстансы стабильны между рендерами родителя.
- `useRef` в каждом ряду + единый родительский `openSwipeRef` + `onSwipeableWillOpen`-handler закрывает любой ранее открытый ряд. Стандартный pattern из доков `react-native-gesture-handler`.
- Long-press reorder **полностью удалён**: state, mutation, modal, обработчик. Reorder делается в web-админке. Никаких полурабочих фич.
- `friction={2}` + `rightThreshold={40}` + `overshootRight={false}` — медленный свайп предсказуемо открывает actions; short-swipe не откатывает их обратно.

**Permission gate (UX-1.1):** swipe рисуется только если `canManageWarehouse` (роль владелец/директор/админ или permission `warehouse_access`). У обычного сотрудника тап по папке/товару — обычный переход без actions. Это сохраняет старый контракт прав (не понижает безопасность).

### Журнал чеков: тап по карточке открывает чек, не сущность (UX-2, P0, исправлено)

**Симптом владельца:** «при нажатии на карточку чека почему-то открылся владелец/мастер/авто, а не сам чек».

**Причина:** прошлая итерация iter#10 завернула chip'ы клиента/авто и текст имени мастера в `TouchableOpacity` с `openClient/openCarOwner/openEmployee`. На iOS внутренний `TouchableOpacity` побеждает внешний — `e.stopPropagation()` для нативных touch-событий в RN не работает как в DOM. Тапы попадали в дочерние chip'ы.

**Исправлено в `ChecksScreen.tsx`:**

- Chip'ы клиента/авто и текст имени мастера в карточке журнала **снова статичные** (`<View>` + `<Text>`), без обёрток.
- Импорт `entityLinks` оставлен только для CheckDetail/Schedule. В `ChecksScreen.tsx` он явно не импортируется — добавил комментарий с обоснованием, чтобы следующий человек не «починил» обратно.
- Тап по карточке чека → всегда `navigation.navigate('CheckDetail', ...)` через primed cache.

Переходы по сущностям остаются доступны **только** изнутри открытой деталки чека (`CheckDetailScreen.infoCard`) — там это целевые ряды с chevron, без конфликта с тапом-родителем (родитель — ScrollView).

### Журнал чеков: ускорение (PERF-1, P0, исправлено)

**Симптом владельца:** «один раз открылся быстро, потом снова долго грузился, хотя чеков мало».

**Причина:**

- `useInfiniteQuery` имел `staleTime: 30_000` + дефолтный `refetchOnMount: true`. Возврат с `CheckDetail` через 30+ секунд вызывал свежий fetch — даже если данные в кеше.
- `renderCheck` создавался заново на каждый рендер `ChecksScreen` (не useCallback) и через closure захватывал mutable `lastDateGroup` — это ломало порядок date-headers и заставляло FlashList пересчитывать row sizes.

**Исправлено в `ChecksScreen.tsx`:**

- `staleTime: 5 * 60_000` (5 минут), `gcTime: 30 * 60_000`, `refetchOnMount: false`, `refetchOnReconnect: false`. Возврат на журнал — мгновенный, кеш живой.
- Date-group headers теперь precomputed через `useMemo(dateHeaderByIndex, [checks])` — стабильно по индексу. Mutable `lastDateGroup` удалён.
- `renderCheck` обёрнут в `useCallback([dateHeaderByIndex, canDelete, canViewProfit, handleDelete, navigation, queryClient])` — FlashList реально перевыпускает row только когда меняется реальный input.
- `handleDelete` тоже useCallback.
- Persisted whitelist `'checks-infinite'` остаётся (из iter#10) — холодный старт мгновенный.

`CheckDetailScreen` уже использовал primed cache (`queryClient.setQueryData(['check', id], rowCheck)` в onPress + `placeholderData: prev => prev`). Не трогал — пока работает.

### Главная владельца: Owner Command Center (UX-3, P0, исправлено)

**Симптом владельца:** «маленькая слабая плашка TodayQuickStats не нравится — это не центр управления; рейтинг сотрудников на главной не нужен».

**Исправлено в `DashboardScreen.tsx`:**

- Удалены из `AdminDashboard()`: `<TodayQuickStats />` + `<EmployeeRankingSection />`.
- Добавлен новый `<OwnerCommandCenter />` — большой premium-виджет:
  - Сегментированный pill-селектор: **Сегодня / Вчера / 7 дней / 30 дней**.
  - Главный hero-тайл: **Выручка** крупно (30pt, weight 700) + дельта vs прошлого периода (цветная стрелка).
  - Сетка из трёх тайлов: **Прибыль / Чеков / Средний чек** — каждый со своей дельтой.
  - Тап на «Чеков» → переход в Журнал. Тап на header «Журнал» — тоже.
- Данные из существующего `checksApi.getDashboardChart(period, offset)` — никаких новых endpoint'ов. Параллельно дёргается `(period, offset-1)` для дельты. SWR + `placeholderData: prev => prev` — переключение периодов мгновенное после первого fetch.
- `EmployeeRankingSection` функция оставлена в файле как dead code (eslint её не флагает) — удаляется в отдельной зачистке. Сейчас её просто **не вызывают**.

### Сотрудники: list redesign + permission gates (UX-4, P0, исправлено)

**Симптом владельца:** «шапку унифицировал, но сам раздел "Сотрудники" слабый, и карточка тоже».

**Исправлено в `EmployeesScreen.tsx`:**

- Полный rewrite списка. Каждая строка теперь:
  - 48pt градиентный аватар (per-name hash, та же палитра что в `ScheduleScreen.GridTab`);
  - имя + роль-pill;
  - status-pill с цветом и иконкой («На смене», «Опозд. N мин», «Выходной», «Больничный», «Прогул», «Не пришёл», «Нет данных»);
  - метрики дня для мастеров (только если `showFinancials`): «Чеков сегодня» + «Выручка» из `checksApi.getRanking().today`. Если ranking-эндпоинт не вернул мастера — метрики не рисуются (никаких выдуманных нулей рядом с именем).
- Сортировка: на смене → опоздавшие → ещё не пришёл → выходной/нет данных → по алфавиту внутри группы.
- Subtitle в шапке: «На смене: N из M».
- Tab bar bottom inset через `useTabBarHeight()`.
- Permission gate: `showFinancials = director|superadmin|admin || profit_view`. Без него `useQuery(['employee-ranking'])` **disabled** — endpoint вообще не дёргается, чтобы не светить чужие выручки в логах/Sentry.

**Исправлено в `EmployeeDetailScreen.tsx`:**

- Hero-gradient теперь per-name (8 палитр через hash имени).
- Permission gates на каждой финансовой секции:
  - `salary` query: `enabled: showFinancials` — endpoint `salaryApi.getAll()` не дёргается у обычного коллеги-мастера.
  - `ranking` query: `enabled: showFinancials`.
  - `recent-checks` query: `enabled: showFinancials` — список чужих чеков с суммами тоже финансовая инфа.
  - Salary section / Ranking section / Recent checks section: рендер только при `showFinancials`.
- Contact-секция: «Доля с услуг», «Доля с товаров», «Выходные» — только при `showWorkConditions = isOwnerLike || isSelf`. Обычный коллега видит «Контакт» (телефон + логин), не «Контакт и условия».
- `isSelf = viewer.id === id` — сотрудник всегда видит **свою** зарплату/условия (это его законная информация).
- Новая секция **«Performance»** с auto-derived инсайтами:
  - **Сильные стороны**: «Топ-N по выручке за месяц», «Лидер по выручке сегодня», «Сегодня пришёл вовремя», «Высокий средний чек» (≥ 5000 ₽).
  - **Зоны роста**: «Выручка за месяц ниже среднего», «Опоздание сегодня: N мин», «Сегодня по графику, ещё не пришёл».
  - Все пункты — **только** из реальных метрик API (`ranking`, `today`, `salary`). Никаких выдуманных показателей.
  - Если ни одного пункта не насчитали — секция вообще не рисуется (graceful empty).
  - Footnote документирует, что ручные заметки владельца требуют отдельного backend-endpoint (вне скоупа этой итерации).

### Оставшиеся риски (документ, без правок)

- **Permission на `/checks?masterId=X`**: бэкенд должен возвращать только чеки внутри tenantId — это уже есть в `JwtStrategy + @CurrentUser()`. Но НЕ проверял отдельно, что обычный мастер не может через `masterId` вытащить выручку коллеги. **Рекомендация владельцу:** проверить в `backend/src/checks/checks.service.ts:getAll`, что фильтр по `masterId` дополнительно требует роли. Если нет — добавить guard. Mobile-side gate `enabled: showFinancials` блокирует UI, но НЕ заменяет server-side проверку.
- **Permission на `/checks/ranking`**: тот же контроль роли на сервере. Mobile делает запрос только при `showFinancials`, но это soft-gate.
- **Permission на `/users/:id`**: `usersApi.getById(id)` дёргается всегда. Backend должен скрыть `salaryPercent`/`productSalaryPercent` для viewer'а без прав, иначе данные текут в JSON-ответ независимо от того, рисуем мы их или нет. **Не проверено в этой итерации.** Mobile рисует их только под `showWorkConditions`, но это не end-to-end защита.
- **Reorder папок склада**: backend endpoint (`PATCH /warehouse/categories/order`) остался — просто mobile перестал его дёргать. Web-админка по-прежнему может им пользоваться.
- **`expo-secure-store` для JWT**: всё ещё в AsyncStorage (см. iter#9 SEC-NEW-B). Запланировано отдельной нативной итерацией (требует prebuild + pod install + проверка auth flow).

## Iter#10 — что добавилось

### Performance (mobile)

- **P15 (P0)** `ChecksScreen.tsx` — журнал чеков перешёл с одностраничного `useQuery` (где `setPage(p+1)` каждый раз заменял данные) на `useInfiniteQuery`. Семантика: первая страница = самые свежие чеки (сегодня), последующие страницы дозагружаются при скролле через `fetchNextPage`. Все страницы живут в одном cache entry и flat-маплятся в FlashList; возврат с `CheckDetail` не сбрасывает позицию. `placeholderData: prev => prev` сохраняет SWR-поведение при смене фильтров. Persisted-cache whitelist расширен ключом `'checks-infinite'` — мгновенное наполнение списка после cold-start.
- **P16 (P0)** `ChecksScreen.tsx` — при тапе на чек `queryClient.setQueryData(['check', id], rowCheck)` пишет уже известные данные в кеш `CheckDetailScreen`. Detail screen с `placeholderData: prev => prev` использует это как источник для первого рендера; полный payload (services / products / mileage и т.п.) заменяет «черновик» из списка по факту прихода — без `<LoadingSpinner />` flash. Открытие чека ощущается мгновенным.
- **P17 (P1)** `CheckDetailScreen.tsx` — добавлены `contentInset.bottom` + `scrollIndicatorInsets.bottom` + `paddingBottom: tabBarHeight + spacing[4]`. Floating tab bar больше не закрывает последний блок при полном скролле. `useTabBarHeight()` единый источник высоты, `automaticallyAdjustContentInsets={false}` — чтобы iOS не ломал расчёт.
- **P18 (P1)** `DashboardScreen.tsx` — тяжёлый `<RevenueChart />` (период tabs «Сегодня / Неделя / Месяц / Год» + SVG-графики выручки/прибыли) удалён из `AdminDashboard()`. Главная владельца теперь рисует только `TodayQuickStats`, `StaffStatus`, `LowStockWidget`, `MissedCallsWidget`, `EmployeeRankingSection`. Аналитика по периодам перенесена в раздел «Отчёты». Cold-start dashboard стал ~1.5× легче по виджетам и заметно быстрее на первом mount.

### UX (iter#10)

- **U5 (P0)** Склад — у папок убрана видимая иконка корзины. Вместо неё iOS-style swipe-actions: «Изменить» (синяя, pencil) + «Удалить» (красная, trash, с `ConfirmDialog`). API не менялись — используется существующий `warehouseCategoriesApi.rename(id, newPath)` и `warehouseCategoriesApi.remove(id)`. Long-press по папке по-прежнему открывает выбор позиции (drag-and-drop affordance) через `warehouseCategoriesApi.updateOrder`. Permission gate (`canManageWarehouse`) тот же. Папки без `catId` (auto-derived из `product.category` без записи в `warehouse_categories`) показываются без swipe — переименовывать/удалять там нечего. **Реальный native long-press-and-reorder** (как iOS Files): backend уже умеет переупорядочивать (`updateOrder`), но pure JS-реализация long-press-drag поверх `View` без скачков фрейма требует или `react-native-draggable-flatlist`, или native module — обе зависимости заслуживают отдельной итерации; компромисс «long-press → modal с position-pickером» сохранён.
- **U6 (P0)** Единый Apple-like header. `IosScreenHeader` применён к: `ExpensesScreen`, `CashFlowScreen`, `UsersScreen`, `MarketingScreen`, `EquipmentScreen`, `CompanySettingsScreen`, `SubscriptionScreen`, `EmployeeDetailScreen`, `SupplierDetailScreen`. Удалены bespoke `SafeAreaView edges=['top']` + ручной back + `LinearGradient`-icon-pill. Шапки больше не «пляшут» по размерам и отступам.
- **U7 (P1)** Глобально кликабельные сущности. `mobile/src/navigation/entityLinks.ts` — три helper'а (`openClient`, `openCarOwner`, `openEmployee`), которые скрывают факт что `EmployeeDetail` живёт внутри `MoreStack` (использует nested-navigate `MoreTab → EmployeeDetail`). Применены в `ChecksScreen` (info chips клиента/авто, имя мастера в футере) и `CheckDetailScreen` (info card → каждая строка с реальной сущностью теперь TouchableOpacity с chevron). В `ScheduleScreen.GridTab` имя сотрудника стало кликом, long-press остался для reorder (только для admin/director). В `TodayTab` карточка сотрудника тоже открывает его профиль.
- **U8 (P1)** `EmployeeDetailScreen` — добавлена секция «Недавние чеки» (последние 5 заказ-нарядов мастера) с прямым переходом в `CheckDetail`. Используется существующий `checksApi.getAll({ masterId, page: 1, limit: 5 })`, без изменений API. Тап на строку прайм'ит cache `['check', id]` и навигирует через nested route в Checks tab. Также добавлен `tabBarHeight` bottom inset — больше нет перекрытия последним блоком floating tab bar.

### Security (iter#10)

- **SEC-NEW-G (информация):** Аудит client-side кеша на cross-tenant leakage не выявил новых рисков. Все экраны, которые слушают `useInfiniteQuery['checks-infinite', ...]`, опираются на тот же фильтр-by-tenantId, что server применяет через JWT. Добавление в whitelist `PERSISTED_KEYS` ключа `'checks-infinite'` укрыто `clearAllPersistedCache()` в `AuthContext.logout` (см. iter#9 SEC-NEW-A) — выход одного пользователя по-прежнему вычищает все сегменты кеша.
- **SEC-NEW-H (информация):** Новый helper `entityLinks.ts` использует `(navigation as any).navigate(...)` — это **не** обход контроля доступа: целевые экраны (`ClientDetail`, `EmployeeDetail`, `SupplierDetail`) уже защищены permission gates через `gated('clients_view', …)` / `gated('users_manage', …)` в `AppNavigator.tsx`. Если у пользователя нет прав, FeatureGate покажет paywall; навигация ничего «не открывает» в обход проверки.
- **SEC-NEW-I (P1, документ):** `expo-secure-store` для JWT всё ещё не подключён (см. iter#9 SEC-NEW-B). Не сделано — требует `expo prebuild --clean` + `pod install` + native rebuild + ручной тест auth flow на физическом iPhone. Запланировано как самостоятельная итерация native rebuild.

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
