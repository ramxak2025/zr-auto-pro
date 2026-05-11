# Schedule — fix details

## Что было сломано (1-й проход)

Из критики ничего конкретного не сказано про расписание (фокус был на госномере, tab bar и Calls). Но на всякий случай:
- В первом проходе уже добавлены `useTabBarHeight()` для GridTab scroll containers
- `tabContent` style получил `paddingBottom: 120` (всех 4 tabs)
- RatingTab inline ScrollView тоже получил `paddingBottom: 120`

## Текущее состояние

ScheduleScreen.tsx (89K LoC) — самый большой экран в проекте. 5 табов внутри:
1. **Grid** — календарная сетка мастеров × дни
2. **Today** — статусы сотрудников на сегодня
3. **Shifts** — статистика смен по периоду
4. **Rating** — рейтинг сотрудников
5. **Settings** — настройки расписания (только для админа)

Архитектура:
- `<SafeAreaView edges={['top']}>` ← OK
- Header с back-button + LinearGradient + title ← OK
- Внутренние tabs с gradient pills для активной ← OK
- `<Reanimated.View entering={FadeIn.duration(200)}>` обёртка для каждого таба ← OK
- GridTab — два синхронизированных ScrollView (left names + right days)
- Остальные табы — ScrollView с `tabContent` style

## Что НЕ переделываем во 2-м проходе

- Архитектуру табов — riski регрессии
- GridTab синхронизированный scroll — работает
- Логику оптимистичных обновлений schedule entries
- Backend контракты (запрет)

## Что улучшено

- `paddingBottom: 120` ✅ — последняя строка grid не уходит под tabBar
- staleTime в `useQuery({ queryKey: ['schedule', ...], staleTime: 30_000 })` — поднят через глобальный default до 2 минут (см. App.tsx)
- Persistent cache работает для `['schedule', dateFrom, dateTo]` — холодный старт показывает прошлый месяц мгновенно

## Что можно сделать в будущем (отложено)

- Skeleton state для GridTab (сейчас просто `<LoadingSpinner />` на весь экран при загрузке)
- KeyboardAvoidingView в Quick Popup — сейчас не нужен (popup только с кнопками выбора, без TextInput)
- Native UICollectionView для grid — это полная переработка, отдельная фаза
- Per-month prefetch (загружать соседние месяцы в фоне)

## Acceptance

- [x] SafeAreaView корректно работает на всех табах
- [x] paddingBottom 120 для всех scroll containers
- [x] Header «Расписание» под Dynamic Island не лезет
- [ ] Native polish (TODO в будущей итерации)
