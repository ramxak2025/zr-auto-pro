import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { HelpCircle, Home, LayoutGrid, MessageCircle } from 'lucide-react';
import { getWhatsAppUrl } from '../config';

interface TabItem {
  /** id секции для scroll-spy; 'top' — верх страницы */
  id: 'top' | 'features' | 'faq';
  label: string;
  icon: typeof Home;
}

const TABS: TabItem[] = [
  { id: 'top', label: 'Главная', icon: Home },
  { id: 'features', label: 'Возможности', icon: LayoutGrid },
  { id: 'faq', label: 'Вопросы', icon: HelpCircle },
];

/** Секции, за которыми следит scroll-spy (кроме 'top' — он вычисляется). */
const SPY_IDS = ['features', 'faq'] as const;

/** Пункты бара на странице раздела /f/:slug — навигация на главную. */
const DETAIL_TABS: { to: string; label: string; icon: typeof Home }[] = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/#features', label: 'Возможности', icon: LayoutGrid },
  { to: '/#faq', label: 'Вопросы', icon: HelpCircle },
];

const ITEM_CLS =
  'relative flex min-h-[44px] min-w-[60px] flex-col items-center justify-center rounded-full px-2.5 py-1 transition motion-safe:active:scale-95';

/** Пилюля на blur-стекле — общая оболочка бара для обоих режимов. */
function BarShell({ children }: { children: ReactNode }) {
  return (
    // pointer-events-none: контейнер растянут на всю ширину ради центрирования,
    // но тапы должна ловить только пилюля — иначе мёртвые зоны по бокам
    // блокируют FAQ-аккордеон и ссылки футера под баром.
    <nav
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 md:hidden"
      style={{ bottom: 'max(16px, env(safe-area-inset-bottom))' }}
      aria-label="Меню сайта"
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-slate-200/70 bg-white/70 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-2xl backdrop-saturate-150">
        {children}
      </div>
    </nav>
  );
}

/** Акцентный CTA-пункт «Написать» → WhatsApp; номера нет — пункт не рендерится. */
function WriteTab() {
  const url = getWhatsAppUrl();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1 flex min-h-[44px] flex-col items-center justify-center rounded-full bg-emerald-500 px-3.5 py-1 text-white shadow-md shadow-emerald-500/30 transition motion-safe:active:scale-95"
    >
      <MessageCircle className="h-[18px] w-[18px]" />
      <span className="mt-0.5 text-[10px] font-semibold leading-tight">Написать</span>
    </a>
  );
}

/**
 * Режим страницы раздела (/f/:slug): три ссылки ведут на главную (hash-скролл
 * к секции обрабатывает mount-эффект LandingPage). Капли нет — мы не на
 * главной, подсвечивать «текущий» пункт было бы враньём; визуальный якорь
 * бара — акцентный CTA «Написать».
 */
function DetailGlassTabBar() {
  return (
    <BarShell>
      {DETAIL_TABS.map((tab) => (
        <Link key={tab.to} to={tab.to} className={ITEM_CLS}>
          <tab.icon className="h-[18px] w-[18px] text-slate-500" />
          <span className="mt-0.5 text-[10px] font-medium leading-tight text-slate-500">{tab.label}</span>
        </Link>
      ))}
      <WriteTab />
    </BarShell>
  );
}

/**
 * Режим главной: активный пункт подсвечен «каплей», которая spring'ом
 * перетекает между пунктами (framer-motion layoutId). Активность секции —
 * IntersectionObserver по центральной полосе вьюпорта.
 */
