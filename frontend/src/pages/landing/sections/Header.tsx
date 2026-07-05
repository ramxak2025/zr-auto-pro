import { Link } from 'react-router-dom';

const ANCHORS = [
  { href: '#features', label: 'Возможности' },
  { href: '#reliability', label: 'Надёжность' },
  { href: '#faq', label: 'Вопросы' },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0A0A0B]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex min-h-[44px] items-center gap-2.5 text-lg font-bold tracking-tight text-white">
          {/* logo.png (wordmark) на тёмном фоне нечитаем (тёмно-синие буквы) — берём иконку + белый текст */}
          <img
            src="/logo-icon.png"
            alt="Autexa"
            width={30}
            height={30}
            loading="eager"
            decoding="async"
            className="h-[30px] w-[30px] rounded-lg"
          />
          <span aria-hidden>
            Autexa<span className="text-primary-500">.</span>
          </span>
        </a>

        {/* Якоря — только на desktop */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Разделы лендинга">
          {ANCHORS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-medium text-white/60 transition-colors hover:text-white"
            >
              {a.label}
            </a>
          ))}
        </nav>

        <Link
          to="/login"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-white/10 px-5 text-sm font-semibold text-white/90 transition-colors hover:border-white/25 hover:text-white"
        >
          Войти
        </Link>
      </div>
    </header>
  );
}
