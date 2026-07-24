import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Send } from 'lucide-react';
import { gsap, useGSAP } from '../gsap';
import { getTelegramUrl } from '../config';

const PRIMARY =
  'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700';

/**
 * Primary-CTA «Оставить заявку» → B2B-заявка на подключение автосервиса
 * (/register). Рядом — компактная secondary-кнопка Telegram как живой
 * контакт-канал («написать нам»), если контакт задан.
 *
 * Магнитный эффект: кнопка мягко тянется к курсору (макс. ~8px), возвращается
 * при уходе. Строго gated (pointer:fine + no-preference) — на тач/мобиле и при
 * reduced-motion ничего не двигается, тап-таргет не смещается. Анимируется
 * только transform (quickTo, power3.out), 60fps.
 */
export default function CtaButton({ className = '' }: { className?: string }) {
  const telegram = getTelegramUrl();
  const btnRef = useRef<HTMLAnchorElement>(null);

  useGSAP(() => {
    const btn = btnRef.current;
    if (!btn) return;

    const mm = gsap.matchMedia();
    mm.add('(pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });

      const onMove = (e: PointerEvent) => {
        const r = btn.getBoundingClientRect();
        xTo(gsap.utils.clamp(-8, 8, (e.clientX - (r.left + r.width / 2)) * 0.2));
        yTo(gsap.utils.clamp(-6, 6, (e.clientY - (r.top + r.height / 2)) * 0.4));
      };
      const onLeave = () => {
        xTo(0);
        yTo(0);
      };

      btn.addEventListener('pointermove', onMove);
      btn.addEventListener('pointerleave', onLeave);
      return () => {
        btn.removeEventListener('pointermove', onMove);
        btn.removeEventListener('pointerleave', onLeave);
        gsap.set(btn, { clearProps: 'transform' });
      };
    });
  });

  return (
    <div className={`flex items-stretch gap-3 ${className}`}>
      <Link ref={btnRef} to="/register" className={`${PRIMARY} min-w-0 flex-1 sm:flex-none`}>
        Оставить заявку
        <ArrowRight className="h-5 w-5" />
      </Link>
      {telegram && (
        <a
          href={telegram}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Написать в Telegram"
          title="Написать в Telegram"
          className="inline-flex min-h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sky-500 shadow-sm transition hover:border-sky-300 hover:text-sky-600 motion-safe:active:scale-[0.98]"
        >
          <Send className="h-5 w-5" />
        </a>
      )}
    </div>
  );
}
