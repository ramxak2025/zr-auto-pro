# Визуальная система десктопной админки Autexa (фаза A, 2026-09-25)

Источник правды для веб-админки (`frontend/`, маршруты за логином). Лендинг живёт по
`docs/DESIGN.md` и здесь не рассматривается. Аудит, из которого выросла система, —
`docs/web-redesign/AUDIT.md`. Скриншоты до/после — `docs/web-redesign/screenshots/`.

## 1. Направление и принципы

**Точный рабочий инструмент.** Владелец и администратор автосервиса проводят за админкой
весь день: касса, журнал, склад, зарплата. Дизайн не продаёт — он помогает сканировать
таблицы и суммы, не ошибаться и не уставать. Тот же продукт, что iOS-приложение (синий
`#2563eb`, спокойные нейтральные, lucide-иконки, русский язык, «ё»), но в десктопной идиоме:
тёмная боковая навигация с группами (знакомая пользователям Битрикс24/amoCRM), белые рабочие
поверхности на холодном холсте, плотные таблицы.

1. **Одна поверхность.** Карточка — белая, hairline-граница, радиус 12 px, едва заметная
   тень. Никаких градиентов, тёмных «premium»-карточек и водяных знаков.
2. **Один акцент на экран.** Одна primary-кнопка (главное действие) на странице; всё
   остальное — secondary/ghost. Синий — бренд и активное состояние, не украшение.
3. **Семантика цвета только по смыслу.** `ok` — деньги пришли/успех, `warn` — требует
   внимания, `bad` — ошибка/просрочка/удаление, `info` — нейтральная подсказка. KPI-плитки
   по умолчанию нейтральные, а не «светофор».
4. **Плотность без каши.** Контролы 36 px, строки таблиц 40 px (плотный режим — 32),
   8-px сетка, отступ между карточками 20 px.
5. **Текст не мельче 11 px и не светлее `ink-3`.** `text-[9px]/[10px]` и `text-gray-400` на
   содержательном тексте запрещены.
6. **Числа — табличными цифрами, справа.** Деньги — только через `Money`/`formatMoney`.
7. **Ошибка ≠ пусто.** Каждый запрос показывает loading → error (+«Повторить») → empty →
   данные. Никаких «Нет данных» при сбое сети.
8. **Клавиатура и фокус.** Всё интерактивное — `<button>`/`<Link>`, фокус-кольцо видно
   (`focus-visible`), hit-area ≥ 32 px, icon-only кнопки — только `IconButton` с `label`.
9. **Движение ≤ 200 мс**, только `transform`/`opacity`, уважает `prefers-reduced-motion`
   (глобальное правило в `index.css` + `MotionConfig reducedMotion="user"` в оболочке).
10. **Состояние — в URL.** Фильтры, период, страница, вкладка — в query-параметрах, чтобы F5,
    «Назад» и пересылка ссылки работали.

## 2. Токены

Живут в `frontend/src/index.css` (`:root`, каналы «R G B») и подключены в
`tailwind.config.js` через `rgb(var(--c-…) / <alpha-value>)`, поэтому работают модификаторы
прозрачности (`bg-accent/25`). Старые `gray-*`/`primary-*` остаются для немигрированных
страниц; новый код использует только семантические имена.

### 2.1 Цвет

