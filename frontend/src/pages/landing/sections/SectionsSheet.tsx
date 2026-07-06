import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LayoutGrid, MessageCircle, X } from 'lucide-react';
import { features } from '../content';
import { getWhatsAppUrl } from '../config';
import { DEFAULT_TINT, groupBySections, SECTION_ICONS, SECTION_TINTS } from '../icons';

interface SectionsSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Разделы по направлениям (единый источник — SECTION_GROUPS в icons.ts);
    features статичен — считаем один раз на модуль. */
const GROUPED_FEATURES = groupBySections(features);

/**
 * Bottom-sheet «Возможности Autexa» — открывается из пункта «Разделы»
 * нижнего glass-бара (мобилка). Каталог по направлениям: компактный
 * заголовок группы → сетка 2 колонки её разделов (карточки ужаты до
 * min-h 44px против прежних 56, чтобы группировка почти не растила
 * общую высоту), тап по разделу → /f/<slug> и шторка закрывается.
 *
 * Закрытие: крестик, тап по подложке, Escape. body scroll-lock пока открыта.
 * slide-up 250 мс (reduced-motion — мгновенно), z-[60] — выше бара (z-40)
 * и sticky-шапки (z-50), не полагаясь на порядок секций в DOM,
 * aria-modal + автофокус на первый раздел + focus-trap по Tab.
 *
 * Внизу шторки закреплена (вне scroll-области) зелёная кнопка
 * «Написать в WhatsApp» — контакт переехал сюда из glass-бара v3.
 */
export default function SectionsSheet({ open, onClose }: SectionsSheetProps) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const whatsappUrl = getWhatsAppUrl();

  // Скролл-лок страницы, пока шторка открыта; cleanup вернёт исходное значение
  // и при закрытии, и при unmount (уход на /f/<slug> с открытой шторкой).
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // ≥768px (md) шторка спрятана CSS'ом (md:hidden): при повороте в landscape
  // на широких телефонах / ресайзе с открытой шторкой закрываем её, иначе
  // body-лок остаётся активным без видимого способа снять.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 768px)');
    if (mq.matches) {
      onClose();
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) onClose();
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, onClose]);

  // Фокус на первый раздел при открытии, Escape закрывает, Tab зациклен
  // внутри шторки (aria-modal честный — фокус не уходит под scrim).
  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>('a[href], button'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!active || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const instant = { duration: 0 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={containerRef}
          className="fixed inset-0 z-[60] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Возможности Autexa"
          // На время exit-анимации (250 мс) полноэкранная обёртка ещё в DOM —
          // отключаем ей hit-testing, чтобы она не глотала тапы по бару/контенту.
          exit={{ pointerEvents: 'none' }}
        >
          {/* Подложка-scrim: тап закрывает. div, а не button — вне tab-порядка
              (видимый крестик уже есть), паттерн допустимый для scrim'а. */}
          <motion.div
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? instant : { duration: 0.25 }}
          />

          {/* Шторка: flex-колонка — заголовок и WhatsApp-кнопка закреплены,
              скроллится только сетка разделов между ними */}
          <motion.div
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl"
            style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={reduceMotion ? instant : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* Ручка-граб */}
            <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-300" />

            <div className="flex items-center justify-between px-4 pt-2">
              <h2 className="text-lg font-bold text-slate-900">Возможности Autexa</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition motion-safe:active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-2 min-h-0 overflow-y-auto px-4 pb-3 [overscroll-behavior-y:contain]">
              {GROUPED_FEATURES.map((group, gi) => (
                <div key={group.title} className={gi === 0 ? undefined : 'mt-4'}>
                  {/* slate-500: 12px uppercase = «обычный» текст по WCAG, нужен AA 4.5:1 (slate-400 давал ~2.6:1) */}
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{group.title}</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {group.items.map((f, i) => {
                      const Icon = SECTION_ICONS[f.icon] ?? LayoutGrid;
                      const tint = SECTION_TINTS[f.slug] ?? DEFAULT_TINT;
                      return (
                        <Link
                          key={f.slug}
                          ref={gi === 0 && i === 0 ? firstLinkRef : undefined}
                          to={`/f/${f.slug}`}
                          onClick={onClose}
                          className="flex min-h-[44px] items-center gap-2.5 rounded-2xl border border-slate-200/60 bg-white px-3 py-1.5 shadow-sm transition motion-safe:active:scale-[0.98]"
                        >
                          <span
                            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint.chip}`}
                          >
                            <Icon className={`h-4 w-4 ${tint.icon}`} />
                          </span>
                          <span className="line-clamp-2 min-w-0 text-[13px] font-medium leading-snug text-slate-800">
                            {f.shortTitle ?? f.title}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Закреплённая CTA — контакт по решению владельца живёт в шторке */}
            {whatsappUrl && (
              <div className="shrink-0 border-t border-slate-100 px-4 pt-3">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition motion-safe:active:scale-[0.98]"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden />
                  Написать в WhatsApp
                </a>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
