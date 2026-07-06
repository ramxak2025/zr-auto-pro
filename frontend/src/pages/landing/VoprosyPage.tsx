import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigationType } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LayoutGrid,
  MessageCircle,
  Search,
  Send,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Reveal from './sections/Reveal';
import Footer from './sections/Footer';
import GlassTabBar from './sections/GlassTabBar';
import { linkifyContacts } from './sections/linkify';
import { faqMain, features, pricingFaq, type FaqItem } from './content';
import { getTelegramUrl, getWhatsAppUrl } from './config';
import { DEFAULT_TINT, groupBySections, SECTION_ICONS, SECTION_TINTS, type SectionTint } from './icons';

/**
 * Страница /voprosy — ВСЕ вопросы и ответы лендинга в одном месте.
 * Публичная, по образцу /tarify (доступна и гостям, и залогиненным).
 *
 * v9 — компактный ХАБ вместо простыни из ~50 вопросов (длинный скролл
 * отвергнут владельцем): без поискового запроса — сетка категорий-карточек
 * (Общие, Цены + 16 разделов с их тинт-иконками из SECTION_TINTS, на карточке
 * название и число вопросов), тап по категории раскрывает её вопросы
 * аккордеоном ПРЯМО ПОД сеткой (выбранная карточка подсвечена, к списку
 * доводит авто-скролл). Дефолт — раскрыта «Общие». Выбран вариант «сетка
 * остаётся + список под ней», а не «заменить сетку списком с кнопкой назад»:
 * без второго уровня навигации категория переключается одним тапом из любого
 * места, контент не подменяется рывком — только плавный скролл.
 * Sticky-строка чипов удалена: карточки-категории её заменяют, а двойная
 * механика навигации (чипы + карточки) только путала бы.
 * v10 — сетка категорий сгруппирована по направлениям (SECTION_GROUPS в
 * icons.ts — тот же источник, что у шторки «Разделы» и «Все возможности»):
 * сверху сквозные «Общие» и «Цены», ниже — группы с компактными заголовками.
 *
 * Данные собираются из content.ts без дублирования текстов:
 *  - faqMain            → категория «Общие»;
 *  - pricingFaq         → категория «Цены и подключение»;
 *  - features[].detail.faq → категория = title раздела, рядом со списком —
 *    ссылка «Подробнее о разделе →» на /f/<slug>.
 *
 * Сохранено из прежней версии: клиентский поиск по вопросу+ответу
 * (при непустом запросе хаб уступает место плоскому списку найденного),
 * счётчик, empty-state с WhatsApp, linkify ответов, CTA «Не нашли ответ»,
 * document.title / theme-color / скролл-паттерны, снап к началу списка.
 */

interface QaGroup {
  key: string;
  /** Название категории над списком вопросов (полное). */
  title: string;
  /** Короткое имя для узкой 2-колоночной карточки (текст ~89–97px, clamp-2). */
  shortTitle?: string;
  icon: LucideIcon;
  tint: SectionTint;
  /** slug раздела /f/<slug> — даёт ссылку «Подробнее о разделе →». */
  slug?: string;
  items: FaqItem[];
}

const GROUPS: QaGroup[] = [
  { key: 'general', title: 'Общие', icon: HelpCircle, tint: DEFAULT_TINT, items: faqMain },
  {
    key: 'pricing',
    title: 'Цены и подключение',
    icon: Wallet,
    // Emerald — «деньги» по визуальной системе лендинга (DESIGN.md)
    tint: { chip: 'bg-emerald-100', icon: 'text-emerald-600' },
    items: pricingFaq,
  },
  ...features.map((f) => ({
    key: f.slug,
    title: f.title,
    shortTitle: f.shortTitle,
    icon: SECTION_ICONS[f.icon] ?? LayoutGrid,
    tint: SECTION_TINTS[f.slug] ?? DEFAULT_TINT,
    slug: f.slug,
    items: f.detail.faq,
  })),
];

const TOTAL_COUNT = GROUPS.reduce((n, g) => n + g.items.length, 0);