| Токен                              | Hex                         | Классы                                | Назначение                                          |
| ---------------------------------- | --------------------------- | ------------------------------------- | --------------------------------------------------- |
| `canvas`                           | #f4f6fa                     | `bg-canvas`                           | холст страницы                                      |
| `surface`                          | #ffffff                     | `bg-surface`                          | карточки, панели, контролы                          |
| `surface-2`                        | #f8fafc                     | `bg-surface-2`                        | шапки таблиц, футеры карточек, зебра                |
| `surface-3`                        | #f1f5f9                     | `bg-surface-3`                        | hover строк, фон сегмент-контрола, нейтральные чипы |
| `line`                             | #e2e8f0                     | `border-line`, `divide-line`          | hairline-границы                                    |
| `line-strong`                      | #cbd5e1                     | `border-line-strong`                  | рамки контролов, разделители тулбара                |
| `ink`                              | #0f172a                     | `text-ink`                            | заголовки, значения                                 |
| `ink-2`                            | #475569                     | `text-ink-2`                          | основной текст таблиц и форм                        |
| `ink-3`                            | #64748b                     | `text-ink-3`                          | подписи, подсказки (4.8:1 на белом)                 |
| `ink-4`                            | #94a3b8                     | `text-ink-4`                          | **только** декоративные иконки и шевроны            |
| `accent` / `accent-hover`          | #2563eb / #1d4ed8           | `bg-accent`, `text-accent`            | primary-кнопка, активный пункт, ссылки-действия     |
| `accent-soft` / `accent-soft-2`    | #eff6ff / #dbeafe           | `bg-accent-soft`                      | тинт активного/выбранного                           |
| `accent-text`                      | #1d4ed8                     | `text-accent-text`                    | текст на `accent-soft` (5.9:1)                      |
| `ok` / `ok-soft` / `ok-text`       | #16a34a / #f0fdf4 / #15803d | `bg-ok`, `bg-ok-soft`, `text-ok-text` | успех, деньги пришли                                |
| `warn` / `warn-soft` / `warn-text` | #d97706 / #fffbeb / #b45309 |                                       | внимание, скоро срок                                |
| `bad` / `bad-soft` / `bad-text`    | #dc2626 / #fef2f2 / #b91c1c |                                       | ошибка, просрочено, деструктив                      |
| `info` / `info-soft` / `info-text` | #0284c7 / #f0f9ff / #0369a1 |                                       | нейтральная подсказка                               |
| `rail` / `rail-2`                  | #101a2e / #182543           | `bg-rail`                             | боковая панель и её hover                           |
| `rail-text` / `rail-muted`         | #b4bfd3 / #6f7d99           | `text-rail-text`                      | текст пунктов / заголовки групп                     |

Готовые сочетания «тон → классы» — в `frontend/src/ui/tokens.ts` (`toneSoft`, `toneChip`,
`toneDot`, `toneText`, `focusRing`, `focusRingOnRail`).

### 2.2 Типографика

Шрифт — **Onest** (variable 400–800, self-hosted `public/fonts/onest-*.woff2`, unicode-range
сабсеты; два основных предзагружены в `index.html`). Google Fonts не используется — режется
операторами РФ. Onest поддерживает `tnum` — `tabular-nums` работает. Метрический фолбэк
`'Onest Fallback'` (Arial с size-adjust) убирает CLS при swap.

| Роль                      | Класс                                                | Размер/вес          |
| ------------------------- | ---------------------------------------------------- | ------------------- |
| Заголовок страницы (H1)   | `.page-title` / `text-title`                         | 22/28, 600, −0.01em |
| Заголовок карточки/секции | `text-md font-semibold`                              | 15/22, 600          |
| Основной текст, таблицы   | `text-sm`                                            | 14/20               |
| Подписи, подсказки        | `text-xs text-ink-3`                                 | 12/16               |
| Микроподписи (минимум)    | `text-2xs`                                           | 11/14               |
| KPI-значение              | `text-2xl font-semibold tabular-nums tracking-tight` | 24                  |
| Деньги в таблице          | `tabular-nums` (через `Money`)                       | 14, 500–600         |

Заголовки таблиц — 12 px/600 `ink-3`, **без uppercase** (капс мешает сканировать кириллицу).

### 2.3 Плотность, радиусы, тени, движение

- Высоты: контролы `h-9` (36 px), маленькие `h-8`; строка таблицы 40 px (`py-2.5`), плотная
  32 px (`table-dense`); шапка таблицы `h-10`; тулбар `min-h-[44px]`; верхняя панель 56 px.
- Радиусы: контролы и чипы `rounded-lg` (8), карточки/модалки `rounded-xl` (12), бейджи
  `rounded-md` (6), аватары `rounded-full`. `rounded-2xl/3xl` в админке не используются.
