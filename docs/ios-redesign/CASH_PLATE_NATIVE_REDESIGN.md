# Касса / госномер / выбранный авто — iOS redesign

Дата: 2026-05-05. Ветка: `claude/fix-auteksa-freezing-zuMJS`.

---

## Iteration #3 — компактная inline-композиция

Iter#2 отвергнут: 76pt plate доминирует, «Приора» висит отдельно. Эта итерация:

- В `makePlateBadgeStyles` factory добавлен новый размер **`mini` = 36pt**.
- Selected card теперь использует `size="mini"`, не `"large"` — огромная плата убрана.
- Layout: `client header` + hairline divider + **inline row** «mini-plate (слева) + Lada Priora / комментарий (справа)» — iOS-list-row pattern, plate и марка авто структурно в одной semantic-группе.
- Удалены: 76pt plate, section label «АВТОМОБИЛЬ», chip `<Ionicons car-sport>` row.
- Поиск и маска не тронуты (по фидбеку).

```
┌─────────────────────────────────────────────┐
│ ╭───╮  Иван Петров              [×]         │
│ │ 👤│  +7 999 123-45-67                     │
│ ╰───╯                                       │
│ ─────────────────────────────────────────   │
│ ┌──────────────────┐                        │
│ │ Х 807 КС │ 198   │   Lada Priora         │
│ └──────────────────┘   Чёрная, 2018         │
└─────────────────────────────────────────────┘
```

---

## Iteration #2 (после физического iPhone)

Владелец отверг iter #1: «номер всё ещё зажат, регион/RUS/флаг неэстетично, авто 'Приора' под номером выглядит как случайный текст». Эта итерация переработала визуал.

### Госномер — настоящие ГОСТ-пропорции с дыханием

- **`PLATE_BADGE_H_LARGE` 64 → 76pt** в `CheckCreateScreen.tsx` (плата в карточке клиента).
- **`PLATE_HEIGHT` 56 → 64pt** в `RussianPlateInput.tsx` (поле поиска).
- Фабрика `makePlateBadgeStyles(height)` пересчитана пропорционально:
  - `mainFont = 0.52H`, letter-spacing на больших размерах `1.6 → 1.2` — текст не липнет к divider'у.
  - `regionFont = 0.44H`.
  - `regionPadV = 0.09H` (~7pt при 76), `regionPadH = 0.07W` — РЕАЛЬНОЕ внутреннее дыхание.
  - `flagBox.marginVertical = 0.03H` — флаг отделён от digit и RUS.
  - Inner cant inset = 0.05H (вторая hairline-рамка ГОСТ).
  - `regionBlock.justifyContent: 'space-between'` — digit сверху, флаг в середине, RUS снизу, каждому своя полоса.
- В `RussianPlateInput`: regionSection padV=6, padH=5; regionInput 28pt + lineHeight 30pt; RUS 11pt; flag bands 28×3.6pt.

### Карточка выбранного клиента/авто — премиальный iOS composite

```
┌─────────────────────────────────────────────┐
│ ╭───╮  Иван Петров              [×]         │  Section 1: client
│ │ 👤│  +7 999 123-45-67                     │
│ ╰───╯                                       │
│ ─────────────────────────────────────────   │  Hairline divider
│ АВТОМОБИЛЬ                                  │  Section 2: car
│                                             │
│            ┌──────────────────┐             │
│            │  Х 807 КС │ 198  │             │
│            │           │ ━━━  │             │
│            │           │ RUS  │             │
│            └──────────────────┘             │
│                                             │
│         ╭──────────────────────╮            │
│         │ 🚗  Lada Priora      │            │  chip:
│         │     Чёрная, 2018     │            │  primary-50 bg
│         ╰──────────────────────╯            │  rounded full
└─────────────────────────────────────────────┘
```

