# Assumptions — принятые автономные решения

В процессе работы возникли неоднозначные места. Все они задокументированы здесь.

## A1. Ветка работы
**Решение:** работаем на существующей ветке `claude/fix-auteksa-freezing-zuMJS` (не создаём новую `autexa-ios-full-autonomous-fix`).
**Причина:** ветка тематически совпадает («fix iOS freezing → полный iOS redesign»), уже push'нута, на ней последний коммит про iOS deploy guide. Создавать ещё одну ветку = лишний шум в истории.

## A2. Persistent cache — без новых зависимостей
**Решение:** свой helper в `utils/persistentCache.ts` поверх AsyncStorage.
**Альтернатива:** `@tanstack/query-async-storage-persister` + `@tanstack/react-query-persist-client`.
**Причина:** меньше зависимостей, минимальный код, нам не нужно 100% покрытие — только ключевые запросы (products, services, users, schedule).

## A3. Plate mode default = RU
**Решение:** дефолтный режим `plateMode = 'ru'`.
**Причина:** большинство клиентов автосервисов в РФ — российские. Иностранные авто — меньшинство, юзер явно переключает.

## A4. Foreign plate normalization
**Решение:** для foreign делаем только `toUpperCase()` + trim, без удаления специальных символов (`-`, `/`, пробел между группами).
**Причина:** иностранные номера часто пишутся с разделителями (`BG-3845-PA`, `T 123 AB`). Нельзя угадать формат конкретной страны.
**Поиск backend:** ищет по подстроке (ILIKE), так что `bg-3845-pa` матчится с `BG3845PA` если backend нормализует похожим образом. Если нет — клиент сохраняет в БД именно так как ввёл, и поиск работает по точной строке.

## A5. Persistent cache — 5 ключей
**Решение:** `['products', 'all-services', 'all-products-check', 'users', 'schedule']`.
**Причина:** это самые «тяжёлые» и редко меняющиеся данные. Чеки (`['checks']`) НЕ персистим — они часто меняются и могут быть stale.

## A6. Tab Bar — оставляем floating pill
**Решение:** усиливаем существующий floating BlurView pill, не делаем edge-to-edge bar.
**Причина:** floating pill — это и есть iOS 26 / Liquid Glass-стиль. Edge-to-edge bar — это Material Design / Android. На iOS лучше floating.

## A7. useTabBarHeight() — iOS-only
**Решение:** hook возвращает `0` на Android.
**Причина:** Android tab bar (Material 3 в TabBar.android.tsx) — solid surface на всю ширину, контент сам не плавает под ним (Android-навигация сама добавляет paddingBottom через `safeAreaInsets.bottom`).
**Альтернатива:** делать platform-aware logic. Не нужно — экраны на iOS получают правильный отступ, на Android — обычное поведение без изменений.

## A8. Schedule — минимальные iOS правки
**Решение:** не делаем полную переработку ScheduleScreen.
**Причина:** 89K LoC, 5 табов, очень много логики. Риск регрессии огромный. Делаем точечные iOS-фиксы (paddingBottom, KeyboardAvoidingView, scroll deceleration).

## A9. Skeleton vs Spinner
**Решение:** для списочных экранов — Skeleton; для одиночных загрузок (модал, переход) — Spinner.
**Причина:** Skeleton показывает структуру UI и снижает perceived latency. Spinner — для коротких операций.

## A10. Bundle ID
**Решение:** оставляем `com.autexa.mobile` (Apple Developer регистрация прошла, аккаунт `Ramazan Shamsudinov` — Admin).
**Причина:** уже зарегистрирован, менять не нужно.

## A11. Не вводим dark mode
**Решение:** оставляем `userInterfaceStyle: "light"`.
**Причина:** объём работы по dark mode = отдельная итерация (надо переделать все цвета для dark).

## A12. Не добавляем offline-first
**Решение:** только базовое кеширование, mutation идут только онлайн.
**Причина:** offline-first требует merge-стратегий, conflict resolution, очереди операций. Это отдельный большой проект.

## A13. Запрос данных pagination
**Решение:** оставляем `limit: 500` для warehouse (как было).
**Причина:** для большинства автосервисов 500 товаров — потолок. Pagination нужна только при >500.

## A14. Plate switcher — segmented control vs custom toggle
**Решение:** custom toggle через 2 TouchableOpacity (segmented control из RN не нативный).
**Причина:** SegmentedControl iOS требует доп зависимостей или native-код. Проще сделать 2 кнопки с тем же UX.

## A15. Not убираем `expo-symbols` из зависимостей
**Решение:** оставляем `expo-symbols` дропнутым (последний коммит `fix(mobile): drop pinned expo-symbols version that doesn't exist on npm`).
**Причина:** уже исправлено в предыдущем коммите.

## A16. Не модифицируем backend
**Решение:** все нормализации поиска делаем на клиенте.
**Причина:** разрешение системы запрещает менять backend без крайней необходимости.

## A17. Native Swift / UIKit / SwiftUI — рассмотрено, в этой итерации не добавляем
**Решение:** оставляем всё на React Native + expo-blur + reanimated.
**Причина:**

| Кандидат на native | Решение | Обоснование |
|--------------------|---------|-------------|
| Tab Bar Liquid Glass | RN + expo-blur (`systemUltraThinMaterialLight`, intensity 92) | expo-blur под капотом использует `UIVisualEffectView` с `UIBlurEffect`. Это даёт настоящий iOS-glass на iOS 13+. Новый `UIGlassEffect` (iOS 26+) даёт чуть «жидкое» искажение, но: (1) требует config-plugin или native module (нарушает `expo prebuild --clean` workflow владельца), (2) iOS < 26 нужен fallback всё равно на UIBlurEffect, (3) визуальная разница ≤ 5% на статическом баре. Текущая реализация уже close-to-native. |
| Маска госномера | RN | `processPlateInput()` + `splitPlate()` дают идеальный визуальный плате с разделителем. Caret behaviour в `TextInput` стабильный. Native UITextField не даст преимуществ. |
| Расписание Grid | RN | UICollectionView с compositional layout был бы идеальным, но это **полная переработка** одного из крупнейших экранов (89K LoC). Риск регрессии огромный. Текущая реализация с двумя синхронизированными ScrollView работает. Native — отдельная большая фаза. |
| Haptics | expo-haptics | Под капотом уже использует `UIImpactFeedbackGenerator` / `UISelectionFeedbackGenerator`. Native переписывать смысла нет. |
| Анимации | reanimated v4 + worklets | Реанимации идут на UI thread, fps стабильный. Native CABasicAnimation не дала бы заметного выигрыша. |
| Blur / Material | expo-blur | Уже native через UIVisualEffectView. |

**Когда стоит вернуться к native:** если после реальной проверки на iPhone 17 Pro окажется что:
- Tab bar blur выглядит «искусственным» по сравнению со штатными iOS приложениями
- Performance скролла грид-расписания падает (ниже 50 fps)
- Плате-маска даёт нестабильный caret или копи-паст ломается

Тогда — отдельная итерация с локальным Expo Module (`npx create-expo-module --local`) + config-plugin, чтобы native файлы переживали `prebuild --clean`.

В HOW_TO_RUN_FOR_OWNER.md упомянуто, что `prebuild --clean` сам поднимает CocoaPods (`pod install`), поэтому если в будущем добавится native модуль, владельцу не придётся делать дополнительных действий — только `prebuild --clean` + Run.
