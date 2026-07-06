import { ReactNode, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, MessageCircle, Wallet } from 'lucide-react';
import { getWhatsAppUrl } from '../config';
import SectionsSheet from './SectionsSheet';

/**
 * Плавающее liquid-glass меню внизу экрана — только мобилка (md:hidden),
 * общее для главной и страниц разделов /f/:slug.
 *
 * Психология продаж: вместо навигации по секциям — три действия воронки:
 *  - «Разделы» → bottom-sheet со всеми 16 разделами (SectionsSheet);
 *  - «Тарифы» → #pricing (на главной — нативный hash-скролл; на /f/* — Link
 *    на /#pricing, hash обрабатывает mount-эффект LandingPage);
 *  - «Написать» — большая emerald-CTA (~45% ширины бара) → WhatsApp.
 * Scroll-spy с «каплей» убран сознательно: пункты теперь действия, не секции.
 */

const ITEM_CLS =
  'flex min-h-[48px] min-w-[64px] flex-1 flex-col items-center justify-center rounded-full px-2 py-1 text-slate-600 transition motion-safe:active:scale-95';

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
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-0.5 rounded-full border border-slate-200/70 bg-white/70 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-2xl backdrop-saturate-150">
        {children}
      </div>
    </nav>
  );
}

export default function GlassTabBar() {
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  const [sheetOpen, setSheetOpen] = useState(false);
  const sectionsBtnRef = useRef<HTMLButtonElement>(null);
  const whatsappUrl = getWhatsAppUrl();

  // Закрытие шторки возвращает фокус триггеру (a11y: VoiceOver/клавиатура
  // не повисают на body); focus-ring на тапе не появится (:focus-visible).
  const closeSheet = () => {
    setSheetOpen(false);
    sectionsBtnRef.current?.focus({ preventScroll: true });
  };

  const pricingContent = (
    <>
      <Wallet className="h-[18px] w-[18px]" aria-hidden />
      <span className="mt-0.5 text-[10px] font-medium leading-tight">Тарифы</span>
    </>
  );

  return (
    <>
      <BarShell>
        <button
          ref={sectionsBtnRef}
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={ITEM_CLS}
        >
          <LayoutGrid className="h-[18px] w-[18px]" aria-hidden />
          <span className="mt-0.5 text-[10px] font-medium leading-tight">Разделы</span>
        </button>

        {onHome ? (
          // Нативный hash-скролл (smooth задаёт LandingPage через scroll-behavior)
          <a href="#pricing" className={ITEM_CLS}>
            {pricingContent}
          </a>
        ) : (
          <Link to="/#pricing" className={ITEM_CLS}>
            {pricingContent}
          </Link>
        )}

        {whatsappUrl && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 flex min-h-[48px] flex-[1.6] items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-500/30 transition motion-safe:active:scale-95"
          >
            <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
            Написать
          </a>
        )}
      </BarShell>

      <SectionsSheet open={sheetOpen} onClose={closeSheet} />
    </>
  );
}
