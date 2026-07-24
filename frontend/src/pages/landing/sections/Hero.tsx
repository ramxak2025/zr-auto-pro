import { useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, Building2, CheckCircle2, TrendingUp, Gauge } from 'lucide-react';
import CtaButton from './CtaButton';
import { gsap, useGSAP, SplitText, useCountUp, useParallax, EASE } from '../gsap';
import { b2bNotice, hero, heroLightReady } from '../content';

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

/* ---------- GSAP-оркестровка входа hero (флагманский «вау») ----------

   Контракт видимости (критично): весь контент виден по CSS-дефолту. from-состояния
   ставит ТОЛЬКО GSAP-таймлайн и ТОЛЬКО в ветке matchMedia
   '(prefers-reduced-motion: no-preference)' + подходящая ширина. Поэтому при
   reduced-motion, без JS, в headless или на «не той» ширине (desktop-hero скрыт
   на мобиле и наоборот) — hero НЕ слепнет, элементы просто показаны сразу.
   Любой сбой ловится try/catch и форсит видимый вид (revert split + clearProps).

   Hero — первый экран, поэтому вход играет по маунту (обычный timeline), а не по
   ScrollTrigger. useGSAP держит всё в gsap.context и киллит при уходе со страницы
   (SPA-роутинг). matchMedia-ветки ревертятся при смене условий/размонтировании. */

type HeroVariant = 'mobile' | 'desktop';

const HERO_ANIM_SELECTOR =
  '[data-hero-badge],[data-hero-title],[data-hero-subtitle],[data-hero-bullet],[data-hero-cta],[data-hero-notice],[data-hero-mock]';

/**
 * Строит и запускает вступительный таймлайн hero. Возвращает cleanup, который
 * реверсирует SplitText и убивает бесконечный idle-float (важно для чистого
 * размонтирования). Все from-состояния применяются здесь — до первого paint
 * (useGSAP работает в layout-effect), поэтому вспышки видимого→скрытого нет.
 */
function buildHeroIntro(root: HTMLElement, variant: HeroVariant): () => void {
  const q = gsap.utils.selector(root);
  const splits: SplitText[] = [];
  const disposers: Array<() => void> = [];

  try {
    const tl = gsap.timeline({ defaults: { ease: EASE.out } });

    const badge = q('[data-hero-badge]');
    if (badge.length) tl.from(badge, { y: 16, autoAlpha: 0, duration: 0.5 }, 0.05);

    // Заголовок: SplitText по строкам с маской + слова выезжают снизу из-под
    // клип-маски строки (power4.out) — премиальный «набор» текста.
    const title = root.querySelector<HTMLElement>('[data-hero-title]');
    if (title) {
      const split = new SplitText(title, { type: 'lines,words', mask: 'lines' });
      splits.push(split);
      tl.from(split.words, { yPercent: 120, autoAlpha: 0, duration: 0.9, ease: EASE.outStrong, stagger: 0.055 }, 0.12);
    }

    const subtitle = q('[data-hero-subtitle]');
    if (subtitle.length) tl.from(subtitle, { y: 20, autoAlpha: 0, duration: 0.6 }, '-=0.5');

    const bullets = q('[data-hero-bullet]');
    if (bullets.length) tl.from(bullets, { y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.09 }, '-=0.32');

    const cta = q('[data-hero-cta]');
    if (cta.length) tl.from(cta, { y: 16, autoAlpha: 0, duration: 0.5 }, '-=0.28');

    const notice = q('[data-hero-notice]');
    if (notice.length) tl.from(notice, { autoAlpha: 0, duration: 0.5 }, '-=0.25');

    // Мокап (телефон на desktop / фото на mobile): подъём + лёгкий зум + мягкое
    // клип-раскрытие снизу. Стартует внахлёст с заголовком, а не последним.
    const mock = root.querySelector<HTMLElement>('[data-hero-mock]');
    if (mock) {
      tl.from(
        mock,
        {
          autoAlpha: 0,
          y: 34,
          scale: 0.965,
          clipPath: 'inset(0% 0% 7% 0%)',
          duration: 1.0,
          ease: EASE.outStrong,
        },
        0.28,
      );
    }

    if (variant === 'desktop') {
      // Столбики бар-чарта растут из нуля (scaleY, origin снизу) со стаггером.
      const bars = q('[data-hero-bar]');
      if (bars.length) {
        tl.from(
          bars,
          { scaleY: 0, transformOrigin: '50% 100%', duration: 0.65, stagger: 0.06, ease: EASE.out },
          '-=0.5',
        );
      }

      // Плавающий чип «Чек №214 оплачен» въезжает слева с задержкой.
      const chip = q('[data-hero-chip]');
      if (chip.length) {
        tl.from(chip, { x: -22, autoAlpha: 0, scale: 0.92, duration: 0.6, ease: EASE.out }, '-=0.3');
      }

      // Idle-float мокапа после входа: очень мягкий bob + микро-тилт. sine.inOut
      // (не bounce/elastic) — естественное «дыхание» карточки. Киллим в cleanup.
      if (mock) {
        tl.call(() => {
          const float = gsap.to(mock, {
            y: -10,
            rotationZ: 0.6,
            duration: 3.4,
            ease: 'sine.inOut',
            repeat: -1,
            yoyo: true,
          });
          disposers.push(() => float.kill());
        });
      }
    }
  } catch {
    // Любой сбой моушена не должен оставить hero пустым.
    splits.forEach((s) => s.revert());
    gsap.set(root.querySelectorAll(HERO_ANIM_SELECTOR), { clearProps: 'all' });
  }

  return () => {
    disposers.forEach((fn) => fn());
    splits.forEach((s) => s.revert());
  };
}

