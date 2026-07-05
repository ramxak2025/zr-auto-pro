import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { HelpCircle, Home, LayoutGrid, ShieldCheck } from 'lucide-react';

interface TabItem {
  /** id секции для scroll-spy; 'top' — верх страницы */
  id: 'top' | 'features' | 'reliability' | 'faq';
  label: string;
  icon: typeof Home;
}

const TABS: TabItem[] = [
  { id: 'top', label: 'Обзор', icon: Home },
  { id: 'features', label: 'Возможности', icon: LayoutGrid },
  { id: 'reliability', label: 'Надёжность', icon: ShieldCheck },
  { id: 'faq', label: 'Вопросы', icon: HelpCircle },
];

/** Секции, за которыми следит scroll-spy (кроме 'top' — он вычисляется). */
const SPY_IDS = ['features', 'reliability', 'faq'] as const;

/**
 * Плавающее liquid-glass меню внизу экрана — только мобилка (скрыто с md:).
 * Повторяет язык нижнего бара iOS-приложения: пилюля на blur-стекле, активный
 * пункт подсвечен «каплей», которая spring'ом перетекает между пунктами
 * (framer-motion layoutId). Активность секции — IntersectionObserver по
 * центральной полосе вьюпорта.
 */
export default function GlassTabBar() {
  const [active, setActive] = useState<TabItem['id']>('top');
  const reduceMotion = useReducedMotion();
  // Капля летает layoutId-анимацией только после первого реального
  // взаимодействия пользователя: при reload в середине страницы scroll
  // restoration прилетает уже ПОСЛЕ маунта, и без этого флага капля на глазах
  // «перелетала» бы с «Обзора» на актуальный пункт.
  const [dropArmed, setDropArmed] = useState(false);
  // Пока идёт программный smooth-скролл по тапу, IO-колбэки не трогают active —
  // иначе капля пробегает по всем промежуточным пунктам (features →
  // reliability → …) вслед за прокруткой.
  const programmaticScroll = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);
  const settleRef = useRef<() => void>(() => {});

  // Начальная секция — синхронно до первого пейнта: если страница открылась
  // не с верха (hash-якорь, ранний scroll restoration), капля сразу встаёт на
  // актуальный пункт вместо рывка с «Обзора».
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
      // Ни одна из секций не в центре: выше features — это «Обзор» (hero),
      // ниже (Platforms/CTA между reliability и faq) — держим предыдущую.
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
    // pointer-events-none: контейнер растянут на всю ширину ради центрирования,
    // но тапы должна ловить только пилюля — иначе мёртвые зоны по бокам
    // блокируют FAQ-аккордеон и ссылки футера под баром.
    <nav
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 md:hidden"
      style={{ bottom: 'max(16px, env(safe-area-inset-bottom))' }}
      aria-label="Разделы лендинга"
    >
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/15 bg-white/10 p-1.5 shadow-xl shadow-black/40 backdrop-blur-2xl backdrop-saturate-150">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              onClick={() => onTabClick(tab.id)}
              aria-current={isActive ? 'true' : undefined}
              className="relative flex min-h-[44px] min-w-[64px] flex-col items-center justify-center rounded-full px-2.5 py-1"
            >
              {isActive && (
                <motion.span
                  layoutId="landing-glass-tab-drop"
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-white/[0.14] ring-1 ring-white/10"
                  transition={
                    reduceMotion || !dropArmed ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 32 }
                  }
                />
              )}
              <tab.icon
                className={`relative h-[18px] w-[18px] transition-colors duration-200 ${isActive ? 'text-white' : 'text-white/55'}`}
              />
              <span
                className={`relative mt-0.5 text-[10px] font-medium leading-tight transition-colors duration-200 ${isActive ? 'text-white' : 'text-white/55'}`}
              >
                {tab.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