- `selectedCard` — hairline border `colors.gray[200]`, rounded `2xl`, mягкий drop-shadow.
- `selectedCardDivider` — full-bleed hairline между секциями.
- `selectedCardSectionLabel` — «АВТОМОБИЛЬ» 11pt uppercase, letter-spacing 1, gray-500.
- `selectedCarChip` — pill-style (`borderRadius: 999`), `colors.primary[50]` фон, `<Ionicons name="car-sport" />` + текст. Маrka/model теперь привязана структурно как chip, не «случайный текст».

---

## Что было неправильно

На скриншотах кассы:

1. Госномер в карточке выбранного клиента/авто рендерился, но **регион/RUS/флаг в правой зоне сжимались** — RUS в 6pt был нечитаем, флаг 10×3pt смотрелся пиксельным мусором.
2. Авто (например, «Приора») стояло **сбоку** от номера, через row-flex — глаз не понимал, что номер и авто относятся к одному объекту.
3. В режиме поиска (`RussianPlateInput`) та же региональная зона была 64pt — RUS терялся, флаг не помещался.
4. Пропорции номера в `PlateBadge` были близки к ГОСТ (4.64:1), но конкретные внутренние размеры (mainText 26pt, regionText 22pt) не масштабировались под presentation-кейс.

Структурно проблема была частично решена раньше: в коде уже два независимых `<TextInput>` (main + region), плюс `processPlateMainInput` / `processPlateRegionInput` — **дублирование региона невозможно по построению**. Latin→Cyrillic конвертация в `normalizeChar`. Тесты `mobile/src/utils/__tests__/plateMask.test.ts` уже зелёные. Дубликата вида «Х 807 КС 198 | 198» в коде физически возникнуть не может; визуальные проблемы были чисто компоновочные.

## Что исправлено

### 1. `mobile/src/components/RussianPlateInput.tsx`

- Регион-зона расширена с **64pt → 76pt** — оригинальный ГОСТ предписывает квадрат высотой плашки (height ≈ 56pt), 76pt даёт запас под визуальные элементы.
- `regionInput` fontSize **20 → 24pt** (regional digits — главный смысловой элемент правой зоны).
- Триколорный флаг: bands **10×3pt → 22×3.2pt** (стек вертикальный, hairline border вокруг — как на реальном номере), с `marginTop: 4` для дыхания.
- `RUS` legend: fontSize **6 → 9pt**, `letterSpacing 1.2`, fontWeight `900`. Теперь читается на всех iPhone от SE2 до 17 Pro Max.
- Добавлен константный экспорт `PLATE_REGION_WIDTH = 76`, чтобы фиксировать инвариант между файлами.

### 2. `mobile/src/screens/CheckCreateScreen.tsx` — `PlateBadge`

- Введены **два размерных пресета**: `'compact'` (48pt — для inline list rows) и `'large'` (64pt — для карточки выбранного клиента).
- Общая фабрика `makePlateBadgeStyles(height)` — все размеры (mainFont, regionFont, flagW, rusFont, и т. д.) масштабируются от высоты пропорционально. Это убирает риск рассинхрона между вариантами и облегчает добавление, например, 80pt presentation-варианта в будущем.
- Layout правой зоны переработан: `regionText` сверху, под ним — флаг (3 горизонтальные полосы в hairline-рамке), под ним — `RUS`. Раньше RUS+флаг шли side-by-side, что заставляло сжимать обе сущности; вертикальный стек даёт каждой нормальное место.

### 3. `selectedCarRow` — авто СНИЗУ под номером

- `flexDirection: 'row'` → `'column'`. Plate стоит сверху центрировано, авто-инфо (`makeModel` + `comment`) — широким блоком под ним, центрировано, до 2 строк комментария.
- `selectedCarModel` из 14pt/600 → **17pt/700, letterSpacing -0.2** — тот же типографический регистр, что у iOS Settings rows.
- `selectedCarYear` (комментарий) из 11pt → **13pt**, центрировано.

### 4. Анимация переключения «поиск ↔ карточка выбранного»

