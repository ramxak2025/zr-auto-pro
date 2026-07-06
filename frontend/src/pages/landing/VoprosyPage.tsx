import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigationType } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, MessageCircle, Search, Send, X } from 'lucide-react';
import Reveal from './sections/Reveal';
import Footer from './sections/Footer';
import GlassTabBar from './sections/GlassTabBar';
import { linkifyContacts } from './sections/linkify';
import { faqMain, features, pricingFaq, type FaqItem } from './content';
import { getTelegramUrl, getWhatsAppUrl } from './config';

/**
 * Страница /voprosy — ВСЕ вопросы и ответы лендинга в одном месте.
 * Публичная, по образцу /tarify (доступна и гостям, и залогиненным).
 *
 * Данные собираются из content.ts без дублирования текстов:
 *  - faqMain            → категория «Общие»;
 *  - pricingFaq         → категория «Цены и подключение»;
 *  - features[].detail.faq → категория = title раздела, рядом с группой —
 *    ссылка «Подробнее о разделе →» на /f/<slug>.
 *
 * UX: MiniHeader → крошки → h1 + подзаголовок → поиск (клиентская фильтрация
 * по вопросу+ответу, счётчик, empty-state с WhatsApp) → категории-чипы
 * в горизонтальной скролл-строке (sticky под шапкой) → аккордеоны details,
 * сгруппированные подзаголовками → CTA-карточка WhatsApp/Telegram →
 * Footer + GlassTabBar. При активном поиске чипы игнорируются (ищем везде);
 * тап по чипу во время поиска очищает запрос и открывает категорию.
 */

interface QaGroup {
  key: string;
  /** Заголовок группы в списке. */
  title: string;
  /** Короткая подпись чипа (по умолчанию = title). */
  chipLabel?: string;
  /** slug раздела /f/<slug> — даёт ссылку «Подробнее о разделе →». */
  slug?: string;
  items: FaqItem[];
}

const GROUPS: QaGroup[] = [
  { key: 'general', title: 'Общие', items: faqMain },
  { key: 'pricing', title: 'Цены и подключение', chipLabel: 'Цены', items: pricingFaq },
  ...features.map((f) => ({ key: f.slug, title: f.title, slug: f.slug, items: f.detail.faq })),
];

const TOTAL_COUNT = GROUPS.reduce((n, g) => n + g.items.length, 0);

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

function chipCls(active: boolean) {
  return `inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition motion-safe:active:scale-95 ${
    active
      ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
  }`;
}

/** Один вопрос-аккордеон — тот же стиль, что FAQ главной. */
function QaItem({ item }: { item: FaqItem }) {
  return (
    <details className="group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        {item.q}
        <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{linkifyContacts(item.a)}</p>
    </details>
  );
}

export default function VoprosyPage() {
  const navigationType = useNavigationType();
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState('all');
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Невидимый якорь прямо над sticky-строкой чипов (сам sticky для offsetTop ненадёжен). */
  const listAnchorRef = useRef<HTMLDivElement>(null);

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
  // хрома браузера, плавный скролл для «Вопросы»-таба (#top) — с восстановлением.
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

  // Клиентская фильтрация: при поиске — по всем категориям (чипы игнорируются),
  // без поиска — активная категория или все.
  const visibleGroups = useMemo(() => {
    if (searching) {
      return GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((it) => `${it.q} ${it.a}`.toLowerCase().includes(q)),
      })).filter((g) => g.items.length > 0);
    }
    if (activeKey === 'all') return GROUPS;
    return GROUPS.filter((g) => g.key === activeKey);
  }, [q, searching, activeKey]);

  const foundCount = useMemo(() => visibleGroups.reduce((n, g) => n + g.items.length, 0), [visibleGroups]);

  // После смены фильтра глубоко в списке документ может резко укоротиться —
  // браузер зажмёт scrollY у нового низа, и пользователь окажется на CTA-карточке
  // («тап не сработал»). Возвращаем viewport к началу списка под sticky-чипы.
  // Скроллим синхронно, до ре-рендера: якорь статичен, его позиция валидна всегда.
  const snapToListTop = () => {
    const el = listAnchorRef.current;
    // 64px = высота MiniHeader (h-16); якорь выше — значит чипы уже «прилипли».
    if (el && el.getBoundingClientRect().top < 64) {
      el.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  };

  // Тап по чипу во время поиска — очистить запрос и показать категорию:
  // «мёртвые» чипы под активным поиском только путали бы.
  const pickChip = (key: string) => {
    snapToListTop();
    setActiveKey(key);
    if (searching) setQuery('');
  };

  return (
    <div
      id="top"
      className="min-h-screen bg-[#FAFAFA] pb-28 font-display text-slate-900 antialiased selection:bg-primary-500/20 md:pb-0"
    >
      <MiniHeader />

      <main className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="pt-3">
          <Breadcrumbs />
        </div>

        {/* Hero-строка */}
        <Reveal className="pt-6 sm:pt-10">
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
                // Старт поиска глубоко в списке — тот же эффект «зажатого» скролла,
                // что у чипов: возвращаем к началу списка.
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

        {/* Якорь для snapToListTop: scroll-mt-16 ставит его ровно под MiniHeader,
            чипы прилипают сразу под ним */}
        <div ref={listAnchorRef} aria-hidden className="scroll-mt-16" />

        {/* Категории-чипы: горизонтальный скролл, sticky под шапкой (h-16).
            Это фильтры-переключатели, не табы: role=group + aria-pressed —
            честная семантика без обещаний tabpanel/стрелочной навигации */}
        <div className="sticky top-16 z-30 -mx-4 mt-4 border-b border-slate-200/60 bg-[#FAFAFA]/90 backdrop-blur-xl sm:-mx-6">
          <div
            role="group"
            aria-label="Категории вопросов"
            className="flex gap-2 overflow-x-auto px-4 py-3 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <button
              type="button"
              aria-pressed={!searching && activeKey === 'all'}
              onClick={() => pickChip('all')}
              className={chipCls(!searching && activeKey === 'all')}
            >
              Все
            </button>
            {GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={!searching && activeKey === g.key}
                onClick={() => pickChip(g.key)}
                className={chipCls(!searching && activeKey === g.key)}
              >
                {g.chipLabel ?? g.title}
              </button>
            ))}
          </div>
        </div>

        {/* Список: группы с подзаголовками; у разделов — ссылка на /f/<slug> */}
        {visibleGroups.map((g) => (
          <section key={g.key} className="pt-10">
            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">{g.title}</h2>
              {g.slug && (
                <Link
                  to={`/f/${g.slug}`}
                  className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
                >
                  Подробнее о разделе
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              )}
            </div>
            <div className="mt-4 space-y-3">
              {g.items.map((item) => (
                <QaItem key={item.q} item={item} />
              ))}
            </div>
          </section>
        ))}

        {/* Ничего не нашлось — сразу мостик в WhatsApp */}
        {searching && foundCount === 0 && (
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
