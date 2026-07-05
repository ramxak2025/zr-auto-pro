import { Link } from 'react-router-dom';
import { ArrowRight, Send } from 'lucide-react';
import { getAccessContactUrl, getTelegramUrl, getWhatsAppUrl } from '../config';

const PRIMARY =
  'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition-colors hover:bg-primary-500 active:bg-primary-700';

/**
 * Primary-CTA «Получить доступ» → WhatsApp (с предзаполненным сообщением),
 * рядом — компактная secondary-кнопка Telegram. Контактов нет → «Войти» (→ /login).
 */
export default function CtaButton({ className = '' }: { className?: string }) {
  const whatsapp = getWhatsAppUrl();
  const telegram = getTelegramUrl();
  const fallback = getAccessContactUrl();

  if (!whatsapp) {
    // Контактов нет вовсе → «Войти»; есть только Telegram/телефон → «Получить доступ» туда.
    if (fallback) {
      return (
        <a
          href={fallback}
          target={fallback.startsWith('http') ? '_blank' : undefined}
          rel="noopener noreferrer"
          className={`${PRIMARY} ${className}`}
        >
          Получить доступ
          <ArrowRight className="h-5 w-5" />
        </a>
      );
    }
    return (
      <Link to="/login" className={`${PRIMARY} ${className}`}>
        Войти
        <ArrowRight className="h-5 w-5" />
      </Link>
    );
  }

  return (
    <div className={`flex items-stretch gap-3 ${className}`}>
      <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${PRIMARY} min-w-0 flex-1 sm:flex-none`}>
        Получить доступ
        <ArrowRight className="h-5 w-5" />
      </a>
      {telegram && (
        <a
          href={telegram}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Написать в Telegram"
          title="Написать в Telegram"
          className="inline-flex min-h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-white/10 text-sky-400 transition-colors hover:border-sky-400/40 hover:text-sky-300"
        >
          <Send className="h-5 w-5" />
        </a>
      )}
    </div>
  );
}
