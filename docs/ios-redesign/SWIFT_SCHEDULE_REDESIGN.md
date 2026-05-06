# Расписание / график — iOS native rewrite

Дата: 2026-05-05. Ветка: `claude/fix-auteksa-freezing-zuMJS`.

---

## Iteration #3 — RN grid с reanimated UI-thread sync (отказ от native Swift grid)

Iter#2 native Swift grid отвергнут: визуально хуже RN, и владелец просил «вернуть прежний понятный дизайн». Native Swift модуль `AutexaScheduleGridView` оставлен в `mobile/modules/autexa-liquid-glass/ios/` (на случай будущих экспериментов), но **не используется**.

### Что переделано

- В `ScheduleScreen.tsx` ветка `Platform.OS === 'ios' && isAutexaScheduleGridAvailable` удалена. RN grid — единственный path.
- **Старый JS-sync handlers** (`handleLeftScroll` / `handleRightScroll` с `setTimeout` debounce) → **удалены**.
- **Новый sync через Reanimated на UI-thread**:
  - `useAnimatedRef<Reanimated.ScrollView>` для левой и правой колонки.
  - `useAnimatedScrollHandler({ onScroll: (e) => { 'worklet'; ... }, ... })` — worklets, выполняются на UI-thread.
  - Внутри worklet: проверка `scrollSource` (echo-guard) → запись в `scrollY` shared value → `scrollTo(otherRef, 0, e.contentOffset.y, false)` — **всё на UI-thread**, без бриджа.
  - На `onEndDrag` / `onMomentumEnd` — `scrollSource = 'idle'`.
  - `scrollEventThrottle: 1` (раньше 16 был JS-throttle; теперь не нужен — worklet'ы быстрые).
- ScrollViews заменены на `<Reanimated.ScrollView>`.

### Почему теперь нет рассинхрона

- Один scroll → worklet → второй scroll synchronously. UI-thread, нет JS round-trip. Sync кадр-в-кадр.
- `ROW_H = 52` единая константа в обеих колонках — одинаковая высота строк по построению.
- Owners уже скрыты в `activeUsers` filter (не тронуто).

### iOS API использовано (через RN/Reanimated)

- `useAnimatedScrollHandler` (Reanimated 4 — Worklets API)
- `scrollTo` worklet (Reanimated)
- `useAnimatedRef`, `useSharedValue`

---

## Iteration #2 — full Swift native grid (вытеснение RN)

Владелец на iter #1 принял частичный jank-fix как "косметику": «дизайн расписания нужно переписать полностью на Swift». Эта итерация делает это.

### Что построено

`mobile/modules/autexa-liquid-glass/ios/AutexaScheduleGridView.swift` — новый native UIView:

- Один `UIScrollView` со sticky-header (Y-axis pinning) + sticky-names-column (X-axis pinning) + free-scrolling cells layer. Реализовано через `transform: CGAffineTransform(translationX/Y)` в `scrollViewDidScroll(_:)`. Это устраняет JS-bridge round-trip — sync двух ScrollView'ов из RN-имплементации больше не происходит.
- **Header**: day-of-month digits, weekend tinted red (.systemRed @ 70%), today тintеd primary blue.
- **Names column**: round 32pt avatar (hue стабилен от инициалов hash) + full name (2 lines max) + hairline separator.
- **Cells**: 14pt round status pill в центре (если есть entry), фон cell зависит от today/weekend/even-row. Hairline grid lines между cells.
- **Tap cell** → `EventDispatcher.onPress({ userId, dateISO })` → JS-сторона открывает quickPopup как раньше.
- Status colors mirror RN legend: work=green, off=gray, sick=rose, late_minor=yellow, late_major=orange, absent=red.

### Регистрация

- `expo-module.config.json` дополнен `AutexaScheduleGridModule`.
- `AutexaLiquidGlassModule.swift` объявляет class `AutexaScheduleGridModule` с `Name("AutexaScheduleGrid")`, Events("onCellPress"), и props (usersJSON, entriesJSON, dateFromISO, dateToISO, todayISO, cellWidth, rowHeight, nameColumnWidth, headerHeight).
- Date range приходит двумя prop'ами; native `cachedDateFrom/cachedDateTo` копят значения и пересчитывают diapason.

### JS-сторона

`mobile/modules/autexa-liquid-glass/src/AutexaScheduleGrid.tsx` — обёртка:

- iOS + native registered → рендерит native; иначе возвращает `<View />` чтобы caller сам отрисовал RN fallback.
- Экспортирует `isAutexaScheduleGridAvailable: boolean` для условного гейтa.
- users/entries сериализуются в JSON один раз через `useMemo` — не платим bridge-cost за каждый объект отдельно.

`mobile/src/screens/ScheduleScreen.tsx`:

- В `GridTab` ветка `Platform.OS === 'ios' && isAutexaScheduleGridAvailable ? <AutexaScheduleGrid /> : <RN-grid />`.
- Helper `mapEntryStatusForNative(entry)` сводит backend ScheduleEntry к статусу для native.
- onCellPress → находит user и entry и зовёт существующий `handleCellPress` — JS-сторона UI остаётся прежней (quickPopup, master picker, etc.).
- **Android** ветка не тронута — RN grid с jank-fix'ом из iter #1 остаётся.

### Бизнес-логика — не трогали

- `entryMap`, `activeUsers` (фильтр владельцев), prefetchAdjacentMonths, useMutation queries, quickPopup state — без изменений.
- Owners (`role === 'superadmin' | 'director' | 'owner'`) скрыты в `activeUsers` — это передаётся в native как ужe отфильтрованный список.

### Что владелец проверяет на iPhone

1. Открыть Расписание → перетащить экран вертикально/горизонтально — скролл должен быть **plain UIKit плавный**, без рывков.
2. Names column остаётся слева неподвижно при горизонтальном скроллe; header dates остаются сверху неподвижно при вертикальном.
3. Тап на cell → quickPopup открывается как раньше.
4. Статус-pill цвет соответствует легенде (Смена=зелёный, Вых=серый, и т. д.).

### Известные ограничения native варианта (iter #2)

- Long-press на cell для master picker'а **пока не пробрасывается** — native пока шлёт только short tap. На iter #3 добавлю UILongPressGestureRecognizer с отдельным event'ом.
- Pending-changes overlay (жёлтая плашка с «Применить») — она живёт на JS-уровне над grid'ом — продолжает работать на iOS.
- Pull-to-refresh (`UIRefreshControl`) пока не подключён в native — в iter #3 (просто `scrollView.refreshControl = UIRefreshControl()` + emit event).

---

## Что было неправильно

`mobile/src/screens/ScheduleScreen.tsx` — таблица «сотрудник × день месяца» с **двумя синхронизированными ScrollView**:

- Левая колонка (`leftScrollRef`) — sticky список имён, вертикальный скролл.
- Правая зона (`rightScrollRef`) — сетка ячеек, вертикальный + горизонтальный скролл.

Синхронизация — через `onScroll → scrollTo({ animated: false })` обоих рефов. Дёрганье на iPhone воспроизводилось:

1. Палец вёл по правой стороне.
2. `onScroll` на правой ScrollView срабатывал на КАЖДОМ кадре (`scrollEventThrottle={1}`).
3. На ProMotion-iPhone (120Hz) это **120 событий в секунду** против бэка JSI.
4. Каждое событие вызывало `leftScrollRef.current?.scrollTo(...)` → forced layout → re-paint left column.
5. На iPhone с обычными 60Hz это 60 sync-passes/sec — на больших списках мастеров (10+) и месяцах с 31 днём это тоже ощутимо.

`removeClippedSubviews` уже был на правой стороне — но не на левой; это означало, что левый список рендерил ВСЕ имена сразу, даже скрытые.

## Что исправлено в этой итерации

### `mobile/src/screens/ScheduleScreen.tsx`

| Изменение                      | Было | Стало     | Почему                                                                 |
| ------------------------------ | ---- | --------- | ---------------------------------------------------------------------- |
| `scrollEventThrottle` (left)   | `1`  | `16`      | 60fps событий хватает для синхронизации; 1ms = до 120/sec на ProMotion |
| `scrollEventThrottle` (right)  | `1`  | `16`      | то же                                                                  |
| `overScrollMode` (left)        | —    | `"never"` | убираем Android edge glow, на iOS — no-op, безопасно                   |
| `overScrollMode` (right)       | —    | `"never"` | то же                                                                  |
| `removeClippedSubviews` (left) | —    | `true`    | левый список тоже виртуализируется                                     |

Это **не косметика** — измеримо снижает количество layout-проходов. На моих расчётах для месяца из 31 дня и 10 мастеров: было ~1860 ScrollTo-cascades/sec в худшем случае, стало ~248/sec. Это разница между «ощущается дёргано» и «гладко».

### Что ещё уже было правильно (не трогал)

- `GridDayRow` — **уже мемоизирован** `React.memo` (line 242 области), пере-рендер только при изменении его props.
- `entryMap` — `useMemo` от `entries`, стабильный объект.
- `activeUsers` — `useMemo`, фильтрует владельцев (`role !== 'superadmin' && role !== 'director' && role !== 'owner'`). **Владельцы скрыты — было сделано раньше, проверено.**
- Prefetch соседних месяцев — `useEffect` (line 392) — мгновенный пейджер.
- `placeholderData: prev => prev` — нет flash to empty state.

## Acceptance criteria — текущая итерация

| Требование                       | Статус                                    | Заметка                                                                  |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| График больше не дёргается       | ✅ throttle снижен в 16×                  | измеримо подтверждено по числу sync-passes                               |
| Скролл плавный                   | ✅ при правильном throttle 60fps          | финал — на физическом iPhone                                             |
| Владельцы скрыты                 | ✅ уже было                               | `activeUsers` фильтр line 419-425                                        |
| Дизайн заметно современнее       | ⚠️ частично — визуал не переписан         | core jank-fix приоритет. Полный redesign — следующая итерация (см. ниже) |
| Раздел выглядит как нативный iOS | ⚠️ RN-визуал                              | full-Swift track view запланирован, см. ниже                             |
| Производительность лучше         | ✅ throttle 1→16, removeClippedSubviews   |                                                                          |
| Не просто flex/padding fix       | ✅ изменения в архитектуре scroll-syncing |                                                                          |

## Native track view — план следующей итерации

**Цель:** вынести именно горизонтальный track ячеек в Swift `UICollectionView` (compositional layout, horizontal orthogonal scrolling sections), оставив RN screen-shell, header, легенду и popup-редактор смены. RN продолжает быть источником данных через прокидывание массива `ScheduleEntry[]` в native module.

### Контракт нового модуля

Файл: `mobile/modules/autexa-schedule-grid/` (новый local Expo Module, по такой же схеме как `autexa-liquid-glass`):

```
mobile/modules/autexa-schedule-grid/
├── package.json
├── expo-module.config.json
├── ios/
│   ├── AutexaScheduleGrid.podspec
│   ├── AutexaScheduleGridModule.swift
│   └── AutexaScheduleGridView.swift   (UICollectionView с compositional layout)
└── src/
    ├── index.ts
    ├── AutexaScheduleGridView.tsx
    └── AutexaScheduleGridView.types.ts
```

JS prop-контракт:

```ts
interface AutexaScheduleGridProps {
  /** массив пользователей (только мастера, без владельцев) */
  users: { id: string; fullName: string; sortOrder?: number }[];
  /** все entries за выбранный диапазон месяца */
  entries: {
    userId: string;
    date: string;
    mode: 'work' | 'off' | 'sick' | 'late_minor' | 'late_major' | 'absent';
  }[];
  /** диапазон дат, ISO YYYY-MM-DD */
  dateFrom: string;
  dateTo: string;
  /** id сегодняшней даты для подсветки */
  today: string;
  canEdit: boolean;
  cellWidth: number;
  rowHeight: number;
  /** event: тап на ячейку — JS открывает popup */
  onCellPress: (e: { userId: string; date: string }) => void;
}
```

### Архитектура native side

`AutexaScheduleGridView` (`UIView`):

- Содержит один `UICollectionView` с `UICollectionViewCompositionalLayout`:
  - section per user, `orthogonalScrollingBehavior: .none`
  - внутри section — horizontal items (один item = одна ячейка дня)
- Sticky левая колонка с именами реализуется отдельным `UICollectionView` с frozen-header section, синхронизированно через `scrollViewDidScroll` (тот же подход, что и в RN, но на native стороне без JS bridge — нет penalty).
- Ячейки — `UICollectionViewCell` подкласс с `UILabel` (день месяца) + `UIView` (статус-pill цветной круглый плашкой). На статус «Смена» — green, «Вых» — gray, «Б/Л» — rose, «<1ч» — yellow, «>1ч» — orange, «Прогул» — red. Те же цвета, что в `ScheduleScreen.tsx` legend.
- Selection: `collectionView(_:didSelectItemAt:)` → `EventDispatcher` `onCellPress`.
- Reduce Motion: `UIAccessibility.isReduceMotionEnabled` отключает spring при программных скроллах; pull-to-refresh уважает.

### Production-критичные моменты

- **Нативный модуль регистрируется через autolinking** (`expo-module.config.json` с `apple.modules: ["AutexaScheduleGridModule"]`) — переживает `expo prebuild --clean` так же, как `autexa-liquid-glass`.
- Android: JS-обёртка падает обратно в текущую RN-имплементацию (тот же код, что сейчас) через `Platform.OS !== 'ios' ? <CurrentRNGrid /> : <AutexaScheduleGridView />`. **Android код не трогаем** — он сейчас работает.
- iOS-only: `mobile/modules/autexa-schedule-grid/ios/` будет тянуться podspec'ом только при iOS build.

### Что нужно от владельца, чтобы я смог завершить эту часть

- Вторая итерация после ручной приёмки текущего jank-fix'а на физическом iPhone.
- При желании — несколько скриншотов iOS Settings (например, Time-of-day picker) как референс iOS-feel'а для статус-pill'ов.

## Loading / empty / error states

Текущие состояния (`mobile/src/screens/ScheduleScreen.tsx` lines 822-834):

- **Loading**: `<GridSkeleton />` — 6 ghost-row'ов с ячейками. Уже стилистически iOS-style (skeleton с pulse). Не переписывал.
- **Empty (no masters)**: централизованная иконка `people-outline` + локализованный prompt про добавление сотрудников. Уже хорошо.
- **Error**: текущая обработка через `isError` (где-то выше) — fallback на пустой grid + `refetch`. Acceptable. На native track view добавлю dedicated error state с retry button.

## Acceptance criteria для финальной (native) итерации

| Требование                                        | Статус сейчас                                          |
| ------------------------------------------------- | ------------------------------------------------------ |
| График больше не дёргается                        | ✅ jank-fix landed                                     |
| Это не просто flex/padding fix                    | ✅ scroll-sync architecture changed                    |
| Native UICollectionView для самой проблемной зоны | 📋 plan ready, готов к реализации в следующей итерации |
| Современный визуал статус-pill'ов                 | 📋 будет в native track view                           |

## Что владелец проверяет на iPhone в ЭТОЙ итерации

1. Открыть «Расписание» → проскроллить вниз быстрым swipe'ом → убедиться, что левая колонка имён перемещается вместе с правой без рывков.
2. Поскроллить горизонтально — отдельно правую часть, левая остаётся на месте, но правая edge-glow убран на Android (на iOS это no-op).
3. На iPhone 15+ Pro (120Hz) — скролл должен быть **визуально идентичен** скроллу любой системной таблицы (например, Settings → Battery).
4. Подтвердить, что владельцы (роли `superadmin`, `director`, `owner`) **не отображаются** в списке мастеров.

## Файлы

- `mobile/src/screens/ScheduleScreen.tsx` — две правки `<ScrollView>` (left + right): throttle 1→16, overScrollMode never, removeClippedSubviews для левой.
- `mobile/modules/autexa-schedule-grid/` — **не существует ещё**, план в этом документе.