- В CheckCreateScreen добавлен `LayoutAnimation.configureNext` с iOS spring (240ms, springDamping 0.9) — карточка появляется/исчезает по нажатию на результат поиска или X.
- **Reduce Motion уважается**: `AccessibilityInfo.isReduceMotionEnabled()` опрашивается при mount и отслеживается через `addEventListener('reduceMotionChanged')`, результат хранится в ref, опция читается синхронно в момент анимации.
- Анимация iOS-only — на Android поведение прежнее (instant swap, никаких регрессий).

## Карточка выбранного клиента/авто — итоговый layout

```
╔═══════════════════════════════════════════════════════╗
║  ╭─────╮                                          [×] ║
║  │ 👤  │  Иван Петров                                 ║
║  ╰─────╯  +7 999 123-45-67                            ║
║                                                       ║
║  ─────────────────────────────────────────            ║
║                                                       ║
║                  ┌─────────────────────┐              ║
║                  │  Х 807 КС │ 198    │              ║
║                  │           │ ━━━     │              ║
║                  │           │ RUS     │              ║
║                  └─────────────────────┘              ║
║                                                       ║
║                       Lada Priora                     ║
║                       Чёрная, 2018                    ║
╚═══════════════════════════════════════════════════════╝
```

X (top-right) → animateClientToggle() → setClientId('') → плавное возвращение поиска.

## Карточка поиска — итоговый layout

```
╔═══════════════════════════════════════════════════════╗
║  ПОИСК ПО ГОСНОМЕРУ                          [RU][INT]║
║                                                       ║
║  ┌───────────────────────────────────────────┐        ║
║  │  А 000 АА          │      00    ━━━ RUS   │        ║
║  └───────────────────────────────────────────┘        ║
║                                                       ║
║  ↓ inline-результаты появляются здесь же              ║
╚═══════════════════════════════════════════════════════╝
```

Mode switcher (`RU/INT`) уже в коде. Иностранный режим (`PlateMode='foreign'`) использует отдельный layout с синим INT-стрипом — российская маска не применяется.

## Acceptance criteria

| Требование                                            | Статус                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Регион/RUS/флаг помещаются в карточке без обрезки     | ✅ 76pt strip + 9pt RUS + 22×3.2 bands                                                     |
| Авто отображается СНИЗУ под госномером                | ✅ column flex, центрировано                                                               |
| Маска поиска выглядит как реальный номер              | ✅ white plate, GOST proportions, region strip                                             |
| Регион не дублируется в основной части                | ✅ структурно невозможно (split fields + processPlateMainInput max 6 chars)                |
| RU/INT переключатель работает корректно               | ✅ `PlateModeSwitcher` + `mode` prop в `RussianPlateInput`, foreign не использует RU маску |
| Latin→Cyrillic нормализация                           | ✅ `normalizeChar` в `plateMask.ts`                                                        |
| Поиск скрыт при выбранном клиенте, X возвращает поиск | ✅ ternary `clientId && selectedClient ? <Card> : <Search>` + `animateClientToggle()`      |
| Плавная iOS-анимация перехода                         | ✅ `LayoutAnimation` spring, Reduce Motion уважается                                       |

## Acceptance criteria — что владелец проверяет на iPhone

1. Открыть Касса → ввести номер «Х807КС198» через клавиатуру → выбрать первый результат → убедиться, что карточка плавно появляется, авто стоит под номером, RUS+флаг полностью видны.
2. Нажать X → убедиться, что карточка плавно сворачивается и возвращается поле поиска с пустым значением.
3. Включить Settings → Accessibility → Motion → Reduce Motion → повторить шаги 1-2 — анимация должна быть выключена, переход моментальный.
4. Переключить RU → INT → ввести «ABC123» → убедиться, что показывается синий INT-стрип и латинские символы не конвертируются.

## Файлы

- `mobile/src/components/RussianPlateInput.tsx`
- `mobile/src/screens/CheckCreateScreen.tsx` — секции `PlateBadge`, `selectedCard*` styles, `animateClientToggle`
- `mobile/src/utils/plateMask.ts` — без изменений (логика была корректной)
- `mobile/src/utils/__tests__/plateMask.test.ts` — без изменений, должны оставаться зелёными
