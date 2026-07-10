import { Link } from 'react-router-dom';
import { ArrowRight, Send } from 'lucide-react';
import { getTelegramUrl } from '../config';

const PRIMARY =
  'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700';

/**
 * Primary-CTA «Оставить заявку» → B2B-заявка на подключение автосервиса
 * (/register). Рядом — компактная secondary-кнопка Telegram как живой
 * контакт-канал («написать нам»), если контакт задан.
 */
export default function CtaButton({ className = '' }: { className?: string }) {
  const telegram = getTelegramUrl();

  return (
    <div className={`flex items-stretch gap-3 ${className}`}>
      <Link to="/register" className={`${PRIMARY} min-w-0 flex-1 sm:flex-none`}>
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
