import { Link } from 'react-router-dom';
import { MessageCircle, Send } from 'lucide-react';
import { WHATSAPP_ACCESS_MESSAGE, getTelegramUrl, getWhatsAppUrl } from '../config';
import { features } from '../content';

/**
 * Футер лендинга (общий для главной, /f/:slug и /tarify): бренд-блок +
 * три колонки ссылок + юридическая строка. На мобиле колонки 2×,
 * бренд сверху; тап-таргеты ≥44px. Светлая тема, слегка приподнятый
 * фон slate-50 — визуально закрывает страницу.
 */
const COL_LINK = 'inline-flex min-h-[44px] items-center text-sm text-slate-500 transition-colors hover:text-slate-900';

const PRODUCT_LINKS = [
  { label: 'Возможности', to: '/#features' },
  { label: 'Тарифы', to: '/tarify' },
  { label: 'Вопросы и ответы', to: '/#faq' },
  { label: 'Войти', to: '/login' },
] as const;

// Топ-разделы в футере — самые продающие; полный список живёт в шторке «Разделы».
const TOP_SECTIONS = ['kassa', 'sklad', 'dengi', 'rassrochka', 'golos'] as const;

export default function Footer() {
  const whatsappUrl = getWhatsAppUrl(WHATSAPP_ACCESS_MESSAGE);
  const telegramUrl = getTelegramUrl();
  const sections = TOP_SECTIONS.map((slug) => features.find((f) => f.slug === slug)).filter(
    (f): f is NonNullable<typeof f> => Boolean(f),
  );

  return (
    <footer className="border-t border-slate-200/70 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Бренд */}
          <div className="col-span-2 md:col-span-1">
            <img
              src="/logo.png"
              alt="Autexa"
              width={116}
              height={28}
              loading="lazy"
              decoding="async"
              className="h-7 w-auto"
            />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Касса, склад, зарплата и клиенты автосервиса — в одном приложении. Работает даже без интернета.
            </p>
          </div>

          {/* Продукт */}
          <nav aria-label="Продукт">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Продукт</p>
            <ul className="mt-3 space-y-1">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.label}>
                  <Link to={l.to} className={COL_LINK}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Разделы */}
          <nav aria-label="Разделы">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Разделы</p>
            <ul className="mt-3 space-y-1">
              {sections.map((f) => (
                <li key={f.slug}>
                  <Link to={`/f/${f.slug}`} className={COL_LINK}>
                    {f.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Связаться */}
          <nav aria-label="Связаться" className="col-span-2 md:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Связаться</p>
            <ul className="mt-3 space-y-2">
              {whatsappUrl && (
                <li>
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 motion-safe:active:scale-[0.98]"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    WhatsApp
                  </a>
                </li>
              )}
              {telegramUrl && (
                <li>
                  <a
                    href={telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100 motion-safe:active:scale-[0.98]"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    Telegram
                  </a>
                </li>
              )}
            </ul>
          </nav>
        </div>

        {/* Юридическая строка */}
        <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-slate-200/70 pt-6 sm:flex-row sm:items-center">
          <p className="text-sm text-slate-500">Autexa © 2026</p>
          <nav className="-mx-3 flex items-center" aria-label="Документы">
            <Link to="/privacy" className={`${COL_LINK} px-3`}>
              Конфиденциальность
            </Link>
            <Link to="/terms" className={`${COL_LINK} px-3`}>
              Условия
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