- Тени: `shadow-card` (покой), `shadow-pop` (меню, поповеры, hover карточки), `shadow-drawer`.
- Движение: `duration-150`, `ease-out`; меню/тултипы — `animate-pop-in` / `animate-tip-in`
  (140/120 мс); переход страниц 120 + 180 мс. Не анимируем `width/height` (исключение —
  однократное сворачивание боковой панели, 150 мс). `transition-all` запрещён — перечисляем
  свойства.
- Фокус: `focus-visible:ring-2 ring-accent/60 ring-offset-2` (`focusRing`/`.focus-ring`);
  базовое правило в `index.css` даёт кольцо всему, у чего фокус-стилей нет.
- Иконки: lucide, 16 px в контролах, 18 px в навигации, 20 px в чипах заголовков;
  всегда `aria-hidden="true"`, смысл несёт текст или `aria-label`.

## 3. Оболочка (`components/Layout.tsx`)

- **Боковая панель** 256 px / свёрнутая 72 px (`localStorage['autexa.sidebar']`), группы
  Работа · Клиенты · Склад · Деньги · Компания, активный пункт — синий индикатор слева +
  `aria-current="page"`, в свёрнутом виде — `Tooltip` справа. Замок тарифа остаётся ссылкой
  (страница покажет paywall `FeatureGate`).
- **Пункт меню** — `NavItem { label, path, icon, permission?, anyPermission?, featureKey?,
multiPointOnly?, end? }`. Добавляя раздел, положите его в группу и продублируйте в
  `routeTitles` (крошки) и в `mobileTabItems['Ещё'].matchPaths`. Права зеркалят
  `MorePage`/mobile `MoreScreen` и бэкенд-guard'ы.
- **Верхняя панель**: `Link`-крошки (родитель кликабелен), `PointIndicator` (филиал сессии,
  не переключатель), primary «Новый чек» (`checks_create`, скрыт на самой кассе), меню
  пользователя (`DropdownMenu`: Профиль и ещё · Уведомления · Тариф и подписка · Выйти).
- **Мобильный веб** (< md): шапка + нижние табы без изменений по составу
  (`mobileTabItems`), только токены.
- **Доступность**: skip-link «К содержимому» → `<main id="main">`, `nav aria-label`,
  `MotionConfig reducedMotion="user"`, `data-app` на корне (тонкие скроллбары только в
  приложении).
- Страницы **не** задают свою ширину контента: контейнер `max-w-screen-2xl` даёт оболочка.
  Исключение — одноколоночная форма-страница (`max-w-3xl mx-auto` допустим).

## 4. Примитивы `frontend/src/ui/` (импорт из `'../ui'`)

