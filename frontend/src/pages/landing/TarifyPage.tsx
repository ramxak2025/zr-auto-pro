import { useEffect } from 'react';
import { Link, useNavigationType } from 'react-router-dom';
import { Building2, ChevronDown, ChevronRight } from 'lucide-react';
import { GsapReveal, useReveal } from './gsap';
import CtaSection from './sections/CtaSection';
import Footer from './sections/Footer';
import GlassTabBar from './sections/GlassTabBar';
import { ComparisonTable, ComparisonTableMobile, ImplementationCard, PlanCard } from './sections/pricingShared';
import { b2bNotice, pricing, pricingFaq, tarifyHero } from './content';

/**
 * Отдельная страница тарифов /tarify. Публичная — доступна и гостям,
 * и залогиненным (по образцу /f/:slug, без редиректа).
 *
 * Тарифы описаны ВОЗМОЖНОСТЯМИ, без цен: стоимость подбирается индивидуально
 * под размер команды при подключении. Единственный CTA карточек — «Оставить
 * заявку». Структура: мини-Header (лого + Войти) → крошки «Autexa → Тарифы» →
 * hero-строка → карточки планов (мобиле — вертикальная стопка, «Легенда»
 * первой с бейджем; desktop — 3 колонки) → «Внедрение под ключ» →
 * полное сравнение (desktop-таблица / mobile-details из pricingShared) →
 * mini-FAQ → CTA WhatsApp/Telegram → Footer + GlassTabBar.
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
  // Карточки планов въезжают каскадом снизу (как ценовые блоки на главной).
  // Стаггер по прямым детям сетки — обёрткам планов; их внутренний md:-translate-y-2
  // (подъём «Легенды») живёт на самой карточке и не задевается transform reveal'а.
  const plansRef = useReveal<HTMLDivElement>({ type: 'stagger', start: 'top 85%', stagger: 0.09 });

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
        <GsapReveal type="stagger" className="max-w-3xl pt-4 sm:pt-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            {tarifyHero.title}
          </h1>
          <p className="mt-3 text-lg text-slate-600">{tarifyHero.subtitle}</p>
        </GsapReveal>

        {/* Плашка B2B-позиционирования: доступ — для организаций */}
        <GsapReveal type="rise" delay={0.05}>
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
              <Building2 className="h-5 w-5 text-primary-600" aria-hidden />
            </span>
            <p className="text-sm leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-900">Для организаций — юрлиц и ИП.</span> {b2bNotice} Оставьте
              заявку — менеджер подберёт тариф под вашу команду и подключит организацию.
            </p>
          </div>
        </GsapReveal>

        {/* Карточки планов: мобиле — стопка («Легенда» первой), desktop — 3 колонки;
            ref = стаггер-контейнер (каждая обёртка плана оседает по очереди) */}
        <div ref={plansRef} className="mt-8 flex flex-col gap-4 pt-3 md:grid md:grid-cols-3">
          {pricing.plans.map((plan) => (
            <div key={plan.key} className={plan.highlighted ? 'order-first md:order-none' : ''}>
              <PlanCard plan={plan} />
            </div>
          ))}
        </div>

        {/* Внедрение под ключ */}
        <GsapReveal type="rise" delay={0.1} className="mt-10">
          <ImplementationCard />
        </GsapReveal>

        {/* Полное сравнение: desktop-таблица / mobile — свайп-таблица.
            fade (без transform): не двигаем крупную листаемую таблицу на входе */}
        <GsapReveal type="fade" delay={0.1} className="hidden md:block">
          <h2 className="mt-16 text-center text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
            {pricing.comparisonTitle}
          </h2>
          <ComparisonTable />
        </GsapReveal>
        <GsapReveal type="fade" delay={0.1} className="md:hidden">
          <h2 className="mt-14 text-xl font-extrabold tracking-tight text-slate-900 text-balance">
            {pricing.comparisonTitle}
          </h2>
          <ComparisonTableMobile />
        </GsapReveal>

        {/* Mini-FAQ */}
        <section className="pt-14 sm:pt-20">
          <GsapReveal type="rise">
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
              Частые вопросы
            </h2>
          </GsapReveal>
          <div className="mt-6 space-y-3">
            {pricingFaq.map((item, i) => (
              <GsapReveal type="rise" key={item.q} delay={Math.min(i * 0.05, 0.15)}>
                {/* acc-details — плавное раскрытие (interpolate-size, см. index.css) */}
                <details className="acc-details group rounded-2xl border border-slate-200/60 bg-white shadow-sm transition-colors hover:border-slate-300">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.a}</p>
                </details>
              </GsapReveal>
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
