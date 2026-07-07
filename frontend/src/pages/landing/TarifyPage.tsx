import { useEffect, useState } from 'react';
import { Link, useNavigationType } from 'react-router-dom';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import Reveal from './sections/Reveal';
import CtaSection from './sections/CtaSection';
import Footer from './sections/Footer';
import GlassTabBar from './sections/GlassTabBar';
import {
  type Billing,
  ComparisonTable,
  ComparisonTableMobile,
  ImplementationCard,
  PlanCard,
} from './sections/pricingShared';
import { pricing, pricingFaq, tarifyHero } from './content';

/** Сегмент-контрол «Помесячно | На год −20%» с перетекающим ползунком. */
function BillingToggle({ value, onChange }: { value: Billing; onChange: (b: Billing) => void }) {
  const reduce = useReducedMotion();
  const options: { key: Billing; label: string; badge?: string }[] = [
    { key: 'monthly', label: 'Помесячно' },
    { key: 'yearly', label: 'На год', badge: '−20%' },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className="relative inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold"
          >
            {active && (
              <motion.span
                layoutId="billing-pill"
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 34 }}
                className="absolute inset-0 rounded-full bg-primary-600"
              />
            )}
            <span className={`relative z-10 ${active ? 'text-white' : 'text-slate-600'}`}>{o.label}</span>
            {o.badge && (
              <span
                className={`relative z-10 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  active ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'
                }`}
              >
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Отдельная страница тарифов /tarify. Публичная — доступна и гостям,
 * и залогиненным (по образцу /f/:slug, без редиректа).
 *
 * Структура: мини-Header (лого + Войти) → крошки «Autexa → Тарифы» →
 * hero-строка → карточки планов (мобиле — вертикальная стопка, «Легенда»
 * первой с бейджем; desktop — 3 колонки) → «Внедрение под ключ» →
 * полное сравнение (desktop-таблица / mobile-details из pricingShared) →
 * mini-FAQ о ценах → CTA WhatsApp/Telegram → Footer + GlassTabBar.
 */

/** Мини-шапка страницы: только лого (→ главная) и «Войти». */
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

/** Хлебные крошки: Autexa → Тарифы. */
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
        Тарифы
      </span>
    </nav>
  );
}

export default function TarifyPage() {
  const navigationType = useNavigationType();
  // По умолчанию «На год» — якорим выгодную цену (честно помечено −20%).
  const [billing, setBilling] = useState<Billing>('yearly');

  // Заголовок вкладки с восстановлением при уходе
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Тарифы — Autexa';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  // Светлая тема страницы: фон body (overscroll не мигает), светлый theme-color
  // хрома браузера, плавный скролл для «Тарифы»-таба (#top) — с восстановлением.
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

  // Scroll-to-top на маунте: SPA-переход (кнопка бара / шапки) не скроллит сам.
  // POP (кнопка «назад» браузера) не трогаем — браузер сам восстанавливает
  // позицию (пользователь листал таблицу сравнения, ушёл в /login, вернулся) —
  // тот же паттерн, что в LandingPage.
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
    // Только на маунте — как в LandingPage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      id="top"
      className="min-h-screen bg-[#FAFAFA] pb-28 font-display text-slate-900 antialiased selection:bg-primary-500/20 md:pb-0"
    >
      <MiniHeader />

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pt-4">
          <Breadcrumbs />
        </div>

        {/* Hero-строка: pt-4/6 — единый ритм публичных страниц (контент сразу под шапкой) */}
        <Reveal className="max-w-3xl pt-4 sm:pt-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            {tarifyHero.title}
          </h1>
          <p className="mt-3 text-lg text-slate-600">{tarifyHero.subtitle}</p>
        </Reveal>

        {/* Плашка «14 дней бесплатно» */}
        <Reveal delay={0.05}>
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200/70 bg-emerald-50 p-4">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <Sparkles className="h-5 w-5 text-emerald-600" aria-hidden />
            </span>
            <p className="text-sm leading-relaxed text-emerald-900">
              <span className="font-semibold">Первые 14 дней — бесплатно.</span> Полный доступ ко всем возможностям —
              решите на своих цифрах, а не на обещаниях.
            </p>
          </div>
        </Reveal>

        {/* Переключатель периода оплаты */}
        <Reveal delay={0.08}>
          <div className="mt-8 flex justify-center">
            <BillingToggle value={billing} onChange={setBilling} />
          </div>
        </Reveal>

        {/* Карточки планов: мобиле — стопка («Легенда» первой), desktop — 3 колонки */}
        <Reveal delay={0.1}>
          <div className="mt-6 flex flex-col gap-4 pt-3 md:grid md:grid-cols-3">
            {pricing.plans.map((plan) => (
              <div key={plan.key} className={plan.highlighted ? 'order-first md:order-none' : ''}>
                <PlanCard plan={plan} billing={billing} />
              </div>
            ))}
          </div>
        </Reveal>

        {/* Внедрение под ключ */}
        <Reveal delay={0.1}>
          <div className="mt-10">
            <ImplementationCard />
          </div>
        </Reveal>

        {/* Полное сравнение: desktop-таблица / mobile — свайп-таблица */}
        <Reveal delay={0.1} className="hidden md:block">
          <h2 className="mt-16 text-center text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
            {pricing.comparisonTitle}
          </h2>
          <ComparisonTable />
        </Reveal>
        <Reveal delay={0.1} className="md:hidden">
          <h2 className="mt-14 text-xl font-extrabold tracking-tight text-slate-900 text-balance">
            {pricing.comparisonTitle}
          </h2>
          <ComparisonTableMobile />
        </Reveal>

        {/* Mini-FAQ о ценах */}
        <section className="pt-14 sm:pt-20">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
              Вопросы о цене
            </h2>
          </Reveal>
          <div className="mt-6 space-y-3">
            {pricingFaq.map((item, i) => (
              <Reveal key={item.q} delay={Math.min(i * 0.05, 0.15)}>
                {/* acc-details — плавное раскрытие (interpolate-size, см. index.css) */}
                <details className="acc-details group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      {/* CTA WhatsApp/Telegram — та же секция, что на главной */}
      <CtaSection />

      <Footer />
      {/* Общий glass-бар сайта; pb-28 md:pb-0 на корне даёт футеру место под баром */}
      <GlassTabBar />
    </div>
  );
}
