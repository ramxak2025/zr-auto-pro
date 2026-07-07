import { Link } from 'react-router-dom';
import { MessageCircle, Send } from 'lucide-react';
import { WHATSAPP_ACCESS_MESSAGE, getTelegramUrl, getWhatsAppUrl } from '../config';
import { features } from '../content';

/**
 * Футер лендинга (общий для главной, /f/:slug, /tarify и /voprosy).
 *
 * < md — максимально минималистичный (решение владельца, v9): wordmark
 * по центру → две икон-кнопки WhatsApp/Telegram (44px, тинты каналов) →
 * одна строка «© Autexa 2026 · Конфиденциальность · Условия · Войти».
 * Ссылки «Продукт»/«Разделы» на мобиле не нужны: та же навигация живёт
 * в glass-баре и шторке «Разделы».
 *
 * md+ — прежний полный футер: бренд-блок + три колонки ссылок +
 * юридическая строка. Тап-таргеты ≥44px, светлая тема, slate-50.
 */
const COL_LINK = 'inline-flex min-h-[44px] items-center text-sm text-slate-500 transition-colors hover:text-slate-900';

const PRODUCT_LINKS = [
  { label: 'Возможности', to: '/#features' },
  { label: 'Тарифы', to: '/tarify' },
  { label: 'Вопросы и ответы', to: '/voprosy' },
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
      {/* ── Мобильный минимализм (< md): лого+иконки в одну строку, ниже — © ── */}
      <div className="px-4 py-5 md:hidden">
        <div className="flex items-center justify-between">
          <img
            src="/logo.png"
            alt="Autexa"
            width={90}
            height={22}
            loading="lazy"
            decoding="async"
            className="h-[22px] w-auto"
          />
          <div className="flex items-center gap-1">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Написать в WhatsApp"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-50 motion-safe:active:scale-90"
              >
                <MessageCircle className="h-5 w-5" aria-hidden />
              </a>
            )}
            {telegramUrl && (
              <a
                href={telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Написать в Telegram"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-sky-600 transition-colors hover:bg-sky-50 motion-safe:active:scale-90"
              >
                <Send className="h-5 w-5" aria-hidden />
              </a>
            )}
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-400">
          © Autexa 2026 ·{' '}
          <Link to="/privacy" className="transition-colors hover:text-slate-600">
            Конфиденциальность
          </Link>{' '}
          ·{' '}
          <Link to="/terms" className="transition-colors hover:text-slate-600">
            Условия
          </Link>
        </p>
      </div>

      {/* ── Полный футер (md+) ── */}
      <div className="mx-auto hidden max-w-6xl px-4 pb-10 pt-12 sm:px-6 md:block">
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
            {/* Не дублируем hero.subtitle (перечень модулей живёт только там) —
                у футера своя роль: категория + платформы одной строкой. */}
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              Учёт и порядок для автосервиса — в телефоне и в браузере.
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
