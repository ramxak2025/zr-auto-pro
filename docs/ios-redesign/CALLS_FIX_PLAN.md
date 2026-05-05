# Calls — fix plan and result

## Был сломан

Скриншот показывал:
- Заголовок «Звонки» на одной строке с системным временем (наезд)
- subtitle «История и записи» сжат
- «Сегодня» в правой части под Dynamic Island
- Нет back-button
- Карточки 0/0/0/0 (Вх./Исх./Пропущ./Без отв.) поджаты

## Что исправлено

### 1. SafeAreaView

`<View>` → `<SafeAreaView edges={['top']}>` — устраняет наезд на status bar.

### 2. Native iOS header

```
┌──────────────────────────────────────────┐
│ ← │ Звонки               │ < · > │       │  56pt
│   │ 5 мая, понедельник   │       │       │
└──────────────────────────────────────────┘
```

- Back-button 40pt circle, primary[50] background, primary[600] icon — стандартная iOS pattern
- Title 20pt 700 weight, letterSpacing -0.3 (San Francisco-style)
- Subtitle = текущая дата (раньше «История и записи» — generic, не информативно)
- Date stepper в правой зоне: ‹ и › 32pt кнопки

### 3. Bottom inset

`<ScrollView contentContainerStyle={{ paddingBottom: tabBarHeight + 16 }}>` — последний звонок виден над floating tab bar.

### 4. Empty state

Оставили существующий: иконка `call-outline` 32pt + текст «Нет звонков» / «Пропущенных нет». Стиль уже iOS-friendly.

### 5. Filter tabs «Все / Вх. / Исх. / Пропущ.»

Без изменений — pill-style уже подходит для iOS. Оставили.

## Что НЕ трогали

- Логику выборки звонков (`useQuery + callsApi.getList`)
- Формат phone-numbers (`formatPhone()`)
- Ссылки на recording URL (Linking.openURL)
- Card layout каждого звонка (кружок-аватар + имя + телефон + время + duration) — это уже iOS-friendly

## Acceptance — все ✅

- [x] Header не залезает на status bar / Dynamic Island
- [x] Есть back-button — пользователь может вернуться в MoreScreen
- [x] Date stepper компактный, не борется с заголовком
- [x] Subtitle информативный (текущая дата, не generic «История и записи»)
- [x] Последний звонок виден над tab bar
- [x] Empty state с иконкой и текстом
