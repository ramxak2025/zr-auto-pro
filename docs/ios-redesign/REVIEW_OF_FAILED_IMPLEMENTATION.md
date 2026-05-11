# Review of Failed Implementation (1st pass)

Дата: 2026-05-04 (поздняя ночь)
Автор: senior team (RN + iOS + design + QA)

## Зачем этот документ

Первая итерация iOS-redesign была отправлена на тестирование на iPhone 17 Pro владельца. По присланным скриншотам обнаружены критические дефекты. Документ фиксирует **что именно не выполнено** в первом проходе и даёт полную raison d'être для второго прохода (см. `CRITICAL_FIX_PLAN.md` и обновлённый `FINAL_REPORT.md`).

## Скриншоты-доказательства

### Скрин 1 — Заказ-наряд (создание чека)

Видно:
- Госномер `О 777 ОО 88 | 88` — **регион ДУБЛИРУЕТСЯ** в основной части и в правом блоке.
- Под центральной кнопкой Касса видна точка-индикатор активной вкладки.
- Внизу под tab bar — крупная синяя/светло-синяя подложка, ощущается как Android.

### Скрин 2 — Склад

Видно:
- Каждый товар — отдельная толстая карточка с тенью и большой иконкой 52pt.
- Между карточками воздух 8pt.
- Список занимает много места, информация плохо считывается.

### Скрин 3 — Звонки

Видно:
- Заголовок «Звонки» лежит **поверх системного status bar** (наезд на время).
- «Сегодня» в правом верхнем углу — **под Dynamic Island**.
- Нет кнопки Назад.
- Карточки статистики работают, но всё съезжает из-за отсутствия SafeAreaView.

## Дефекты по приоритетам

### P0 — блокеры выпуска

| # | Где | Что не так | Корень |
|---|------|------------|--------|
| 1 | `mobile/src/components/RussianPlateInput.tsx` | Регион появляется и в main TextInput, и в правом region блоке | В первом проходе я составил `displayValue = formatMain(main) + ' ' + region` и одновременно отрисовывал `<Text>{region}</Text>` справа — два места показа одной строки. Нужно разделить на два независимых TextInput |
| 2 | `mobile/src/screens/CallsScreen.tsx` | Заголовок и фильтры под status bar / Dynamic Island | Использовался `<View style={{ flex:1 }}>` без `SafeAreaView`. Все остальные экраны имеют `SafeAreaView edges=['top']`, этот забыли |
| 3 | `mobile/src/navigation/TabBar.ios.tsx` | Лишние точки-индикаторы под активными иконками, тяжёлая центральная кнопка | В первой версии я добавил `activeDot` под label чтобы маркировать текущий таб; в результате интерфейс получил Android/Material-привкус. KassaButton оставлен heavy (62pt с liquid blobs + marginTop -28) — выпрыгивает над баром |

### P1 — серьёзно для UX

| # | Где | Что не так |
|---|------|-----------|
| 4 | `ProductsScreen.tsx` | Карточки товаров слишком толстые: borderRadius 16, тень, фото 52pt, padding 12. Не похоже на iOS Settings/Mail список |
| 5 | Schedule screens | Хотя `paddingBottom 120` уже добавлен, общий iOS polish не доведён (legend, headers) |
| 6 | Безымянные header'ы | Часть экранов имеет inline header с `paddingTop: spacing[4]` (16pt) что мало для устройств с Dynamic Island при отсутствии SafeAreaView |

### P2 — улучшения

| # | Где | Что |
|---|------|-----|
| 7 | Header типографика | Где-то 18pt fontWeight 700, где-то 24pt 600 — нужна единая шкала |
| 8 | Empty states | Разнобой: где-то скелетон, где-то spinner, где-то «Нет ...» |
| 9 | Inset grouped lists | Только один экран использует «iOS-grouped» вид |

## Почему промахнулся в первом проходе

1. **Plate input** — я сосредоточился на нормализации (latin→cyrillic) и backwards compatibility, и не пере-проверил визуальный слой. По коду «казалось что splitPlate отделяет main от region», но на самом деле я склеил их обратно в один TextInput чтобы поддержать seamless backspace. Это и привело к дублю на экране.
2. **CallsScreen Safe Area** — я делал глобальный grep `SafeAreaView edges=['top']` и видел много экранов. Но `CallsScreen.tsx` начинается с `<View>`, а не с `<SafeAreaView>` — мой grep этого не вычислил. Нужен был визуальный аудит каждого экрана.
3. **TabBar dots** — я добавил `activeDot` под label с намерением "усилить ясность активного состояния". Но iOS native taa bar не использует точки — там работают только цвет и weight. Это типичный «дизайн в брайнсторме», не подкреплённый анализом референсов.
4. **KassaButton** — оставил без изменений, считая что «liquid blobs выглядят красиво». На скрине видно что выпрыгивающий 62pt круг с blobs делает бар кричащим, а не премиальным.

## Файлы которые нужно переделать (план)

| Файл | Действие |
|------|----------|
| `mobile/src/components/RussianPlateInput.tsx` | переписать с двумя TextInput (main + region), auto-focus к region при заполнении main, backspace в empty region возвращает фокус на main |
| `mobile/src/utils/plateMask.ts` | добавить `processPlateMainInput`, `processPlateRegionInput`, `combinePlate` |
| `mobile/src/utils/__tests__/plateMask.test.ts` | расширить тесты |
| `mobile/src/screens/CallsScreen.tsx` | обернуть в SafeAreaView edges=['top'], добавить native iOS header с back-button + title + date stepper, ScrollView paddingBottom через useTabBarHeight |
| `mobile/src/navigation/TabBar.ios.tsx` | удалить activeDot, переписать KassaGlassDome (компактный 46pt без liquid blobs), усилить native blur (BlurView intensity 96, systemThinMaterialLight), top rim hairline + outer glow |
| `mobile/src/hooks/useTabBarHeight.ts` | синхронизировать TAB_BAR_PILL_HEIGHT с новым 58pt |
| `mobile/src/screens/ProductsScreen.tsx` | продукт-row → iOS plain-list стиль: hairline separator, фото 42pt, без individual border/shadow |
| `mobile/src/components/KassaButton.tsx` | оставить (используется только TabBar.android), iOS на него больше не ссылается |

## Что НЕ переделываем

- Backend контракты (явный запрет).
- TabBar.android.tsx (чтоб не сломать Android-юзеров).
- Schedule architecture (риск регрессии — у пользователя не было критики архитектуры расписания, только «работает криво»).
- Persistent cache / prefetch (это уже работает, не трогаем).

## Acceptance criteria 2-го прохода

- [ ] Госномер `О777ОО88` показывается как `О 777 ОО | 88` — РЕГИОН НЕ ДУБЛИРУЕТСЯ.
- [ ] Латиница `O777OO88` нормализуется в `Р... → О 777 ОО | 88` (с точностью до маппинга O→О).
- [ ] Switcher RU/INT работает, в INT режиме маска не применяется.
- [ ] CallsScreen: заголовок не залезает на status bar, есть кнопка Back, последний звонок виден над tab bar.
- [ ] TabBar: НЕТ точек под label, центральная кнопка компактная, бар выглядит как iOS.
- [ ] Склад: товары — компактные ряды (~62pt высотой), не толстые карточки.
- [ ] TypeScript: новых ошибок нет.