/** Сквозные категории без раздела (Общие, Цены) — верхний ряд хаба без заголовка. */
const META_GROUPS = GROUPS.filter((g) => g.slug === undefined);

/** Категории-разделы по направлениям — единый источник SECTION_GROUPS (icons.ts). */
const SECTION_CATEGORY_GROUPS = groupBySections(
  GROUPS.filter((g): g is QaGroup & { slug: string } => g.slug !== undefined),
);

/** «1 вопрос / 2 вопроса / 5 вопросов» — русские плюралы для карточек. */
function questionsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вопрос`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} вопроса`;
  return `${n} вопросов`;
}

/** Мини-шапка страницы: только лого (→ главная) и «Войти» — как на /tarify. */
function MiniHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex min-h-[44px] items-center">
          <img
            src="/logo.png"
            alt="Autexa"
            width={116}
            height={28}
            loading="eager"
            decoding="async"
            className="h-7 w-auto"
          />
        </Link>
        <Link
          to="/login"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
        >
          Войти
        </Link>
      </div>
    </header>
  );
}

/** Хлебные крошки: Autexa → Вопросы. */
function Breadcrumbs() {
  return (
    <nav aria-label="Хлебные крошки" className="flex items-center whitespace-nowrap">
      <Link
        to="/"
        className="-ml-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
      >
        Autexa
      </Link>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <span className="px-2 text-sm font-semibold text-slate-900" aria-current="page">
        Вопросы
      </span>
    </nav>
  );
}

/** Один вопрос-аккордеон — тот же стиль, что FAQ главной; acc-details — плавное раскрытие. */
function QaItem({ item }: { item: FaqItem }) {
  return (
    <details className="acc-details group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        {item.q}
        <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{linkifyContacts(item.a)}</p>
    </details>
  );
}

