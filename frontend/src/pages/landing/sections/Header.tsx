import { Link } from 'react-router-dom';

/**
 * Шапка главной. На < md скрыта: мобильный hero — тёмный полноэкранный
 * (фон-герой), навигацию несёт нижний glass-бар, а «Войти» продублирован
 * прозрачной кнопкой прямо в hero (Hero.tsx → MobileHero).
 * «Тарифы» — Link на отдельную страницу /tarify, остальные пункты — якоря.
 */
const NAV = [
  { label: 'Возможности', href: '#features' },
  { label: 'Надёжность', href: '#reliability' },
  { label: 'Тарифы', to: '/tarify' },
  { label: 'Вопросы', href: '#faq' },
] as const;

const NAV_LINK =
  'inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 hidden border-b border-slate-200/70 bg-white/80 backdrop-blur-xl md:block">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a
          href="#top"
          className="flex min-h-[44px] items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900"
        >
          {/* Полный wordmark: на светлой теме тёмно-синие буквы читаются отлично
              (на тёмной v2 был нечитаем — потому стояла иконка+текст). 1502×363 ≈ 4.14:1. */}
          <img
            src="/logo.png"
            alt="Autexa"
            width={116}
            height={28}
            loading="eager"
            decoding="async"
            className="h-7 w-auto"
          />
        </a>

        {/* Якоря + роут «Тарифы» — только на desktop */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Разделы лендинга">
          {NAV.map((a) =>
            'to' in a ? (
              <Link key={a.label} to={a.to} className={NAV_LINK}>
                {a.label}
              </Link>
            ) : (
              <a key={a.label} href={a.href} className={NAV_LINK}>
                {a.label}
              </a>
            ),
          )}
        </nav>

        <Link
          to="/login"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
        >
          Войти
        </Link>
      </div>
    </header>
  );
}