| Компонент                                                                                                 | Ключевые props                                                                                                                                                                                                                                                                                                                | Когда                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `Button`                                                                                                  | `variant: primary\|secondary\|ghost\|danger\|soft`, `size: sm\|md\|lg`, `loading`, `icon`, `iconRight`, `fullWidth`                                                                                                                                                                                                           | любое действие. `buttonClasses()` — для `<Link>`                             |
| `IconButton`                                                                                              | `label` (обязателен), `icon`, `variant`, `size`, `active`, `loading`                                                                                                                                                                                                                                                          | кнопка без текста; `components/IconButton` реэкспортирует                    |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                                                            | `padding: none\|sm\|md`, `interactive`; header: `title`, `subtitle`, `icon`, `iconTone`, `actions`, `dense`, `divider`, `as: h2\|h3`                                                                                                                                                                                          | любая поверхность                                                            |
| `StatCard`                                                                                                | `label`, `value`, `hint`, `icon`, `tone`, `delta {value,suffix,label,invert}`, `loading`, `to`/`onClick`, `compact`                                                                                                                                                                                                           | KPI-полоса                                                                   |
| `DataTable<T>`                                                                                            | `columns[{key, header, render, numeric, align, width, sortable, sortValue, footer, primary, hideBelow, interactive, truncate}]`, `rows`, `rowKey`, `rowHref`/`onRowClick`, `isLoading/isError/onRetry/isFetching`, `emptyState`, `stickyHeader`, `dense`, `maxHeight`, `sort/onSortChange/defaultSort`, `selectedKey`, `bare` | все списки. Главная колонка — настоящая ссылка/кнопка (клавиатура, Cmd+клик) |
| `Toolbar`, `ToolbarGroup`, `ToolbarSeparator`, `FilterBar`                                                | `end`, `sticky`                                                                                                                                                                                                                                                                                                               | строка «поиск · фильтры · период ‖ действия»                                 |
| `Field`                                                                                                   | `label`, `htmlFor`, `hint`, `error`, `required`, `inline`                                                                                                                                                                                                                                                                     | подпись + подсказка/ошибка вокруг контрола                                   |
| `Input`                                                                                                   | `size`, `leftIcon`, `rightSlot`, `invalid` (+ все атрибуты input)                                                                                                                                                                                                                                                             | текст; для денег `inputMode="decimal"`, не `type="number"`                   |
| `Select`                                                                                                  | `options`/дети, `placeholder`, `size`, `invalid`                                                                                                                                                                                                                                                                              | нативный select со своим шевроном                                            |
| `Textarea`, `Checkbox` (`label`, `description`, `indeterminate`), `RadioGroup` (`options`, `orientation`) |                                                                                                                                                                                                                                                                                                                               | формы                                                                        |
| `Tabs` + `TabPanel`                                                                                       | `items[{key,label,count,icon,disabled}]`, `value`, `onChange`, `variant: underline\|pills`, `aria-label`                                                                                                                                                                                                                      | разделы одной страницы (состояние — в URL)                                   |
| `SegmentedControl`                                                                                        | `options`, `value`, `onChange`, `size`, `fullWidth`, `aria-label`                                                                                                                                                                                                                                                             | 2–4 взаимоисключающих варианта (период, вид)                                 |
| `Badge`, `StatusPill`                                                                                     | `tone`, `size`, `dot`, `icon`, `outline`; pill: `live`                                                                                                                                                                                                                                                                        | статусы, метки                                                               |
| `Drawer`                                                                                                  | `open`, `onClose`, `title`, `subtitle`, `footer`, `size: sm\|md\|lg\|xl`, `initialFocusRef`                                                                                                                                                                                                                                   | детали/форма, не уводящие со списка                                          |
| `DropdownMenu`                                                                                            | `trigger`, `items[{key,label,icon,onSelect,to,danger,disabled,shortcut} \| separator \| label]`, `align`, `width`                                                                                                                                                                                                             | «⋯» в строке, меню профиля                                                   |
| `Tooltip`                                                                                                 | `content`, `side`, `delay`, `disabled`                                                                                                                                                                                                                                                                                        | подсказка к icon-only и свёрнутой навигации                                  |
| `Skeleton`, `SkeletonText`, `SkeletonCard`                                                                | `variant: rect\|text\|circle`                                                                                                                                                                                                                                                                                                 | загрузка в форме будущего контента                                           |
| `Money`                                                                                                   | `value`, `signed`, `colorize`, `muted`                                                                                                                                                                                                                                                                                        | любые деньги                                                                 |
| `cn`, `tokens`                                                                                            |                                                                                                                                                                                                                                                                                                                               | склейка классов; карты тонов и фокус-кольца                                  |

Существующие компоненты в `components/` перестилизованы **с сохранением API** и
реэкспортированы из `ui/index.ts`: `PageHeader` (+ новые `backTo`, `meta`), `Modal`
(+ `description`, `footer`, `role="dialog"`, возврат фокуса), `ConfirmDialog` (+ `loading`,
русский `confirmText` по умолчанию), `EmptyState` (+ `compact`), `QueryState`, `InlineLoader`,
`Switch` (+ `size`), `Pagination`, `SearchInput` (+ кнопка очистки, `aria-label`, `size`),
`DatePeriodPicker` (пилюли 32 px, подписи полей), `PageTransition`, `LoadingSpinner` (скелет
новой оболочки — только как route-fallback).

Общие CSS-классы (`.btn-*`, `.input`, `.label`, `.card`, `.badge-*`, `.table`, `.stat-*`,
`.page-title`) переведены на токены, поэтому немигрированные страницы уже выглядят
согласованно. Новинки: `.table .num` (число справа + `tabular-nums`), `.table-dense`,
`.focus-ring`.

