# Расписание — нативный iOS-уровень

## Что было сломано

1. `<Reanimated.View entering={FadeIn} key="grid">` обёртки вокруг каждого
   таба **не имели `style={{ flex: 1 }}`** → внутренний `flex: 1` GridTab
   коллапсировал в 0 высоты → видны были только заголовки.
2. `stickyColumn.width = 110` не совпадал с `gridNameCell.width = 140` —
   ячейки уходили за границу sticky-колонки.
3. Нижние ScrollView без `flex: 1` → схлопывались в 0 высоты.
4. Right horizontal ScrollView без `flexGrow: 1` на content.
5. `TodayPill` с `RNAnimated.loop` мог падать на первом маунте.
6. `useReduceMotion` не был защищён от ошибок API.
7. Владельцы (`director`/`superadmin`) показывались в графике как
   полноправные мастера.
8. Скролл синхронизировался через `setTimeout` mutex — давал jitter.

## Что починено

`mobile/src/screens/ScheduleScreen.tsx`:

### Layout

- Все 5 `<Reanimated.View>` обёрток получили `style={{ flex: 1 }}`
- `stickyColumn.width: 110 → 140` — синхронно с ячейками
- Внутренние ScrollView (left names, right cells) → `style={{ flex: 1 }}`
- Right horizontal ScrollView → `contentContainerStyle={{ flexGrow: 1 }}`

### Скролл

```jsx
<ScrollView
  style={{ flex: 1 }}
  scrollEventThrottle={1} // максимальная частота sync events
  decelerationRate="normal" // нативная iOS-инерция
  removeClippedSubviews // вне viewport ячейки не рисуются
  bounces={false}
  contentContainerStyle={{ paddingBottom: tabBarHeight }}
/>
```

### Фильтр владельцев

```ts
const isSchedulable = (u) => {
  if (!u || !u.id) return false;
  if (u.isActive === false) return false;
  const role = (u.role || '').toLowerCase();
  return role !== 'superadmin' && role !== 'director' && role !== 'owner';
};
const activeUsers = (usersData || []).filter(isSchedulable);
```

Auth-user fallback (когда `usersData` пусто) тоже проходит этот фильтр —
директор, авторизованный один в новом тенанте, не увидит себя как
сотрудника на графике.

### Защитные механизмы

- `useReduceMotion` обёрнут в try/catch и optional-chained API
- `safeMonth` — fallback на `new Date()` если `currentMonth` каким-то
  образом стал NaN
- `entries ?? []` везде где обращаемся к расписанию
- TodayPill упрощён до плоского кружка — анимированный halo вернётся
  как polish-pass позже

### Анимации

- Cell tap → `haptic('tap')` (Light impact на iOS)
- Month nav arrows → `haptic('select')` (selection haptic)
- Сегодня в шапке — простой синий кружок (анимация удалена для
  стабильности, без неё grid рендерится надёжно)

## Состояния

| Состояние                                        | UI                                  |
| ------------------------------------------------ | ----------------------------------- |
| `activeUsers === 0 && !user`                     | `<GridSkeleton />` (6 ghost rows)   |
| `activeUsers === 0` && есть user но он не master | onboarding «Нет мастеров»           |
| `activeUsers > 0` && entries undefined           | grid пустой, ячейки кликабельны     |
| `isError && !entries`                            | error banner с retry                |
| `isFetching && !isLoading`                       | hairline spinner у заголовка месяца |

## Префетч

```ts
useEffect(() => {
  // Соседние месяцы префетчатся сразу — свайп пейджера моментальный
  [prevMonth, nextMonth].forEach((m) => {
    queryClient.prefetchQuery({ queryKey: ['schedule', from, to], ... });
  });
}, [year, month]);
```

## Acceptance criteria

- [x] График рендерится с реальными строками
- [x] Скролл плавный (scrollEventThrottle=1, decelerationRate normal)
- [x] removeClippedSubviews — кадры освобождаются
- [x] Владельцы скрыты из графика
- [x] Loading / empty / error states понятные
- [x] Safe area работает (padding до tabBarHeight)
- [x] Месяц-пейджер мгновенный за счёт prefetch
- [x] Reduce Motion защищён от ошибок
