# Safe Area — fix details

## Что было сломано

`mobile/src/screens/CallsScreen.tsx` — единственный экран в проекте без `SafeAreaView`. Использовал просто `<View style={{ flex: 1 }}>`, из-за чего на iPhone с Dynamic Island весь header (заголовок «Звонки», subtitle, date stepper) лежал поверх системной области.

Все остальные 26 screens корректно используют `<SafeAreaView edges={['top']}>` из `react-native-safe-area-context`.

## Что исправлено

### `CallsScreen.tsx`

```tsx
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

export default function CallsScreen({ navigation }) {
  const tabBarHeight = useTabBarHeight();
  // ...
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
          <TouchableOpacity onPress={goToPrevDay}><Ionicons name="chevron-back" /></TouchableOpacity>
          <TouchableOpacity onPress={goToNextDay}><Ionicons name="chevron-forward" /></TouchableOpacity>
        </View>
      </View>
      ...
      <ScrollView contentContainerStyle={{ paddingBottom: tabBarHeight + spacing[4] }}>
        ...
      </ScrollView>
    </SafeAreaView>
  );
}
```

Header теперь:
- Внутри `SafeAreaView edges=['top']` — система сама добавляет правильный inset для status bar / Dynamic Island.
- `paddingTop: spacing[2]` (8pt) — поверх safe-area inset, для визуального ритма с back-кнопкой.
- Back button 40pt circle (стандартная iOS pattern из других экранов проекта).
- Title `fontSize.xl` (20pt) + dataLabel subtitle.
- Date stepper — компактные 32pt кнопки в правой зоне.

ScrollView также получил `paddingBottom: tabBarHeight + spacing[4]` чтобы последний звонок не уходил под floating tab bar.

## Глобальный аудит

```bash
grep -l "<View style={{ flex" mobile/src/screens/  # экраны без SafeAreaView
```
после фикса — пусто. Все screens с tab/stack-навигацией используют SafeAreaView.

| Экран | edges | Где |
|-------|-------|-----|
| LoginScreen | (свой layout) | OK — отдельный stack без tab bar |
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
| EquipmentScreen | top | OK |

## Bottom safe area

Нижний край НЕ оборачиваем в SafeAreaView (`edges={['top']}` не включает bottom). Bottom inset обрабатывается через:

1. **Floating Tab Bar** — `TabBar.ios.tsx` сам берёт `useSafeAreaInsets().bottom` и добавляет paddingBottom = max(insets.bottom, 12).
2. **Scrollable containers** — scrollView/FlashList используют `useTabBarHeight()` hook, который возвращает `60 + 6 + max(insets.bottom, 12) + 8 ≈ 88-96pt` — гарантированный отступ под bar для всех iPhone.

## Dynamic Island / iPhone 17 Pro

`react-native-safe-area-context` корректно репортит `insets.top = 59pt` на iPhone 17 Pro (с Dynamic Island). У iPhone 13/14 без DI — 47pt. SafeAreaView с `edges=['top']` применяет правильный отступ автоматически — никаких хардкодов.

## Что мы НЕ обернули

- `LoginScreen` — у него свой full-screen background gradient, и status bar в нём специально translucent. Логин выглядит правильно без SafeAreaView (background идёт под status bar намеренно).
- Modal-like overlays (например, ProductPickerModal внутри CheckCreateScreen) — у них свой backdrop, system inset не нужен.

## Acceptance — все ✅

- [x] CallsScreen header не залезает под status bar / Dynamic Island
- [x] CallsScreen имеет back-button (раньше не было)
- [x] CallsScreen последний элемент виден над tab bar
- [x] Все остальные экраны проверены, корректны
