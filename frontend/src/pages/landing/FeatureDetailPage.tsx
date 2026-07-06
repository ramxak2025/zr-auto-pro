import { useEffect, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, ChevronRight, LayoutGrid, MessageCircle, Send, X } from 'lucide-react';
import { ctaSection, features, type FeatureSection, type RoleBenefits } from './content';
import { getTelegramUrl, getWhatsAppUrl, WHATSAPP_ACCESS_MESSAGE } from './config';
import Reveal from './sections/Reveal';
import Footer from './sections/Footer';
import GlassTabBar from './sections/GlassTabBar';
import OptionalImage from './OptionalImage';
import { DEFAULT_TINT, SECTION_ICONS, SECTION_TINTS } from './icons';

/**
 * Страница углублённого изучения раздела: /f/:slug.
 * ОДИН шаблон для всех 16 разделов; весь контент — из content.ts (features).
 * Светлая тема — как и главная: раздел читается как статья.
 * Публичная: доступна и гостям, и залогиненным (изучение без редиректа).
 */

const ROLE_LABELS: { key: keyof RoleBenefits; label: string }[] = [
  { key: 'owner', label: 'Владельцу' },
  { key: 'admin', label: 'Администратору' },
  { key: 'master', label: 'Мастеру' },
];

/** Хлебные крошки: Autexa → Возможности → <раздел>. Текущий пункт truncate на мобилке. */
function Breadcrumbs({ title }: { title: string }) {
  const crumbLink =
    'inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900';
  return (
    <nav aria-label="Хлебные крошки" className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
      <Link to="/" className={`${crumbLink} -ml-2`}>
        <img
          src="/logo-icon.png"
          alt=""
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
          className="h-5 w-5 rounded"
        />
        Autexa
      </Link>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <Link to="/#features" className={crumbLink}>
        Возможности
      </Link>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <span className="min-w-0 truncate px-2 text-sm font-semibold text-slate-900" aria-current="page">
        {title}
      </span>
    </nav>
  );
}

/** CTA-кнопки WhatsApp/Telegram из config.ts; контактов нет → «Войти». */
function CtaButtons() {
  const whatsapp = getWhatsAppUrl(WHATSAPP_ACCESS_MESSAGE);
  const telegram = getTelegramUrl();
  const base =
    'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-6 text-base font-semibold transition motion-safe:active:scale-[0.98]';

  if (!whatsapp && !telegram) {
    return (
      <Link
        to="/login"
        className={`${base} bg-primary-600 text-white shadow-lg shadow-primary-600/25 hover:bg-primary-500`}
      >
        Войти
        <ArrowRight className="h-5 w-5" />
      </Link>
    );
  }

  return (
    <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row">
      {whatsapp && (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500`}
        >
          <MessageCircle className="h-5 w-5" />
          {ctaSection.whatsappLabel}
        </a>
      )}
      {telegram && (
        <a
          href={telegram}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} border border-slate-300 bg-white text-slate-900 hover:border-primary-400 hover:text-primary-600`}
        >
          <Send className="h-5 w-5 text-sky-500" />
          {ctaSection.telegramLabel}
        </a>
      )}
    </div>
  );
}