function HomeGlassTabBar() {
  const [active, setActive] = useState<TabItem['id']>('top');
  const reduceMotion = useReducedMotion();
  // Капля летает layoutId-анимацией только после первого реального
  // взаимодействия пользователя: при reload в середине страницы scroll
  // restoration прилетает уже ПОСЛЕ маунта, и без этого флага капля на глазах
  // «перелетала» бы с «Главной» на актуальный пункт.
  const [dropArmed, setDropArmed] = useState(false);
  // Пока идёт программный smooth-скролл по тапу, IO-колбэки не трогают active —
  // иначе капля пробегает по всем промежуточным пунктам вслед за прокруткой.
  const programmaticScroll = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);
  const settleRef = useRef<() => void>(() => {});

  // Начальная секция — синхронно до первого пейнта: если страница открылась
  // не с верха (hash-якорь, ранний scroll restoration), капля сразу встаёт на
  // актуальный пункт вместо рывка с «Главной».
  useLayoutEffect(() => {
    const center = window.innerHeight / 2;
    let current: TabItem['id'] = 'top';
    for (const id of SPY_IDS) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= center) current = id;
    }
    setActive(current);
  }, []);

  // Первое взаимодействие (тап/скролл/клавиатура) «вооружает» анимацию капли.
  useEffect(() => {
    const arm = () => setDropArmed(true);
    const opts: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener('pointerdown', arm, opts);
    window.addEventListener('wheel', arm, opts);
    window.addEventListener('keydown', arm, opts);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('wheel', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  useEffect(() => {
    const elements = SPY_IDS.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // Секция активна, когда пересекает узкую полосу по центру экрана.
    const visible = new Map<string, boolean>();

    /** Активный таб по текущему состоянию центральной полосы; null — «держим предыдущий». */
    const currentTab = (): TabItem['id'] | null => {
      const current = SPY_IDS.filter((id) => visible.get(id)).pop();
      if (current) return current;
      // Ни одна из секций не в центре: выше features — это «Главная» (hero),
      // ниже (Reliability/Platforms/CTA между features и faq) — держим предыдущую.
      const features = document.getElementById('features');
      if (features && features.getBoundingClientRect().top > window.innerHeight / 2) return 'top';
      return null;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        if (programmaticScroll.current) return; // едем по тапу — каплю не дёргаем
        const next = currentTab();
        if (next) setActive(next);
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    elements.forEach((el) => observer.observe(el));

    // Конец программного скролла: снова доверяем scroll-spy и сразу
    // пересинхронизируем подсветку с фактическим положением (пользователь мог
    // прервать smooth-скролл свайпом).
    const settle = () => {
      if (!programmaticScroll.current) return;
      programmaticScroll.current = false;
      window.clearTimeout(settleTimer.current);
      const next = currentTab();
      if (next) setActive(next);
    };
    settleRef.current = settle;
    // 'scrollend' есть не во всех Safari — страховочный таймер ставится в onTabClick.
    window.addEventListener('scrollend', settle);

    return () => {
      observer.disconnect();
      window.removeEventListener('scrollend', settle);
      window.clearTimeout(settleTimer.current);
    };
  }, []);

  const onTabClick = (id: TabItem['id']) => {
    setActive(id);
    programmaticScroll.current = true;
    window.clearTimeout(settleTimer.current);
    // Страховка для браузеров без 'scrollend': нативный smooth-скролл
    // укладывается в ~0.5 с, берём с запасом.
    settleTimer.current = window.setTimeout(() => settleRef.current(), 1400);
  };

  return (
    <BarShell>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            onClick={() => onTabClick(tab.id)}
            aria-current={isActive ? 'true' : undefined}
            className={ITEM_CLS}
          >
            {isActive && (
              <motion.span
                layoutId="landing-glass-tab-drop"
                aria-hidden
                className="absolute inset-0 rounded-full bg-primary-100 ring-1 ring-primary-200/60"
                transition={
                  reduceMotion || !dropArmed ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 32 }
                }
              />
            )}
            <tab.icon
              className={`relative h-[18px] w-[18px] transition-colors duration-200 ${isActive ? 'text-primary-700' : 'text-slate-500'}`}
            />
            <span
              className={`relative mt-0.5 text-[10px] font-medium leading-tight transition-colors duration-200 ${isActive ? 'text-primary-700' : 'text-slate-500'}`}
            >
              {tab.label}
            </span>
          </a>
        );
      })}
      <WriteTab />
    </BarShell>
  );
}

/**
 * Плавающее liquid-glass меню внизу экрана — только мобилка (скрыто с md:),
 * общее для главной и страниц разделов /f/:slug. Режим — по useLocation:
 * на главной работает scroll-spy с «каплей», на разделе — навигация на главную.
 * Четвёртый пункт — акцентный CTA «Написать» (WhatsApp из config).
 */
export default function GlassTabBar() {
  const { pathname } = useLocation();
  return pathname === '/' ? <HomeGlassTabBar /> : <DetailGlassTabBar />;
}
