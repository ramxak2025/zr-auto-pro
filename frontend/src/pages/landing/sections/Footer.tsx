import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="border-t border-slate-200/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6">
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <img
            src="/logo-icon.png"
            alt=""
            width={24}
            height={24}
            loading="lazy"
            decoding="async"
            className="h-6 w-6 rounded-md"
          />
          Autexa © 2026
        </p>
        <nav className="flex items-center gap-1" aria-label="Ссылки внизу страницы">
          <Link
            to="/privacy"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-slate-500 transition-colors hover:text-slate-900"
          >
            Конфиденциальность
          </Link>
          <Link
            to="/terms"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-slate-500 transition-colors hover:text-slate-900"
          >
            Условия
          </Link>
          <Link
            to="/login"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
          >
            Войти
          </Link>
        </nav>
      </div>
    </footer>
  );
}
