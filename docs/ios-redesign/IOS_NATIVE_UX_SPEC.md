# Autexa iOS — Native UX Specification

Целевая аудитория: владельцы автосервисов в РФ. Большинство устройств — iPhone 12+ с iOS 17+ (Dynamic Island, gesture nav, light/dark mode).

## 1. Safe Area

Все экраны используют `<SafeAreaView edges={['top']} />` из `react-native-safe-area-context`.

Нижний край НЕ оборачиваем в SafeAreaView — там работает floating Tab Bar, который сам учитывает `insets.bottom` через `useSafeAreaInsets()`.

Контент-контейнеры списков и скроллов ВЕЗДЕ должны иметь `paddingBottom` ≥ `useTabBarHeight()` (новый hook), чтобы последний элемент не уходил под таб-бар.

`useTabBarHeight()` возвращает: `60 (BAR_HEIGHT) + 8 (wrapper paddingTop) + max(insets.bottom, 12) + 8 (extra)` ≈ 88–96 pt.

## 2. Поддержка iPhone

| Устройство | Notch | Safe top | Safe bottom |
|------------|-------|----------|-------------|
| iPhone 8 / SE2 | нет | 20 | 0 |
| iPhone X – 13 | notch | 47 | 34 |
| iPhone 14+ Pro / 17 Pro | Dynamic Island | 59 | 34 |

`SafeAreaView edges={['top']}` обрабатывает все три. Никаких хардкоднутых `paddingTop: 44` быть не должно.

## 3. Liquid Glass Tab Bar (iOS 26-inspired)

Реализация — в `TabBar.ios.tsx`, на основе `expo-blur` `BlurView`.

**Стиль:**
- Floating pill, `marginHorizontal: 14`, `borderRadius: 30`
- Высота: 60pt + bottom inset
- Background: BlurView `intensity={100}` `tint="systemUltraThinMaterialLight"` (на iOS 17+ это даёт эффект Liquid Glass)
- Тонкий белый rim сверху (1px) — имитация бликов
- Внутреннее свечение: `inset shadow` через дополнительный View с `borderColor: rgba(255,255,255,0.4)`
- Внешняя тень: `shadowColor: primary[700]`, `shadowOpacity: 0.18`, `shadowRadius: 24`, `shadowOffset: {0, 8}`
- Под центральной кнопкой Кассы — мягкий glow (radial)

**Иконки:**
- 24pt SF-style (Ionicons backup) — `home`, `warehouse`, `journal`, `menu`
- На active: tint `primary[600]`, scale 1.08 (spring), label fontWeight 600
- На inactive: tint `gray[500]`, scale 1.0, label fontWeight 500

**KassaButton:**
- 62pt круг, gradient primary[400→600→800]
- Liquid blobs (3 разноскоростных rotate-loops) — уже реализованы, оставляем
- `marginTop: -28` относительно бара — кнопка «выпрыгивает» вверх как FAB
- Внутри — `Ionicons receipt-outline 26pt white`

**Тач-таргеты:**
- Минимум 44×44 pt (Apple HIG)
- Хаптика на тап: `select` для обычных табов, `impact` для Кассы

## 4. Заголовки экранов

Стандарт:
- Высота 56pt
- Левая кнопка (back / menu) — 40pt circle, primary[50] background, primary[600] icon
- Центр: title 18-20pt fontWeight 700, color gray[900]
- Правая зона: 40pt placeholder для симметрии или action button

Вертикальная логика:
- В табах (Dashboard, Products, Checks, More) — без back-кнопки, только title слева
- В Stack-screens (CheckDetail, ClientDetail, …) — back-кнопка + title по центру

## 5. Карточки

Радиус: `borderRadius.xl` (12) для обычных, `borderRadius['2xl']` (16) для премиальных.

Тень iOS:
```ts
{
  shadowColor: '#000',
  shadowOpacity: 0.05,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 }
}
```

