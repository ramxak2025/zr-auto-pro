import { ReactNode, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpCircle, Home, LayoutGrid, Wallet, type LucideIcon } from 'lucide-react';
import SectionsSheet from './SectionsSheet';

/**
 * Плавающее liquid-glass меню внизу экрана — только мобилка (md:hidden),
 * общее для главной, страниц разделов /f/:slug и страницы тарифов /tarify.
 *
 * v3 — четыре пункта как таб-бар приложения (равные ширины, тапы ≥44px):
 *  - «Главная»: на «/» — скролл вверх (#top), иначе Link на /;
 *  - «Разделы»: bottom-sheet со всеми 16 разделами (SectionsSheet);
 *  - «Тарифы»: Link на /tarify (на самой /tarify — скролл вверх);
 *  - «Вопросы»: Link на /voprosy (на самой /voprosy — скролл вверх);
 *    якорь #faq из бара больше не нужен — все вопросы живут на /voprosy.
 * «Написать» из бара убран — WhatsApp живёт закреплённой кнопкой внизу
 * шторки «Разделы» и в CTA-секциях страниц.
 *
 * Active-подсветка по pathname: «/» → Главная, «/tarify» → Тарифы,
 * «/voprosy» → Вопросы, «/f/*» → Разделы (страницы разделов открываются
 * из шторки «Разделы» — подсвечиваем её как логичную зону).
 */

function itemCls(active: boolean) {
  // Активный пункт получает мягкую pill-подсветку (bg-primary-50) — ясная
  // «где я» без нового элемента; переход color+bg 200ms, transform — active:scale-95.
  return `flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center rounded-full px-1 py-1 transition-[color,background-color,transform] duration-200 motion-safe:active:scale-95 ${
    active ? 'bg-primary-50 text-primary-600' : 'text-slate-600'
  }`;
}

function ItemBody({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      {/* Лёгкий scale иконки при активации — transform, 200ms, motion-safe */}
      <Icon
        className={`h-[18px] w-[18px] transition-transform duration-200 ease-out ${
          active ? 'motion-safe:scale-110' : ''
        }`}
        aria-hidden
      />
      <span className="mt-0.5 text-[10px] font-medium leading-tight">{label}</span>
    </>
  );
}

/** Пилюля на blur-стекле — оболочка бара. */
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
      {/* Тень сбалансирована вокруг пилюли (лёгкий ореол вверх + мягкая КОРОТКАЯ вниз,
          максимум ~12px ниже бара): прежняя shadow-xl (0 20px 25px) была смещена вниз
          на 20px и резалась краем вьюпорта — бар стоит всего в ~16px от низа, при
          сжатии панелей Safari обрубленная кромка «гуляла». Ни один предок бара не
          создаёт containing block (transform/filter) — fixed считается от вьюпорта. */}
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-0.5 rounded-full border border-slate-200/70 bg-white/70 p-1.5 shadow-[0_-1px_10px_rgba(15,23,42,0.05),0_6px_18px_-6px_rgba(15,23,42,0.18)] backdrop-blur-2xl backdrop-saturate-150">
        {children}
      </div>
    </nav>
  );
}

export default function GlassTabBar() {
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  const onTarify = pathname === '/tarify';
  const onVoprosy = pathname === '/voprosy';
  const onFeature = pathname.startsWith('/f/');
  const [sheetOpen, setSheetOpen] = useState(false);
  const sectionsBtnRef = useRef<HTMLButtonElement>(null);

  // Закрытие шторки возвращает фокус триггеру (a11y: VoiceOver/клавиатура
  // не повисают на body); focus-ring на тапе не появится (:focus-visible).
  const closeSheet = () => {
    setSheetOpen(false);
    sectionsBtnRef.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <BarShell>
        {/* Главная: на «/» — нативный скролл к #top (smooth задаёт LandingPage) */}
        {onHome ? (
          <a href="#top" className={itemCls(true)} aria-current="page">
            <ItemBody icon={Home} label="Главная" active />
          </a>
        ) : (
          <Link to="/" className={itemCls(false)}>
            <ItemBody icon={Home} label="Главная" active={false} />
          </Link>
        )}

        {/* Разделы: шторка; активен на /f/* */}
        <button
          ref={sectionsBtnRef}
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={itemCls(onFeature)}
        >
          <ItemBody icon={LayoutGrid} label="Разделы" active={onFeature} />
        </button>

        {/* Тарифы: отдельная страница; на ней самой — скролл вверх */}
        {onTarify ? (
          <a href="#top" className={itemCls(true)} aria-current="page">
            <ItemBody icon={Wallet} label="Тарифы" active />
          </a>
        ) : (
          <Link to="/tarify" className={itemCls(false)}>
            <ItemBody icon={Wallet} label="Тарифы" active={false} />
          </Link>
        )}

        {/* Вопросы: отдельная страница /voprosy; на ней самой — скролл вверх */}
        {onVoprosy ? (
          <a href="#top" className={itemCls(true)} aria-current="page">
            <ItemBody icon={HelpCircle} label="Вопросы" active />
          </a>
        ) : (
          <Link to="/voprosy" className={itemCls(false)}>
            <ItemBody icon={HelpCircle} label="Вопросы" active={false} />
          </Link>
        )}
      </BarShell>

      <SectionsSheet open={sheetOpen} onClose={closeSheet} />
    </>
  );
}
