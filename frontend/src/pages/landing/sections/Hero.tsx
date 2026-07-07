import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { ArrowRight, Banknote, CheckCircle2, TrendingUp, Gauge, Sparkles } from 'lucide-react';
import CtaButton from './CtaButton';
import { hero, heroLightReady } from '../content';
import { getAccessContactUrl, getWhatsAppUrl } from '../config';

/* ---------- Атмосфера: сетка + шум (только CSS/data-uri, ноль запросов) ---------- */

/** Тонкая «чертёжная» сетка 48px, линии slate-200/40, radial-маска к краям. */
const GRID_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(to right, rgb(226 232 240 / 0.4) 1px, transparent 1px), ' +
    'linear-gradient(to bottom, rgb(226 232 240 / 0.4) 1px, transparent 1px)',
  backgroundSize: '48px 48px',
  maskImage: 'radial-gradient(ellipse 90% 80% at 50% 35%, black 35%, transparent 78%)',
  WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 50% 35%, black 35%, transparent 78%)',
};

/** Очень лёгкий SVG-noise (feTurbulence) поверх mesh — глубина без веса. */
const NOISE_STYLE: CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")`,
};

/* ---------- Оркестровка входа: badge → title → subtitle → bullets → CTA → мокап ---------- */

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

/** CSS-мокап телефона с мини-дашбордом — без единой картинки, светлый UI. */
function PhoneMock() {
  return (
    <div className="relative mx-auto w-[240px] md:w-[280px]">
      {/* Плавающий чип поверх телефона */}
      <div className="absolute -left-6 top-24 z-10 hidden items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/95 px-3.5 py-2.5 shadow-xl shadow-slate-900/10 backdrop-blur sm:flex">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <div className="text-left">
          <p className="text-xs font-semibold text-slate-900">Чек №214 оплачен</p>
          <p className="text-[11px] text-slate-400">Карта · 5 450 ₽</p>
        </div>
      </div>

      <div className="rounded-[2.75rem] border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/10">
        <div className="overflow-hidden rounded-[2.25rem] border border-slate-100 bg-[#F6F8FB] px-4 pb-7 pt-3">
          {/* Dynamic Island */}
          <div className="mx-auto mb-5 h-6 w-24 rounded-full bg-slate-900" />

          <p className="text-xs text-slate-400">Сегодня</p>
          <p className="mt-0.5 text-3xl font-bold tracking-tight text-slate-900">48 250 ₽</p>

          {/* Карточка «Касса сегодня» */}
          <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                <Banknote className="h-4 w-4 text-emerald-600" />
              </span>
              <p className="text-xs font-medium text-slate-600">Касса сегодня</p>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Наличные</span>
                <span className="font-semibold text-slate-900">21 800 ₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Карта</span>
                <span className="font-semibold text-slate-900">26 450 ₽</span>
              </div>
            </div>
          </div>

          {/* Карточка «Оборот» с мини-графиком */}
          <div className="mt-3 hidden rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm md:block">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50">
                <TrendingUp className="h-4 w-4 text-primary-600" />
              </span>
              <p className="text-xs font-medium text-slate-600">Оборот за неделю</p>
            </div>
            <div className="mt-3 flex h-14 items-end gap-1.5" aria-hidden>
              {[38, 52, 30, 64, 46, 78, 58].map((h, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-t-md ${i === 5 ? 'bg-primary-500' : 'bg-primary-200'}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Заголовок из content: акцент градиентом. Если в середине есть '. ' —
 * акцентируется последнее предложение; для короткого заголовка без него
 * («Программа для автосервиса.») — последнее слово.
 */
function splitTitle(title: string): { head: string; tail: string } {
  const idx = title.lastIndexOf('. ');
  if (idx !== -1) return { head: title.slice(0, idx + 1), tail: title.slice(idx + 2) };
  const space = title.lastIndexOf(' ');
  if (space === -1) return { head: title, tail: '' };
  return { head: title.slice(0, space), tail: title.slice(space + 1) };
}

/**
 * Бейдж hero. Вариант-якорь «Старт бесплатно · от 1 000 ₽/мес» ОТВЕРГНУТ
 * владельцем (07.07) — нейтральная пилюля с мини-логотипом, без ссылки и пульса.
 */
function AnchorBadge() {
  return (
    <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200/80 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
      <Gauge className="h-4 w-4 text-primary-600" aria-hidden />
      {hero.badge}
    </span>
  );
}

/* ---------- Мобильный светлый hero (< md) ---------- */

/**
 * Гейт по вьюпорту, а не по CSS: MobileHero скрыт на md+ через `md:hidden`,
 * но браузеры качают <img> и внутри display:none — без этого гейта каждый
 * desktop-визит тянул бы мобильное фото мастерской. matchMedia-порог 767px =
 * tailwind `md` (768px). useSyncExternalStore реагирует и на ресайз через
 * breakpoint.
 */
const MOBILE_QUERY = '(max-width: 767px)';
const subscribeMobile = (cb: () => void) => {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
};
const getIsMobile = () => window.matchMedia(MOBILE_QUERY).matches;

type HeroPhotoStatus = 'loading' | 'loaded' | 'failed';

const HERO_LIGHT_SRC = '/img/landing/hero-light.webp';

/**
 * Фото-карточка мобильного hero (под CTA): hero-light.webp в скруглённой
 * карточке + плавающий продуктовый чип «Касса сегодня» — сообщение и кнопки
 * остаются в первом экране (решение владельца 07.07: фото сверху съедало
 * весь фолд, CTA были невидимы). Фолбэк при ошибке — workshop.webp, затем null.
 * matchMedia-гейт: desktop (md:hidden) фото не качает.
 */
function MobileHeroPhotoCard({
  status,
  onStatus,
}: {
  status: HeroPhotoStatus;
  onStatus: (s: HeroPhotoStatus) => void;
}) {
  const isMobile = useSyncExternalStore(subscribeMobile, getIsMobile);
  if (!isMobile) return null;
  const src = status === 'failed' ? '/img/landing/workshop.webp' : HERO_LIGHT_SRC;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 shadow-lg shadow-slate-900/10">
      <img
        src={src}
        alt="Светлый зал премиального автосервиса — кроссовер на подъёмнике"
        width={1536}
        height={1024}
        loading="eager"
        decoding="async"
        onLoad={() => status !== 'loaded' && onStatus('loaded')}
        onError={() => onStatus('failed')}
        className={`h-auto w-full object-cover transition-[transform,opacity] duration-[600ms] ease-out motion-reduce:transition-none ${
          status === 'loaded' ? 'scale-100 opacity-100' : 'scale-[1.04] opacity-0'
        }`}
      />
      {/* Продуктовый чип поверх фото — эхо приложения, живость без веса */}
      {status === 'loaded' && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/95 px-3 py-2 shadow-lg shadow-slate-900/10 backdrop-blur">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
          <div className="text-left">
            <p className="text-[11px] font-semibold leading-tight text-slate-900">Касса сегодня</p>
            <p className="text-[11px] leading-tight text-slate-500">48 250 ₽ · всё сходится</p>
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * ОСОЗНАННОЕ РЕШЕНИЕ по контрасту: белый текст на emerald-500 ≈ 2.3:1 —
 * формально ниже WCAG AA (4.5:1 для 14–16px). Это бренд-паттерн
 * «зелёный = WhatsApp» по всему лендингу (здесь, SectionsSheet, ImplementationCard
 * в pricingShared) — кнопка распознаётся формой/иконкой и конвертирует лучше
 * тёмной. Реальный AA дал бы только emerald-700 или тёмный текст на emerald-400;
 * решено оставить как есть. Если владелец захочет строгий AA — менять все три места.
 */
const EMERALD_CTA =
  'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-8 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 motion-safe:active:scale-[0.98] active:bg-emerald-600';

/** Primary-CTA мобильного hero: emerald «Получить доступ» → WhatsApp; контактов нет → «Войти». */
function MobileAccessCta() {
  const url = getWhatsAppUrl() ?? getAccessContactUrl();
  if (!url) {
    return (
      <Link to="/login" className={EMERALD_CTA}>
        Войти
        <ArrowRight className="h-5 w-5" aria-hidden />
      </Link>
    );
  }
  return (
    <a
      href={url}
      target={url.startsWith('http') ? '_blank' : undefined}
      rel="noopener noreferrer"
      className={EMERALD_CTA}
    >
      Получить доступ
      <ArrowRight className="h-5 w-5" aria-hidden />
    </a>
  );
}

/**
 * < md: светлый hero в палитре главной. Сверху вниз: светлое hero-light-фото
 * (~44svh, fade в фон; монтируется только при heroLightReady) →
 * бейдж-якорь «Старт бесплатно · от 1 000 ₽/мес» (→ /tarify) → H1 →
 * подзаголовок → CTA → workshop-карточка (только пока нет hero-light-фото).
 * Атмосфера mesh-блобов/сетки — как на desktop. Шапка с wordmark-логотипом
 * и «Войти» видна и на мобиле (Header.tsx).
 */
function MobileHero() {
  const { head, tail } = splitTitle(hero.title);
  const reduceMotion = useReducedMotion();
  // Флаг выключен → сразу 'failed': ветки рендера идентичны состоянию
  // «фото не загрузилось» (workshop-карточка на месте, блока фото нет).
  const [photoStatus, setPhotoStatus] = useState<HeroPhotoStatus>(heroLightReady ? 'loading' : 'failed');

  return (
    <section className="relative overflow-hidden md:hidden">
      {/* Атмосфера: mesh-блобы → инженерная сетка → лёгкий noise */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[360px] w-[560px] -translate-x-1/2 rounded-full bg-primary-300/30 blur-[110px]" />
        <div className="absolute -left-28 top-64 h-[260px] w-[260px] rounded-full bg-sky-300/30 blur-[100px]" />
        <div className="absolute -right-24 top-96 h-[240px] w-[240px] rounded-full bg-amber-200/40 blur-[100px]" />
        <div className="absolute inset-0" style={GRID_STYLE} />
        <div className="absolute inset-0 opacity-[0.025]" style={NOISE_STYLE} />
      </div>

      {/* Оркестрованный вход: бейдж-якорь → заголовок → подзаголовок → CTA → фото */}
      <motion.div
        className="relative px-5 pb-12 pt-8"
        variants={container}
        initial={reduceMotion ? false : 'hidden'}
        animate="visible"
      >
        <motion.div variants={item}>
          <AnchorBadge />
        </motion.div>

        <motion.h1
          variants={item}
          className="mt-5 text-[clamp(34px,9vw,42px)] font-extrabold leading-[1.08] tracking-tight text-slate-900"
        >
          {head}
          {tail && (
            <>
              <br />
              <span className="text-primary-600">{tail}</span>
            </>
          )}
        </motion.h1>

        <motion.p variants={item} className="mt-4 max-w-md text-[17px] leading-relaxed text-slate-600">
          {hero.subtitle}
        </motion.p>

        <motion.div variants={item} className="mt-7 flex flex-col gap-3">
          <MobileAccessCta />
          <a
            href="#features"
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 motion-safe:active:scale-[0.98]"
          >
            Смотреть возможности
          </a>
        </motion.div>

        <motion.p variants={item} className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
          <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden />
          14 дней бесплатно · все возможности
        </motion.p>

        <motion.div variants={item} className="mt-8">
          <MobileHeroPhotoCard status={photoStatus} onStatus={setPhotoStatus} />
        </motion.div>
      </motion.div>
    </section>
  );
}

/* ---------- Desktop / tablet hero (md+): светлый, как раньше ---------- */

function DesktopHero() {
  const { head, tail } = splitTitle(hero.title);
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative hidden overflow-hidden md:block">
      {/* Атмосфера: mesh-блобы (бренд-синий + sky + тёплый amber, без violet)
          → «чертёжная» сетка → лёгкий noise. Всё pointer-events-none. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary-300/30 blur-[130px]" />
        <div className="absolute -left-40 top-48 h-[360px] w-[360px] rounded-full bg-sky-300/30 blur-[110px]" />
        <div className="absolute -right-32 top-72 h-[320px] w-[320px] rounded-full bg-amber-200/40 blur-[110px]" />
        <div className="absolute inset-0" style={GRID_STYLE} />
        <div className="absolute inset-0 opacity-[0.025]" style={NOISE_STYLE} />
      </div>

      {/* Оркестрованный вход: badge → заголовок → подзаголовок → буллеты → CTA →
          мокап, стаггер 70 мс; reduced-motion — контент сразу на месте. */}
      <motion.div
        className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-16 sm:px-6 sm:pt-24 md:gap-14 md:pb-20 lg:grid-cols-[1.15fr_0.85fr] lg:pb-28"
        variants={container}
        initial={reduceMotion ? false : 'hidden'}
        animate="visible"
      >
        <div className="text-center lg:text-left">
          <motion.div variants={item}>
            <AnchorBadge />
          </motion.div>

          <motion.h1
            variants={item}
            className="mt-6 text-[clamp(40px,7vw,72px)] font-extrabold leading-[1.04] tracking-tight text-slate-900 text-balance"
          >
            {head}
            {tail && (
              <>
                <br />
                <span className="text-primary-600">{tail}</span>
              </>
            )}
          </motion.h1>

          <motion.p variants={item} className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-600 lg:mx-0">
            {hero.subtitle}
          </motion.p>

          <motion.ul variants={item} className="mx-auto mt-6 max-w-xl space-y-2.5 text-left lg:mx-0">
            {hero.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-slate-700">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                {b}
              </li>
            ))}
          </motion.ul>

          <motion.div
            variants={item}
            className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
          >
            <CtaButton className="w-full sm:w-auto" />
            <a
              href="#features"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 motion-safe:active:scale-[0.98] sm:w-auto"
            >
              Смотреть возможности
            </a>
          </motion.div>

          <motion.p
            variants={item}
            className="mt-4 flex items-center justify-center gap-1.5 text-sm text-slate-500 lg:justify-start"
          >
            <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden />
            14 дней бесплатно · все возможности
          </motion.p>
        </div>

        <motion.div variants={item}>
          <PhoneMock />
        </motion.div>
      </motion.div>
    </section>
  );
}

export default function Hero() {
  return (
    <>
      <MobileHero />
      <DesktopHero />
    </>
  );
}