## 5. Как мигрировать страницу (фаза B)

### 5.1 Шаблон структуры

```tsx
import { PageHeader, Toolbar, SearchInput, DatePeriodPicker, Select, Button, DataTable, Money, Badge } from '../ui';

export default function ClientsPage() {
  const [params, setParams] = useSearchParams();               // состояние — в URL
  const page = Number(params.get('page') ?? 1);
  const q = params.get('q') ?? '';
  const { data, isLoading, isError, refetch, isFetching } = useQuery({ ... });  // запрос и ключ НЕ меняем

  return (
    <div className="space-y-5">
      <PageHeader title="Клиенты" icon={Users} subtitle={`${data?.total ?? 0} в базе`}
        actions={<Button icon={Plus} onClick={openCreate}>Новый клиент</Button>} />

      <Toolbar end={<Button variant="secondary" icon={Download}>Экспорт</Button>}>
        <SearchInput value={q} onChange={(v) => setParams({ q: v, page: '1' })} placeholder="Имя или телефон…" className="w-72" />
        <Select aria-label="Мастер" options={masters} value={...} onChange={...} className="w-48" />
        <DatePeriodPicker dateFrom={from} dateTo={to} onChange={...} />
      </Toolbar>

      <DataTable
        rows={data?.items ?? []}
        rowKey={(c) => c.id}
        rowHref={(c) => `/clients/${c.id}`}
        isLoading={isLoading} isError={isError} onRetry={refetch} isFetching={isFetching}
        emptyState={{ icon: Users, title: 'Клиентов пока нет', action: { label: 'Добавить клиента', onClick: openCreate } }}
        columns={[
          { key: 'name', header: 'Клиент', primary: true, render: (c) => c.name },
          { key: 'phone', header: 'Телефон', hideBelow: 'md' },
          { key: 'visits', header: 'Визитов', numeric: true, sortable: true },
          { key: 'debt', header: 'Долг', numeric: true, render: (c) => <Money value={c.debt} colorize /> , footer: (rows) => <Money value={sum(rows)} /> },
          { key: 'status', header: 'Статус', render: (c) => <Badge tone="ok" dot>Активен</Badge> },
          { key: 'actions', header: '', interactive: true, width: 48, render: (c) => <IconButton label="Редактировать" icon={Pencil} size="sm" onClick={() => edit(c)} /> },
        ]}
      />
      <Pagination page={page} total={data?.total ?? 0} limit={20} onChange={(p) => setParams({ q, page: String(p) })} />
    </div>
  );
}
```

Порядок блоков всегда один: **PageHeader → Toolbar (или FilterBar) → KPI (если есть) →
контент (DataTable / Card-сетка / форма) → Pagination**. Заголовок H1 совпадает с пунктом
меню («Журнал», а не «Чеки»). Детали строки — `Drawer` или страница `/…/:id`, не модалка на
весь экран.

### 5.2 Замены классов

