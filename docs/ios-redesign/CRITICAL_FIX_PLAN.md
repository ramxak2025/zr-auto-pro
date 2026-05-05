# Critical Fix Plan — 2nd pass

Точечные правки по дефектам из `REVIEW_OF_FAILED_IMPLEMENTATION.md`.

## 1. Госномер: устранение дубля региона

### Корень проблемы

В первой версии `RussianPlateInput`:
```tsx
const displayValue = formatMain(main) + ' ' + region;  // "О 777 ОО 88"
<TextInput value={displayValue} ... />                  // показывает "О 777 ОО 88"
<Text>{region}</Text>                                   // и снова "88"
```
→ на экране видим `О 777 ОО 88 | 88`.

### Решение

Разделить на **два независимых TextInput**:

```tsx
<TextInput value={formatMain(main)} maxLength=8 />   // main only
<View style={divider} />
<TextInput value={region} keyboardType="number-pad" maxLength=3 />  // region only
```

### UX-детали

- При заполнении main (6 cyrillic chars) — auto-focus переходит на region.
- При backspace в пустом region — focus возвращается на main.
- Родитель видит ОДИН clean string `value` ('О777ОО88'). Внутри компонент его split → main / region, и на каждое изменение из любого блока пересобирает clean string через `combinePlate(main, region)`.
- Spec поведения латиницы и валидации не меняется.

### Acceptance

- `О777ОО88` → визуально `О 777 ОО | 88`. ✅
- `O777OO88` (latin) → `О 777 ОО | 88`. ✅
- `р332ра05` → `Р 332 РА | 05`. ✅
- `А123АА777` (3-digit region) → `А 123 АА | 777`. ✅
- Регион не появляется в main блоке ни при каких обстоятельствах. ✅
- Пробелы внутри ввода `р 332 ра 05` → нормализуются.

### Тесты (`utils/plateMask.ts`)

Новые экспортируемые функции:
- `processPlateMainInput(raw): string` — max 6 chars, applies position rules
- `processPlateRegionInput(raw): string` — digits only, max 3
- `combinePlate(main, region): string` — concat helper

Тесты в `__tests__/plateMask.test.ts` покрывают edge cases (latin, lowercase, spaces, длинные ввод, неполные ввод).

## 2. Tab Bar: убрать точки и облегчить Касса

### Корень проблемы

```tsx
<Animated.View style={[styles.activeDot, dotStyle]} />  // ← убрать
```
И KassaButton 62pt с marginTop -28 + 5 анимированных liquid blobs — выглядит heavy.

### Решение

`TabBar.ios.tsx`:
- Удалить `activeDot` View и связанный `dotOpacity` shared value.
- Снизить `BAR_HEIGHT` 60 → 58 — плотнее.
- BlurView оставить (`intensity 96`, `systemThinMaterialLight`) — это native UIVisualEffectView под капотом.
- Top rim hairline (`rgba(255,255,255,0.78)`) — для glass-эффекта.
- Outer glow `colors.primary[700]` opacity 0.05 — мягко обозначает позицию бара.
- `KassaGlassDome` — новый inline component:
  - 46pt circle (flush с баром, **без** marginTop -28)
  - LinearGradient `primary[400] → primary[600]`
  - Top half — translucent white highlight
  - Hairline white border 0.7 alpha
  - Spring scale на focus (1.04, без выпрыгивания)
  - **Без** liquid blobs — премиум формируется light gradient + hairline, а не анимированными пятнами

### Acceptance

- Под label нет точек / pill. ✅
- Центральная кнопка не выпрыгивает над баром. ✅
- Активный таб обозначен только tint + bold weight. ✅
- Бар выглядит как iOS native (Apple Mail / Wallet чувство). ✅

## 3. CallsScreen: Safe Area + native header

### Корень проблемы

```tsx
return <View style={{ flex:1 }}> ... </View>;  // нет SafeAreaView
```

И header без back-button, title под Dynamic Island.

### Решение

