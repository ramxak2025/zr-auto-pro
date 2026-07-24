import { Link } from 'react-router-dom';

/**
 * Шапка главной. Видна на всех брейкпоинтах: на мобиле — wordmark-логотип
 * и «Войти» (nav-пункты скрыты, навигацию несёт нижний glass-бар).
 * «Тарифы» и «Вопросы» — Link'и на отдельные страницы, остальное — якоря.
 */
const NAV = [
  { label: 'Возможности', href: '#features' },
  { label: 'Надёжность', href: '#reliability' },
  { label: 'Тарифы', to: '/tarify' },
  { label: 'Вопросы', to: '/voprosy' },
] as const;

// Микро-взаимодействие desktop-nav: тонкое подчёркивание «выезжает» слева-направо
// на ховере/фокусе (transform origin-left, только opacity/scale — 60fps, без layout).
// motion-reduce: подчёркивание появляется мгновенно, без анимации.
const NAV_LINK =
  'relative inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 ' +
  'after:pointer-events-none after:absolute after:inset-x-4 after:bottom-1.5 after:h-px after:origin-left after:scale-x-0 after:bg-slate-900 after:transition-transform after:duration-300 after:ease-out ' +
  'hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:after:transition-none';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
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
