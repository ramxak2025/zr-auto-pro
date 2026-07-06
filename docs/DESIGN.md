# DESIGN.md — визуальная система лендинга Autexa

## Theme

Светлая (решение владельца). Фон #FAFAFA, поверхности белые, текст slate-900/600/500. Тёмные варианты не используются.

## Color

- Primary: tailwind primary (синий, 50–950; 600 = #2563eb — бренд, совпадает с логотипом).
- Emerald: деньги/WhatsApp-CTA (бренд-паттерн «зелёный = WhatsApp», осознанное отступление от AA на кнопках — задокументировано в Hero.tsx).
- Sky: Telegram. Тинты разделов: SECTION_TINTS в icons.ts — 8 семейств (sky, rose, indigo, amber, emerald, orange, teal, slate), контраст иконки на чипе ≥3:1, violet исключён.
- Логотип: синий градиент облако «AX» + тёмно-синий wordmark (#19253E); wordmark на тёмном фоне нечитаем.

## Typography

Onest (variable 400–800, self-hosted public/fonts, unicode-range; анти-CLS фоллбек 'Onest Fallback' с size-adjust). Заголовки extrabold 800 tracking-tight; body 400–500. Утилита font-display только на корнях лендинг-страниц — приложение шрифт не грузит.

## Components / patterns

- Карточки: rounded-2xl/3xl, border-slate-200/60, shadow-sm → hover:shadow-md (hover под @media(hover:hover) — hoverOnlyWhenSupported). Радиусы 16–24px — осознанный бренд-выбор (мягкость), не менять по чужим чек-листам.
- Bento (desktop md+): 12-колоночная сетка, спаны просчитаны без дыр; mobile — карусели CSS scroll-snap (peek следующей карточки) + сетка-чипы.
- GlassTabBar (mobile): стеклянная пилюля Главная·Разделы·Тарифы·Вопросы, active по pathname; шторка SectionsSheet (все 16 разделов + WhatsApp снизу).
- Инженерная сетка в hero — «чертёжная» бренд-метафора автосервиса (легитимное исключение для blueprint-паттерна) + лёгкий SVG-noise.
- Reveal: framer-motion whileInView once, margin '-60px 0px'; reduced-motion полностью отключает; stagger карточек 40 мс.
- Изображения: сгенерированные владельцем фото (светлые, синие/изумрудные акценты, без лиц и женщин), пайплайн кроп 4:3 → cwebp -q 82; OptionalImage (failed/loaded по src) для необязательных слотов.

## Spacing / layout

max-w-6xl контейнеры, секции py-12..28, тап-таргеты ≥44px, safe-area через env() (viewport-fit=cover), pb-28 на мобиле под glass-бар.

## Voice

Русский, «ё» везде, прямые продающие заголовки, CTA-мостики в конце блоков.