/**
 * Хук вступительного моушена hero. Гейтит по ширине (mobile/desktop рендерятся
 * одновременно, скрытый вариант через display:none — SplitText на скрытом узле
 * даёт неверные строки, поэтому мобильный таймлайн живёт только под mobile-шириной,
 * desktop — под md+). reduced-motion или «не та» ширина → ничего не прячем.
 */
function useHeroIntro(variant: HeroVariant): RefObject<HTMLElement> {
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;

      const widthQuery = variant === 'mobile' ? '(max-width: 767px)' : '(min-width: 768px)';
      const mm = gsap.matchMedia();
      mm.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          run: `(prefers-reduced-motion: no-preference) and ${widthQuery}`,
        },
        (context: gsap.Context) => {
          const c = context.conditions ?? {};
          if (!c.run) return; // reduced-motion / другая ширина → контент виден по дефолту
          return buildHeroIntro(root, variant);
        },
      );
    },
    { scope },
  );

  return scope;
}

/** CSS-мокап телефона с мини-дашбордом — без единой картинки, светлый UI. */
function PhoneMock({ amountRef }: { amountRef: RefObject<HTMLParagraphElement> }) {
  return (
    <div className="relative mx-auto w-[240px] md:w-[280px]">
      {/* Плавающий чип поверх телефона */}
      <div
        data-hero-chip
        className="absolute -left-6 top-24 z-10 hidden items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/95 px-3.5 py-2.5 shadow-xl shadow-slate-900/10 backdrop-blur sm:flex"
      >
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
          {/* Число считается вверх при появлении (useCountUp); финал — CSS-дефолт,
              виден без JS / при reduced-motion. tabular-nums убирает дрожь ширины. */}
          <p ref={amountRef} className="mt-0.5 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
            48 250 ₽
          </p>

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
                  data-hero-bar
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

const PRIMARY_CTA =
  'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700';

/** Primary-CTA мобильного hero: «Оставить заявку» → B2B-заявка на подключение (/register). */
function MobileAccessCta() {
  return (
    <Link to="/register" className={PRIMARY_CTA}>
      Оставить заявку
      <ArrowRight className="h-5 w-5" aria-hidden />
    </Link>
  );
}

/**
 * B2B-плашка под CTA: Autexa — инструмент для организаций (юрлиц и ИП),
 * не потребительский сервис. Спокойная, on-brand, без legalese-спама.
 */
function B2bNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-sm leading-relaxed text-slate-500 ${className}`}>
      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      {b2bNotice}
    </p>
  );
}

/**
 * < md: светлый hero в палитре главной. Сверху вниз: бейдж → H1 → подзаголовок →
 * CTA → workshop/hero-light-карточка. Вход оркестрован GSAP-таймлайном
 * (useHeroIntro), заголовок — SplitText по строкам с клип-маской. Атмосфера
 * mesh-блобов/сетки — как на desktop. Шапка с wordmark-логотипом и «Войти»
 * видна и на мобиле (Header.tsx).
 */
function MobileHero() {
  const scope = useHeroIntro('mobile');
  const { head, tail } = splitTitle(hero.title);
  // Флаг выключен → сразу 'failed': ветки рендера идентичны состоянию
  // «фото не загрузилось» (workshop-карточка на месте, блока фото нет).
  const [photoStatus, setPhotoStatus] = useState<HeroPhotoStatus>(heroLightReady ? 'loading' : 'failed');

  return (
    <section ref={scope} className="relative overflow-hidden md:hidden">
      {/* Атмосфера: mesh-блобы → инженерная сетка → лёгкий noise */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[360px] w-[560px] -translate-x-1/2 rounded-full bg-primary-300/30 blur-[110px]" />
        <div className="absolute -left-28 top-64 h-[260px] w-[260px] rounded-full bg-sky-300/30 blur-[100px]" />
        <div className="absolute -right-24 top-96 h-[240px] w-[240px] rounded-full bg-amber-200/40 blur-[100px]" />
        <div className="absolute inset-0" style={GRID_STYLE} />
        <div className="absolute inset-0 opacity-[0.025]" style={NOISE_STYLE} />
      </div>

      {/* Оркестрованный вход: бейдж → заголовок → подзаголовок → CTA → фото */}
      <div className="relative px-5 pb-12 pt-8">
        <div data-hero-badge>
          <AnchorBadge />
        </div>

        <h1
          data-hero-title
          className="mt-5 text-[clamp(34px,9vw,42px)] font-extrabold leading-[1.08] tracking-tight text-slate-900"
        >
          {head}
          {tail && (
            <>
              <br />
              <span className="text-primary-600">{tail}</span>
            </>
          )}
        </h1>

        <p data-hero-subtitle className="mt-4 max-w-md text-[17px] leading-relaxed text-slate-600">
          {hero.subtitle}
        </p>

        <div data-hero-cta className="mt-7 flex flex-col gap-3">
          <MobileAccessCta />
          <a
            href="#features"
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 motion-safe:active:scale-[0.98]"
          >
            Смотреть возможности
          </a>
        </div>

        <div data-hero-notice className="mt-3">
          <B2bNotice />
        </div>

        <div data-hero-mock className="mt-8">
          <MobileHeroPhotoCard status={photoStatus} onStatus={setPhotoStatus} />
        </div>
      </div>
    </section>
  );
}

/* ---------- Desktop / tablet hero (md+): светлый, как раньше ---------- */

function DesktopHero() {
  const scope = useHeroIntro('desktop');
  const { head, tail } = splitTitle(hero.title);

  // Число в мокапе считается вверх при появлении.
  const amountRef = useCountUp<HTMLParagraphElement>({ end: 48250, suffix: ' ₽', duration: 1.1 });

  // Лёгкий scrub-параллакс: мокап и mesh-блобы двигаются с разной скоростью
  // (глубина). Хук сам гейтит desktop + указатель мыши + no-preference.
  const mockParallax = useParallax<HTMLDivElement>({ y: -46 });
  const blobPrimary = useParallax<HTMLDivElement>({ y: -54 });
  const blobSky = useParallax<HTMLDivElement>({ y: -82 });
  const blobAmber = useParallax<HTMLDivElement>({ y: -34 });

  return (
    <section ref={scope} className="relative hidden overflow-hidden md:block">
      {/* Атмосфера: mesh-блобы (бренд-синий + sky + тёплый amber, без violet)
          → «чертёжная» сетка → лёгкий noise. Всё pointer-events-none. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          ref={blobPrimary}
          className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary-300/30 blur-[130px]"
        />
        <div
          ref={blobSky}
          className="absolute -left-40 top-48 h-[360px] w-[360px] rounded-full bg-sky-300/30 blur-[110px]"
        />
        <div
          ref={blobAmber}
          className="absolute -right-32 top-72 h-[320px] w-[320px] rounded-full bg-amber-200/40 blur-[110px]"
        />
        <div className="absolute inset-0" style={GRID_STYLE} />
        <div className="absolute inset-0 opacity-[0.025]" style={NOISE_STYLE} />
      </div>

      {/* Оркестрованный вход: badge → заголовок → подзаголовок → буллеты → CTA →
          мокап. reduced-motion — контент сразу на месте (см. useHeroIntro). */}
      <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-16 sm:px-6 sm:pt-24 md:gap-14 md:pb-20 lg:grid-cols-[1.15fr_0.85fr] lg:pb-28">
        <div className="text-center lg:text-left">
          <div data-hero-badge>
            <AnchorBadge />
          </div>

          <h1
            data-hero-title
            className="mt-6 text-[clamp(40px,7vw,72px)] font-extrabold leading-[1.04] tracking-tight text-slate-900 text-balance"
          >
            {head}
            {tail && (
              <>
                <br />
                <span className="text-primary-600">{tail}</span>
              </>
            )}
          </h1>

          <p data-hero-subtitle className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-600 lg:mx-0">
            {hero.subtitle}
          </p>

          <ul className="mx-auto mt-6 max-w-xl space-y-2.5 text-left lg:mx-0">
            {hero.bullets.map((b) => (
              <li
                key={b}
                data-hero-bullet
                className="flex items-start gap-2.5 text-[15px] leading-relaxed text-slate-700"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                {b}
              </li>
            ))}
          </ul>

          <div
            data-hero-cta
            className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
          >
            <CtaButton className="w-full sm:w-auto" />
            <a
              href="#features"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-8 text-base font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 motion-safe:active:scale-[0.98] sm:w-auto"
            >
              Смотреть возможности
            </a>
          </div>

          <div data-hero-notice className="mt-4">
            <B2bNotice className="justify-center lg:justify-start" />
          </div>
        </div>

        {/* Внешний слой — scrub-параллакс по скроллу; внутренний [data-hero-mock] —
            вход + idle-float. Раздельные слои, чтобы transform не конфликтовал. */}
        <div ref={mockParallax}>
          <div data-hero-mock>
            <PhoneMock amountRef={amountRef} />
          </div>
        </div>
      </div>
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
