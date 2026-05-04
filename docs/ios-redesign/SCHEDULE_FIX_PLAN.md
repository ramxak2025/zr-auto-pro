# Расписание — план фиксов на iOS

## Где живёт

`mobile/src/screens/ScheduleScreen.tsx` — 2900+ строк, 5 табов: `grid`, `today`, `shifts`, `rating`, `settings`.

Используемые API:
- `scheduleApi.getAll({ dateFrom, dateTo })` — записи смен
- `usersApi.getAll()` — мастера
- `usersApi.updateOrder(orderedIds)` — порядок мастеров

## Что сломано/неудобно на iOS

### 1. SafeAreaView — есть, но низа нет
- `<SafeAreaView edges={['top']}>` ✅ корректно для верха
- Низ не учитывается → последняя строка grid и tab content уходит под floating tabBar
- **Фикс:** все `<ScrollView>` внутри табов получают `contentContainerStyle.paddingBottom = useTabBarHeight() + 16`

### 2. GridTab — горизонтальный скролл и sticky column
- Левая колонка (имена мастеров) не скроллится горизонтально, а только вертикально
- Правая часть (дни) скроллится в обе стороны
- На iOS реализован через два синхронизированных ScrollView с `useRef`
- **Проблема:** при rapid scroll иногда левый и правый рассинхрон
- **Фикс:** добавить `bounces={false}` на iOS scrollViews + `decelerationRate="fast"`

### 3. Вертикальный scroll в GridTab
- `<ScrollView>` обёрнут вокруг `entries.map(...)` с фиксированной высотой row
- На iPhone 17 Pro (Dynamic Island) — некорректный отступ снизу
- **Фикс:** `paddingBottom` равный `useTabBarHeight() + safe`

### 4. Вкладки расписания (внутренние)
- Tab bar с 4-5 кнопками, активная — gradient pill
- Текст уменьшается через `adjustsFontSizeToFit` — на узких экранах (iPhone SE) может стать нечитаемым
- **Фикс:** на узких экранах ограничить количество видимых табов или использовать horizontal scroll

### 5. Кварталы / месяцы переключение
- `currentMonth` state, кнопки `<` / `>` для смены месяца
- На iOS swipe-back gesture может срабатывать вместо смены месяца
- **Фикс:** убедиться что `gestureEnabled` правильно настроен в Stack screenOptions для родительского экрана (для Schedule it's в MoreStack — ок)

### 6. Модал Quick Popup
- Открывается при тапе на ячейку дня
- Использует `<Modal>` обёртку
- На iOS keyboard avoiding не работает — комментарий перекрывается клавиатурой
- **Фикс:** `<KeyboardAvoidingView behavior="padding">` внутри модала

### 7. Реordering мастеров
- `usersApi.updateOrder` — оптимистичный update в onMutate
- Кнопки ↑↓ — мелкие, легко ошибиться
- **Фикс:** увеличить hitSlop, добавить хаптику

### 8. Empty state
- Когда `entries === []` (новый месяц) — показывается серый текст «Нет записей»
- **Фикс:** добавить EmptyState компонент с иконкой и подсказкой

### 9. Loading state
- При `isLoading` — `<LoadingSpinner />` на весь экран
- **Фикс:** skeleton для grid (несколько строк ghost-cells)

### 10. Performance
- `entryMap` пересчитывается на каждом изменении `pendingChanges` (норма)
- `userStats` пересчитывается на каждом изменении entryMap
- Уже есть `memo(GridDayRow)` ✅
- staleTime 30s — поднять до 2 минут

## Минимальный план в этой итерации

Из-за объёма (89K LoC в одном файле) делаем осторожно — только iOS-критичные правки:

1. **paddingBottom для всех ScrollView в табах** — добавить `useTabBarHeight()` и применить
2. **KeyboardAvoidingView в Quick Popup модале** — обернуть содержимое
3. **bounces={false} + decelerationRate="fast"** — на синхронизированных GridTab scrolls
4. **staleTime 2 minutes** — для schedule + users

Не трогаем:
- Архитектуру табов (риск регрессии)
- Логику оптимистичных обновлений (работает)
- Backend контракты

## Тестовые сценарии

После фикса проверить:
- [ ] Открытие расписания — нет «прыжка» контента
- [ ] Скролл вниз grid до последней строки — последняя строка полностью видна над tabBar
- [ ] Тап на ячейку дня — popup открывается, поле комментария не перекрывается клавиатурой
- [ ] Смена месяца ← → — без задержки и без визуальных артефактов
- [ ] Empty month (например, 2030 год) — нормальное empty state, не пустой экран
- [ ] iPhone SE (узкий) — все табы видны, текст не обрезан
