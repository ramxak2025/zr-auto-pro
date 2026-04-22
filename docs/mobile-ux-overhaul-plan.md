# Mobile UX Overhaul — План работ

## Блок 1: Госномер как primary input (приоритет 1)

### Файлы
- `mobile/src/components/RussianPlateInput.tsx` — переписать: одна строка под капотом, визуально два блока
- `mobile/src/screens/CheckCreateScreen.tsx` — интеграция: дата/время в шапку, номер как primary
- Новый: `mobile/src/utils/__tests__/plateMask.test.ts` — юнит-тесты на маску

### Ключевое решение
Одна строка `А123АА77` с визуальной маской. Backspace стирает справа налево бесшовно через оба "блока". Два TextInput заменяем на один с позиционированием текста.

## Блок 2: Общий редизайн (приоритет 2)

### Scope (реалистичный)
- Установить expo-haptics, добавить тактильный отклик на основные действия
- Улучшить theme/index.ts — добавить typography scale, shadow tokens
- НЕ делаем: полный Material 3 / SF Pro редизайн (это 2-4 недели работы дизайнера)
- НЕ делаем: замена Ionicons на lucide (800+ мест — отдельная задача)

### Файлы
- `mobile/src/theme/index.ts` — расширить tokens
- Новый: `mobile/src/utils/haptics.ts` — обёртка над expo-haptics
- Затронутые экраны: ключевые действия (создание чека, открытие смены, удаление)

## Блок 3: Drag & drop папок склада (приоритет 3)

### Файлы
- `mobile/src/screens/ProductsScreen.tsx` — заменить стрелки на DraggableFlatList
- Установить: `react-native-draggable-flatlist`

### Бэкенд
Эндпоинт `PATCH /warehouse/categories/order` уже существует — отправляет массив orderedIds.

## Блок 4: Расписание — модернизация (приоритет 4)

### Scope (реалистичный)
- Добавить FadeIn/FadeOut анимации через Reanimated при смене месяца
- Улучшить пустое состояние
- НЕ делаем: полный таймлайн-календарь (это отдельное приложение на 3-4 недели)
- НЕ делаем: drag-to-create / drag-to-move записи (требует нового бэкенд API)

### Файлы
- `mobile/src/screens/ScheduleScreen.tsx` — анимации, пустые состояния