| Было                                                         | Стало                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `bg-gray-50` (фон страницы/панелей)                          | `bg-canvas` / `bg-surface-2`                                                                      |
| `bg-white rounded-2xl border border-gray-100 shadow-sm p-5`  | `<Card padding="md">` или `.card card-body`                                                       |
| `border-gray-100/200`                                        | `border-line`; рамки контролов — `border-line-strong`                                             |
| `text-gray-900` / `700` / `600` / `500`                      | `text-ink` / `text-ink-2` / `text-ink-2` / `text-ink-3`                                           |
| `text-gray-400` на тексте                                    | `text-ink-3`; на декоративной иконке — `text-ink-4`                                               |
| `text-gray-300`                                              | удалить (нечитаемо) → `text-ink-3` или `text-ink-4` для иконок                                    |
| `text-[9px]`, `text-[10px]`                                  | `text-2xs` (11 px); при нехватке места — сократить текст, а не кегль                              |
| `text-xl font-bold` / `text-2xl font-bold` у H1              | `PageHeader`                                                                                      |
| `text-lg font-semibold` у заголовка карточки                 | `CardHeader title` (15/600)                                                                       |
| `bg-primary-50 text-primary-600` чип                         | `toneChip.accent` / `bg-accent-soft text-accent`                                                  |
| `bg-green-50 text-green-700` и т. п.                         | `Badge tone="ok"` / `toneSoft.ok`; blue→`accent`, yellow/amber→`warn`, red/rose→`bad`, sky→`info` |
| `bg-gradient-to-*` карточки                                  | обычный `Card`; смысл переносим в `CardHeader iconTone` или `Badge`                               |
| ручной `flex items-center gap-2 …` с фильтрами               | `Toolbar` / `FilterBar`                                                                           |
| `rounded-xl border border-gray-300 px-4 py-2.5 …` у input    | `<Input>` / `.input`                                                                              |
| `<label className="text-xs text-gray-600">` без `htmlFor`    | `<Field label htmlFor>`                                                                           |
| `<select className="input">` без имени                       | `<Select aria-label="…">`                                                                         |
| `type="number"` для денег                                    | `<Input inputMode="decimal">`                                                                     |
| `<button className="p-1.5 text-gray-400"><Trash2/></button>` | `<IconButton label="Удалить" icon={Trash2} variant="danger" size="sm" />`                         |
| `<tr onClick>` / `<div role="button">`                       | `DataTable rowHref` или `<Link>`                                                                  |
| `<div onClick={() => navigate(…)}>`                          | `<Link>` (Cmd+клик, средняя кнопка)                                                               |
| `window.confirm(...)`                                        | `ConfirmDialog` (`variant="danger"` для удаления)                                                 |
| `<LoadingSpinner/>` внутри страницы                          | `Skeleton*` / `InlineLoader` / `DataTable isLoading`                                              |
| `{ data, isLoading } = useQuery`                             | `{ data, isLoading, isError, refetch, isFetching }` → `QueryState`/`DataTable`                    |
| локальный `formatMoney`/`formatCurrency`                     | `Money` или `shared/utils/formatters.formatMoney`                                                 |
| `toFixed(1) + '%'`                                           | `Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })`                                        |
| `transition-all`                                             | `transition-colors` / `transition-[background-color,border-color]`                                |
| `hover:shadow-md hover:-translate-y-0.5`                     | `Card interactive`                                                                                |
| `md:max-h-[calc(100vh-12rem)]` у таблицы                     | `DataTable maxHeight="calc(100dvh - 17rem)"` или без ограничения (скроллит `<main>`)              |
| `'...'`                                                      | `'…'`                                                                                             |

### 5.3 Правила, которые нельзя нарушать при миграции

- **Не менять** запросы, ключи react-query, маршруты, `lazyWithRetry`, `src/api/**`,
  `shared/**`. Новые фичи — только по спекам `docs/specs/2026-09-25-*.md`.
- **Не ломать мобильный веб**: 375 px — страница открывается, скроллится, тулбар переносится,
  таблица прячет второстепенные колонки (`hideBelow`), а не превращается в горизонтальный
  скролл на пять экранов. Мобильные карточки-дубли можно удалять только если `DataTable` с
  `hideBelow` читается на 375 px.
- Один `primary` на экран. Деструктив — `danger` + `ConfirmDialog`.
- Каждый запрос — с `isError` и «Повторить». Формы настроек не рендерят пустые значения при
  ошибке загрузки (`QueryState` прячет форму).
- Числовые колонки — `numeric: true` (справа, табличные цифры); есть сумма — есть `footer`.
- Иконки-кнопки — `IconButton` с `label`. Пары «label + input» — `Field htmlFor`.
- Состояние списка — в URL. Возврат из карточки возвращает на ту же страницу/фильтр.
- Ничего мельче `text-2xs`, ничего светлее `text-ink-3` на тексте.

### 5.4 Чек-лист приёмки страницы