/** Карточка категории хаба: тинт-иконка, название, число вопросов, active-подсветка. */
function CategoryCard({ group, active, onPick }: { group: QaGroup; active: boolean; onPick: () => void }) {
  const Icon = group.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={`flex min-h-[64px] items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left shadow-sm transition motion-safe:active:scale-[0.98] ${
        active
          ? 'border-primary-400 bg-primary-50/70 ring-1 ring-primary-400/40'
          : 'border-slate-200/60 bg-white hover:border-slate-300'
      }`}
    >
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${group.tint.chip}`}>
        <Icon className={`h-[18px] w-[18px] ${group.tint.icon}`} />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-slate-800">
          {group.shortTitle ?? group.title}
        </span>
        <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
          {questionsLabel(group.items.length)}
        </span>
      </span>
    </button>
  );
}

/** Заголовок группы вопросов + опциональная ссылка на страницу раздела. */
function GroupHeading({ group }: { group: QaGroup }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4">
      <h2 className="text-xl font-bold tracking-tight text-slate-900">{group.title}</h2>
      {group.slug && (
        <Link
          to={`/f/${group.slug}`}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
        >
          Подробнее о разделе
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

export default function VoprosyPage() {
  const navigationType = useNavigationType();
  const [query, setQuery] = useState('');
  /** Выбранная категория хаба; дефолт — «Общие». */
  const [activeKey, setActiveKey] = useState('general');
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Невидимый якорь над зоной результатов (снап при старте поиска глубоко в списке). */
  const listAnchorRef = useRef<HTMLDivElement>(null);
  /** Заголовок раскрытой категории — цель авто-скролла после тапа по карточке. */
  const qaTopRef = useRef<HTMLElement>(null);

  const whatsapp = getWhatsAppUrl();
  const telegram = getTelegramUrl();

  // Заголовок вкладки с восстановлением при уходе
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Вопросы и ответы — Autexa';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  // Светлая тема страницы: фон body (overscroll не мигает), светлый theme-color
  // хрома браузера, плавный скролл — с восстановлением.
  useEffect(() => {
    const root = document.documentElement;
    const prevScroll = root.style.scrollBehavior;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.style.scrollBehavior = 'smooth';
    }
    const prevBodyBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#FAFAFA';
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') ?? null;
    themeMeta?.setAttribute('content', '#FAFAFA');
    return () => {
      root.style.scrollBehavior = prevScroll;
      document.body.style.backgroundColor = prevBodyBg;
      if (themeMeta && prevTheme !== null) themeMeta.setAttribute('content', prevTheme);
    };
  }, []);

  // Scroll-to-top на маунте: SPA-переход не скроллит сам; POP (кнопка «назад»)
  // не трогаем — браузер сам восстанавливает позицию. Паттерн /tarify.
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
    // Только на маунте — как в LandingPage/TarifyPage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Поиск — по всем категориям сразу (хаб на время запроса уступает место
  // плоскому списку найденного, сгруппированному подзаголовками).
  const foundGroups = useMemo(() => {
    if (!searching) return [];
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) => `${it.q} ${it.a}`.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [q, searching]);

  const foundCount = useMemo(() => foundGroups.reduce((n, g) => n + g.items.length, 0), [foundGroups]);

  const activeGroup = GROUPS.find((g) => g.key === activeKey) ?? GROUPS[0];

  // При старте поиска глубоко на странице документ может резко укоротиться —
  // браузер зажмёт scrollY у нового низа, и пользователь окажется на CTA-карточке.
  // Возвращаем viewport к началу зоны результатов под шапку. Скроллим синхронно,
  // до ре-рендера: якорь статичен, его позиция валидна всегда.
  const snapToListTop = () => {
    const el = listAnchorRef.current;
    // 64px = высота MiniHeader (h-16); якорь выше — значит зона уже под шапкой.
    if (el && el.getBoundingClientRect().top < 64) {
      el.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  };

  // Тап по карточке категории: выбрать + довести вопросы под шапку.
  // Сетка выше списка, и выбор в верхнем ряду без скролла «ничего не менял бы»
  // на экране. Позиция заголовка списка не зависит от нового содержимого
  // (сетка над ним статична) — скроллим сразу, плавно (reduced-motion — мгновенно).
  const pickCategory = (key: string) => {
    setActiveKey(key);
    qaTopRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <div
      id="top"
      className="min-h-screen bg-[#FAFAFA] pb-28 font-display text-slate-900 antialiased selection:bg-primary-500/20 md:pb-0"
    >
      <MiniHeader />

      <main className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="pt-4">
          <Breadcrumbs />
        </div>

        {/* Hero-строка: pt-4/6 — единый ритм публичных страниц (контент сразу под шапкой) */}
        <Reveal className="pt-4 sm:pt-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Вопросы и ответы
          </h1>
          <p className="mt-3 text-lg text-slate-600">Всё, что спрашивают владельцы автосервисов</p>
        </Reveal>

        {/* Поиск: text-base = 16px — iOS не автозумит инпут при фокусе */}
        <Reveal delay={0.05}>
          <div className="relative mt-6">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => {
                // Старт поиска глубоко в списке — «зажатый» скролл: возвращаем к началу.
                if (!query.trim() && e.target.value.trim()) snapToListTop();
                setQuery(e.target.value);
              }}
              placeholder="Поиск по вопросам…"
              aria-label="Поиск по вопросам и ответам"
              className={`min-h-[52px] w-full rounded-2xl border border-slate-200 bg-white pl-12 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${
                query ? 'pr-12' : 'pr-4'
              }`}
            />
            {/* Tailwind preflight глушит нативный крестик type=search (-webkit-appearance) —
                рисуем свой: 44px hit-area, очистка + возврат фокуса в инпут */}
            {query.length > 0 && (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 active:text-slate-700"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>
          {searching && (
            <p className="mt-2 text-sm text-slate-500" aria-live="polite">
              Найдено: {foundCount} из {TOTAL_COUNT}
            </p>
          )}
        </Reveal>

        {/* Якорь для snapToListTop: scroll-mt-16 ставит его ровно под MiniHeader */}
        <div ref={listAnchorRef} aria-hidden className="scroll-mt-16" />

        {searching ? (
          /* Режим поиска: плоский список найденного, сгруппированный подзаголовками */
          <>
            {foundGroups.map((g) => (
              <section key={g.key} className="pt-10">
                <GroupHeading group={g} />
                <div className="mt-4 space-y-3">
                  {g.items.map((item) => (
                    <QaItem key={item.q} item={item} />
                  ))}
                </div>
              </section>
            ))}

            {/* Ничего не нашлось — сразу мостик в WhatsApp */}
            {foundCount === 0 && (
              <div className="mt-10 rounded-3xl border border-slate-200/60 bg-white px-6 py-10 text-center shadow-sm">
                <p className="text-lg font-semibold text-slate-900">Ничего не нашлось</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
                  Спросите нас напрямую — отвечаем за пару минут.
                </p>
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-8 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 motion-safe:active:scale-[0.98] active:bg-emerald-600"
                  >
                    <MessageCircle className="h-5 w-5" aria-hidden />
                    Написать в WhatsApp
                  </a>
                )}
              </div>
            )}
          </>
        ) : (
          /* Хаб: сетка категорий-карточек + вопросы выбранной категории под ней */
          <>
            <div role="group" aria-label="Категории вопросов" className="mt-6">
              {/* Сквозные категории (Общие, Цены) — верхний ряд без заголовка */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {META_GROUPS.map((g) => (
                  <CategoryCard key={g.key} group={g} active={g.key === activeKey} onPick={() => pickCategory(g.key)} />
                ))}
              </div>
              {/* Разделы по направлениям — те же группы SECTION_GROUPS, что в шторке
                  «Разделы» и «Все возможности» на главной */}
              {SECTION_CATEGORY_GROUPS.map((sg) => (
                <div key={sg.title} className="mt-4">
                  {/* slate-500: 12px uppercase = «обычный» текст по WCAG, нужен AA 4.5:1 (slate-400 давал ~2.6:1) */}
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{sg.title}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {sg.items.map((g) => (
                      <CategoryCard
                        key={g.key}
                        group={g}
                        active={g.key === activeKey}
                        onPick={() => pickCategory(g.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Вопросы выбранной категории — аккордеон прямо под сеткой;
                scroll-mt-20 = sticky MiniHeader (64px) + воздух */}
            <section ref={qaTopRef} className="scroll-mt-20 pt-10" aria-live="polite">
              <GroupHeading group={activeGroup} />
              <div className="mt-4 space-y-3">
                {activeGroup.items.map((item) => (
                  <QaItem key={item.q} item={item} />
                ))}
              </div>
            </section>
          </>
        )}

        {/* CTA-карточка внизу */}
        <Reveal className="pt-14 sm:pt-20">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white px-6 py-12 text-center shadow-sm">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -top-20 left-1/2 h-48 w-[420px] -translate-x-1/2 rounded-full bg-primary-200/50 blur-[90px]" />
              <div className="absolute -bottom-20 right-0 h-40 w-[300px] rounded-full bg-emerald-200/40 blur-[90px]" />
            </div>
            <div className="relative">
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
                Не нашли ответ?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-base text-slate-600">
                Напишем за пару минут — живой человек, без «менеджер перезвонит».
              </p>
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-8 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 motion-safe:active:scale-[0.98] active:bg-emerald-600 sm:w-auto"
                  >
                    <MessageCircle className="h-5 w-5" aria-hidden />
                    Написать в WhatsApp
                  </a>
                )}
                {telegram && (
                  <a
                    href={telegram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-8 text-base font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400 motion-safe:active:scale-[0.98] active:bg-sky-600 sm:w-auto"
                  >
                    <Send className="h-5 w-5" aria-hidden />
                    Написать в Telegram
                  </a>
                )}
              </div>
            </div>
          </div>
        </Reveal>

        <div className="pb-16" />
      </main>

      <Footer />
      {/* Общий glass-бар сайта; pb-28 md:pb-0 на корне даёт футеру место под баром */}
      <GlassTabBar />
    </div>
  );
}
