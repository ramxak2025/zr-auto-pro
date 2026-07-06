import { Link } from 'react-router-dom';

const ANCHORS = [
  { href: '#features', label: 'Возможности' },
  { href: '#reliability', label: 'Надёжность' },
  { href: '#pricing', label: 'Тарифы' },
  { href: '#faq', label: 'Вопросы' },
];

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

        {/* Якоря — только на desktop */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Разделы лендинга">
          {ANCHORS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              {a.label}
            </a>
          ))}
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