- [ ] `cd frontend && npm run typecheck && npm run lint && npm run build` — зелёные.
- [ ] Структура: `PageHeader` (H1 = пункт меню) → `Toolbar` → контент; ширину задаёт оболочка.
- [ ] Один primary; все icon-only — `IconButton`; фокус виден при Tab по всей странице.
- [ ] Каждый запрос: loading (скелет), error (+Повторить — проверить, отключив backend), empty.
- [ ] Таблица: sticky-шапка, числа справа, `tabular-nums`, итог, сортировка там, где есть смысл;
      строка открывается кликом и Enter с клавиатуры.
- [ ] Фильтры/период/страница/вкладка — в URL; F5 сохраняет состояние.
- [ ] Нет `text-gray-400` на тексте, нет `text-[9/10px]`, нет градиентов, нет `transition-all`,
      нет `window.confirm`, нет `type="number"` для денег.
- [ ] 375 px: открывается и скроллится, ничего не вылезает по горизонтали.
- [ ] Скриншоты Playwright 1440×900 до/после в `docs/web-redesign/screenshots/`
      (`before-<page>-1440.png` / `after-<page>-1440.png`); сценарий-заготовка —
      см. раздел 6.
- [ ] Консоль браузера без ошибок на золотом пути.

## 6. Локальный стек и скриншоты

```bash
docker start autexa-pg                          # база (1 тенант, демо-директор +79000000000 / AutexaDemo2026)
cd backend && PORT=3005 npm run start:dev        # :3000 может быть занят чужим проектом
cd frontend && npm run dev                       # vite :5173 (proxy /api → :3000; при другом порте backend —
                                                 #   запускайте vite с оверрайдом proxy, vite.config.ts не трогаем)
```

Скриншоты — Python Playwright (`python3 -m venv .venv && .venv/bin/pip install playwright`;
Chromium уже лежит в `~/Library/Caches/ms-playwright`). Готовый сценарий фазы A —
`docs/web-redesign/tools/shots.py`: логин демо-директором (при мультифилиальном тенанте
выбирает «Профи — Центр»), обходит страницы из списка `PAGES`, снимает 1440×900 и 375×812
(`device_scale_factor=2`) и печатает ошибки консоли/сети.

```bash
.venv/bin/python docs/web-redesign/tools/shots.py after            # все страницы списка
.venv/bin/python docs/web-redesign/tools/shots.py after clients    # только одна
SHOT_OUT=/tmp/wip .venv/bin/python docs/web-redesign/tools/shots.py wip   # в другую папку
```

Добавляя свою страницу в `PAGES`, сохраняйте имена файлов `before-<page>-1440.png` /
`after-<page>-1440.png` — «до» снимайте ДО правок.

## 7. Итог фазы B (2026-09-25, сведение)

**Что мигрировано.** Все страницы админки за логином переведены на систему из разделов 2–5:
оболочка и `ui/**` (фаза A), G1 Касса · Журнал · деталка чека · Доска работ · Кассовая смена ·
Розница, G2 Клиенты · карточка клиента · Автомобили · Импорт · Звонки · Маркетинг · Рассрочка ·
Планирование, G3 Склад · Услуги · Поставщики · Заказы поставщикам · Имущество, G4 Зарплата ·
Расходы · Движение денег · раздел «Отчёты» (хаб + 11 отчётов + финансовый), G5 Расписание ·
Сотрудники · Пользователи · Филиалы · Настройки · Интеграции · Уведомления · Тариф · Ещё,
G6 Вход · База знаний · панель superadmin. Компоненты VIN сведены в один модуль
`components/vin/` (`VinInput`, `VinText`/`VinLine`/`CopyVinButton`, `vinUi`). Интеграционный
обход Playwright (все пункты меню, все вкладки, детальные страницы, отчёты, `/admin/*`; 1440×900
и 375×812; `tools/` в scratchpad сведения) — без `pageerror`, без неожиданных HTTP-ошибок
(ожидаемые: 400 `/api/calls` без телефонии, 404 `/api/subscription` у superadmin), без
горизонтального переполнения документа, без крошки «Детали» и пустых страниц; золотой путь
(вход → Касса → Журнал → деталка → Клиенты + авто с VIN → Склад → Поставщики → Отчёты + Excel →
Настройки → выход) проходит одним сценарием. Старые классы (`text-gray-*`, градиенты,
`rounded-2xl`, `transition-all`, `window.confirm`, `type="number"`) в страницах и компонентах
админки не остались; исключение — публичные страницы вне оболочки (`PrivacyPage`, `TermsPage`,
`ReviewPublicPage`, `RegisterPage`), они живут в стиле лендинга.