```tsx
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

return (
  <SafeAreaView style={styles.container} edges={['top']}>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.primary[600]} />
      </TouchableOpacity>
      <View style={styles.headerCenter}>
        <Text style={styles.title}>Звонки</Text>
        <Text style={styles.subtitle}>{dateLabel}</Text>
      </View>
      <View style={styles.dateNav}>
        <TouchableOpacity ...><Ionicons name="chevron-back" /></TouchableOpacity>
        <TouchableOpacity ...><Ionicons name="chevron-forward" /></TouchableOpacity>
      </View>
    </View>
    ...
    <ScrollView contentContainerStyle={{ paddingBottom: tabBarHeight + 16 }}>
      ...
    </ScrollView>
  </SafeAreaView>
);
```

Стили header: `paddingTop: spacing[2]` (8pt — SafeAreaView уже даёт верхний inset), back-button 40pt circle.

### Acceptance

- Заголовок «Звонки» полностью под Dynamic Island. ✅
- Есть back-button. ✅
- Дата идёт subtitle'ом, стрелочки → / ← маленькие в правой зоне. ✅
- Последний звонок виден над floating bar. ✅

## 4. Склад: компактные iOS list rows

### Корень проблемы

```ts
productCard: {
  borderRadius: 16,
  borderWidth: 1, borderColor: gray[100],
  padding: 12,
  shadowColor: black, shadowOpacity: 0.04, ...
}
```
→ каждая карточка ~110pt высотой, выглядит как Material card.

### Решение

```ts
productCard: {
  backgroundColor: white,
  paddingHorizontal: spacing[3],   // 12
  paddingVertical: spacing[2.5],   // 10
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: gray[200],
}
productPhoto: { width: 42, height: 42, borderRadius: borderRadius.md }
productName:  { fontSize: 15, fontWeight: '600' }
productSellPrice: { fontSize: 13, color: primary[700] }
productStock: { fontSize: 16, fontWeight: '700' }
```

Каждая row ~62pt, отделены hairline-разделителями. iOS plain list look. Без `borderRadius` / shadow.

### Acceptance

- Видно ~10 товаров на iPhone 17 Pro экране (раньше 6). ✅
- Информация плотнее, hierarchy чище: имя → категория → цена/себестоимость; справа stock. ✅
- Производительность не падает (FlashList сохраняется). ✅

## 5. Глобальный Safe Area audit

Проверены все экраны:

| Экран | edges | Статус |
|-------|-------|--------|
| LoginScreen | (свой layout) | OK — не tab screen |
| DashboardScreen | top | OK |
| ProductsScreen | top | OK |
| ChecksScreen | top | OK |
| CheckCreateScreen | top | OK |
| CheckDetailScreen | top | OK |
| ClientsScreen | top | OK |
| ClientDetailScreen | top | OK |
| MoreScreen | top | OK |
| ScheduleScreen | top | OK |
| **CallsScreen** | top | **исправлено** |
| EmployeesScreen | top | OK |
| EmployeeDetailScreen | top | OK |
| ServicesScreen | top | OK |
| SuppliersScreen | top | OK |
| SupplierDetailScreen | top | OK |
| SalaryScreen | top | OK |
| ReportsScreen | top | OK |
| CashFlowScreen | top | OK |
| ExpensesScreen | top | OK |
| TrashScreen | top | OK |
| MarketingScreen | top | OK |
| CompanySettingsScreen | top | OK |
| AdminScreen | top | OK |
| UsersScreen | top | OK |
| SubscriptionScreen | top | OK |
| CarsScreen | top | OK |

Только CallsScreen был сломан. Остальные уже корректны.

## 6. Native UIVisualEffectView

`expo-blur` под капотом использует **native `UIVisualEffectView` с `UIBlurEffect`**. То есть текущая реализация TabBar.ios — **уже native-glass**, не CSS-имитация. Дополнительный кастомный Swift-модуль не даст visual-выгоды на iOS 17+.

`UIGlassEffect` (iOS 26+) — будущее enhancement через config-plugin + Swift module. Откладывается до отдельной итерации (риск ломается с `prebuild --clean`, не оправдан visual-улучшением ≤5%).

См. `ASSUMPTIONS.md` A17 для полного обоснования.

## Порядок реализации

1. plateMask + RussianPlateInput + tests
2. CallsScreen
3. TabBar.ios + useTabBarHeight (sync 58pt)
4. ProductsScreen styles
5. Документы (этот файл, REVIEW, обновить FINAL_REPORT)
6. Typecheck + commit + push
