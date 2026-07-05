import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6">
        <p className="text-sm text-white/50">Autexa © 2026</p>
        <nav className="flex items-center gap-1" aria-label="Ссылки внизу страницы">
          <Link
            to="/privacy"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-white/50 transition-colors hover:text-white"
          >
            Конфиденциальность
          </Link>
          <Link
            to="/terms"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm text-white/50 transition-colors hover:text-white"
          >
            Условия
          </Link>
          <Link
            to="/login"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-white/70 transition-colors hover:text-white"
          >
            Войти
          </Link>
        </nav>
      </div>
    </footer>
  );
}