**Что исправлено при сведении** (интеграционные дефекты, которых группы по одной не видели):
замки в боковой панели считались по имени тарифа в `sub.plans` и у демо-тарифа блокировали все
пункты — теперь по `sub.features`, как в `FeatureGate`; `PageHeader` на телефоне растягивает
колонку (`items-stretch`) и переносит длинные заголовок/подзаголовок вместо обрезки, а
центрированные корни `mx-auto max-w-3xl` (Заказы поставщикам, Ещё, Маркетинг) получили `w-full`
— страница «Новый заказ поставщику» больше не вылезает за 375 px; `SegmentedControl` на узких
экранах прокручивается внутри себя (кольцо фокуса — inset), из-за него на 375 px уезжал график
«Тренды» маркетинга; подпись шапки `DataTable` наследует `white-space` от `<th>`, поэтому
`tableWidths.numericHeaderClass` переносит многословные заголовки на вторую строку и держит
минимум по самому длинному слову (без «Себ…», отчёты и Движение денег уже на 150–200 px);
`Input` не перемонтирует `<input>`, если переключаемый `rightSlot` передан как `null`/`false`
(правило — в комментарии `ui/Input.tsx`); `FeatureGate`, `ErrorBoundary`, `PointIndicator` —
на токенах и `Button`. Отчёты: сущностный фильтр скрыт, когда справочник вернул ≤ 1 опции
(вместе с чипами и подписями в экспорте, `ids` из ссылки не применяются); сбой справочника
показывает ошибку с «Повторить», а не «все». Деталка чека берёт VIN из `check.car.vin`, когда
backend его отдаёт, и запрашивает карточку авто только для старого ответа без поля.

**Известные ограничения.** `useBlocker` недоступен (приложение на `BrowserRouter`, не на
data-router): Касса защищает несохранённый чек через `pushState`-ловушку + `beforeunload` +
`ConfirmDialog`, но переход по пункту меню или ссылке уходит без подтверждения. `Toolbar end` на
375 px переносится строкой под фильтры (кнопка занимает всю строку). Перемонтирование `Input`
остаётся, если вызывающий код переключает `rightSlot` между `undefined` и узлом. Широкие таблицы
— «По мастерам» (13 колонок, ≈1785 px), «По зарплатам» (≈1625 px), «Движение денег» (≈1445 px) —
на 1440 px с развёрнутой панелью прокручиваются по горизонтали внутри карточки (первая колонка
закреплена, шапка не режется); целиком помещаются от ≈1680 px или со свёрнутой панелью. На
375 px таблицы отчётов, зарплаты, расходов и услуг прокручиваются внутри карточки — `hideBelow`
применён только к основным спискам. Кольцо фокуса у сегментов `SegmentedControl` — внутреннее.

## 8. Известные ограничения фазы A

- Немигрированные страницы получили новые базовые классы (`.btn`, `.input`, `.table`, `.card`),
  но внутри остались ручные градиенты, `text-gray-400` и собственные ограничения высоты —
  это ожидаемо до фазы B (список поломок внутри новой оболочки — `AUDIT.md`, раздел 3);
  закрыто в фазе B (см. раздел 7 и `AUDIT.md`, раздел 5).
- `DataTable` не виртуализирует: для > 200 строк — пагинация или существующий `VirtualList`.
- `Tooltip`/`DropdownMenu` позиционируются от `getBoundingClientRect` в обработчике и
  закрываются при прокрутке (без «follow»).
- Мобильные нижние табы и «Ещё» намеренно не перестраивались — только токены.
- Счётчики в боковой панели (слот в `NavItem` не заведён): в кодовой базе нет готовых
  дешёвых источников (нужны новые запросы), поэтому в фазе A не добавлялись.