/** «Смотрите также» — карточка соседнего раздела. */
function RelatedCard({ section }: { section: FeatureSection }) {
  const Icon = SECTION_ICONS[section.icon] ?? LayoutGrid;
  const tint = SECTION_TINTS[section.slug] ?? DEFAULT_TINT;
  return (
    <Link
      to={`/f/${section.slug}`}
      className="group flex min-h-[44px] items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all motion-safe:hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md motion-safe:active:scale-[0.98]"
    >
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint.chip}`}>
        <Icon className={`h-5 w-5 ${tint.icon}`} />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-slate-900 group-hover:text-primary-600">{section.title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-slate-600">{section.tagline}</span>
      </span>
    </Link>
  );
}

export default function FeatureDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const section = features.find((f) => f.slug === slug);

  // Заголовок вкладки: «<Раздел> — Autexa», с восстановлением при уходе
  useEffect(() => {
    if (!section) return;
    const prevTitle = document.title;
    document.title = `${section.title} — Autexa`;
    return () => {
      document.title = prevTitle;
    };
  }, [section]);

  // Светлый фон на body (чтобы overscroll не мигал другим цветом) + светлый
  // theme-color хрома браузера на время страницы; при уходе оба восстанавливаются —
  // залогиненное приложение остаётся с базовым #2563eb из index.html.
  useEffect(() => {
    const prevBodyBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#FAFAFA';
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') ?? null;
    themeMeta?.setAttribute('content', '#FAFAFA');
    return () => {
      document.body.style.backgroundColor = prevBodyBg;
      if (themeMeta && prevTheme !== null) themeMeta.setAttribute('content', prevTheme);
    };
  }, []);

  // Скролл к верху: на первом маунте — мгновенно (страница открывается с начала,
  // а не «проматывается» через всю статью со старого offset'а), при смене slug
  // («Смотрите также» ведёт на тот же роут) — плавно, если движение не ограничено.
  const isFirstScroll = useRef(true);
  useEffect(() => {
    if (!section) return;
    if (isFirstScroll.current) {
      isFirstScroll.current = false;
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [slug, section]);

  if (!section) {
    return <Navigate to="/" replace />;
  }

  const { detail } = section;
  const SectionIcon = SECTION_ICONS[section.icon] ?? LayoutGrid;
  const tint = SECTION_TINTS[section.slug] ?? DEFAULT_TINT;
  const roleCards = ROLE_LABELS.filter(({ key }) => detail.roleBenefits[key]);
  const idx = features.indexOf(section);
  const related = [1, 2, 3].map((offset) => features[(idx + offset) % features.length]);

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-28 font-display text-slate-900 antialiased md:pb-0">
      {/* Хлебные крошки */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Breadcrumbs title={section.title} />
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Hero раздела: текст + опциональная иллюстрация — появится, когда
            владелец положит /img/landing/f-<slug>.webp; до этого слот пуст
            (OptionalImage прячется по onError, сетка остаётся одноколоночной) */}
        <section className="py-12 sm:py-16">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
            <Reveal className="max-w-3xl">
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${tint.chip}`}>
                <SectionIcon className={`h-6 w-6 ${tint.icon}`} />
              </span>
              <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
                {detail.heroTitle}
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-slate-600">{detail.heroSubtitle}</p>
            </Reveal>
            <OptionalImage
              src={`/img/landing/f-${section.slug}.webp`}
              alt={`${section.title} в Autexa`}
              width={800}
              height={600}
              className="w-full rounded-3xl border border-slate-200/60 object-cover shadow-sm"
            />
          </div>

          {/* «Знакомо?» — боли без продукта */}
          <Reveal delay={0.08}>
            <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Знакомо?</h2>
              <ul className="mt-4 space-y-3">
                {detail.pains.map((pain) => (
                  <li key={pain} className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-50">
                      <X className="h-3.5 w-3.5 text-rose-500" />
                    </span>
                    <span className="leading-relaxed text-slate-600">{pain}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* Возможности */}
        <section className="pb-12 sm:pb-16">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
              Как это работает в Autexa
            </h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {detail.capabilities.map((cap, i) => (
              <Reveal key={cap.title} delay={Math.min(i * 0.04, 0.24)}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 transition-colors hover:border-primary-300">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50">
                    <Check className="h-5 w-5 text-emerald-600" />
                  </span>
                  <h3 className="mt-3 font-semibold text-slate-900">{cap.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{cap.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Кому это */}
        <section className="pb-12 sm:pb-16">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">Кому это</h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {roleCards.map(({ key, label }, i) => (
              <Reveal key={key} delay={Math.min(i * 0.06, 0.18)}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-6">
                  <p className="text-sm font-semibold text-primary-600">{label}</p>
                  <p className="mt-2 leading-relaxed text-slate-600">{detail.roleBenefits[key]}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Мини-FAQ */}
        <section className="pb-12 sm:pb-16">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
              Частые вопросы
            </h2>
          </Reveal>
          <div className="mt-8 space-y-3">
            {detail.faq.map((item, i) => (
              <Reveal key={item.q} delay={Math.min(i * 0.05, 0.15)}>
                {/* acc-details — плавное раскрытие (interpolate-size, см. index.css) */}
                <details className="acc-details group rounded-2xl border border-slate-200 bg-white transition-colors hover:border-slate-300">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{item.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="pb-12 sm:pb-16">
          <Reveal>
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center sm:p-12">
              <p className="mx-auto max-w-2xl text-lg leading-relaxed text-slate-900">{detail.ctaText}</p>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500">{ctaSection.riskReversal}</p>
              <div className="mt-6 flex justify-center">
                <CtaButtons />
              </div>
            </div>
          </Reveal>
        </section>

        {/* Смотрите также */}
        <section className="pb-16 sm:pb-20">
          <Reveal>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl text-balance">
              Смотрите также
            </h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {related.map((rel, i) => (
              <Reveal key={rel.slug} delay={Math.min(i * 0.06, 0.18)}>
                <RelatedCard section={rel} />
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      <Footer />
      {/* Общий liquid-glass бар сайта — режим «/f/:slug» (навигация на главную);
          pb-28 md:pb-0 на корне даёт футеру место под баром */}
      <GlassTabBar />
    </div>
  );
}