Бордер: `1px solid gray[100]` для лёгкого outline.

## 6. Типографика

iOS-style стек (через `platform/Typography`):
- Title 24pt 700
- Subtitle 18pt 600
- Body 15pt 400 (system)
- Caption 12pt 500
- Tabular-nums для денег

Базовый цвет text: `gray[900]`, secondary: `gray[500]`, disabled: `gray[400]`.

`letterSpacing: -0.3` для крупных заголовков (iOS-стиль San Francisco).

## 7. Состояния

### Loading
- Skeleton (`<ListSkeleton count={n} />`) — для списков
- Никогда не показывать `count: 0` если `data === undefined`
- Опция: shimmering gradient (через reanimated)

### Empty
- Иконка 48pt в круге gray[100]
- Title 16pt 600 gray[700]
- Description 13pt gray[500]
- Action button (если применимо) — primary

### Error
- Banner вверху сkrasnym фоном (red[50])
- Внутри: Ionicons `alert-circle` red[500] + текст ошибки + retry button

### Pull-to-refresh
- На всех списочных экранах: `<RefreshControl tintColor={primary[600]} />`

## 8. Анимации

Через `platform/motion`:
- `SPRING_TIGHT` — быстрые UI-реакции (tab focus, button press)
- `SPRING_SOFT` — переходы между экранами / sheets
- `TIMING_FAST` (200ms) — opacity / fade-in
- `TIMING_STANDARD` (300ms) — большинство переходов
- `TIMING_EMPHASISED` (400ms ease-out) — важные акценты

`react-native-reanimated` для всех анимаций (нативный поток, 60+fps).

## 9. Хаптика

`platform/haptics.haptic(intent)`:
- `select` — переключение таба, чипа
- `impact` — нажатие на основной CTA (Касса, Submit)
- `notify-success` / `notify-error` — успех/ошибка операции (Alert.alert замены)
- `warn` — деструктивные действия

## 10. Темы (Light / Dark)

Текущее: `userInterfaceStyle: "light"` в app.json — **только светлая**.

В рамках этой итерации не вводим dark mode (объём слишком велик), но Tab Bar Blur tint должен быть `systemThinMaterialLight` (для светлой темы) и легко переключаем на `systemThinMaterialDark` если в будущем добавим dark.

## 11. Pull-to-refresh, infinite scroll

- `<RefreshControl />` на всех списочных экранах
- `FlashList` для длинных списков (склад, чеки) — `estimatedItemSize` обязателен
- `keyExtractor` обязателен и стабилен (item.id)

## 12. Жесты

- Swipe-to-go-back уже есть в RootStack по умолчанию
- Внутри `ProductPickerModal` — есть кастомный `PanResponder`-swipe для возврата по папкам — оставляем

## 13. Клавиатура

- `KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}` на формах
- `keyboardShouldPersistTaps="handled"` на ScrollView с инпутами + кнопками
- На iOS добавить `keyboardDismissMode="on-drag"` для длинных списков

## 14. Tab Bar Spacer Hook

Все scrollable экраны (FlashList, FlatList, ScrollView) под `Main` стеком должны использовать:

```ts
const tabBarHeight = useTabBarHeight();
// ...
contentContainerStyle={{ paddingBottom: tabBarHeight + 16 }}
```

Это гарантирует, что последний элемент не перекрывается floating tab bar.

## 15. Accessibility (минимум)

- `accessibilityLabel` на всех IconButton (кнопки без текста)
- `accessibilityRole="button"` на TouchableOpacity-кнопках
- `accessible={true}` на сложных карточках (родительский role)
- Текст: minimal contrast 4.5:1 (project colors уже это обеспечивают)

## 16. Что НЕ делаем в этой итерации

- Dark mode (отдельная задача)
- iPad-адаптация (mobile-first, на iPad работает в портрете)
- App Clips
- Widgets / Live Activities
- Offline-mode (только базовое кеширование)
