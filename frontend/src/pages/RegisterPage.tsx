import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import RegisterForm from '../components/RegisterForm';

/**
 * Standalone self-service registration page (/register). Public — a logged-out
 * prospect reaches it directly from the landing's primary CTAs («Получить
 * доступ» / «Начать бесплатно»), so it lives outside the auth-gated routes in
 * App.tsx. It reuses the exact same `RegisterForm` as the login modal; only the
 * chrome (full-page light-brand shell) and the action links differ.
 *
 * Light landing theme: #FAFAFA background + light browser theme-color, both
 * restored on unmount so the authed app / login chrome isn't affected.
 */
export default function RegisterPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Регистрация — Autexa';

    const prevBodyBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#FAFAFA';
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') ?? null;
    themeMeta?.setAttribute('content', '#FAFAFA');

    window.scrollTo({ top: 0, behavior: 'instant' });

    return () => {
      document.title = prevTitle;
      document.body.style.backgroundColor = prevBodyBg;
      if (themeMeta && prevTheme !== null) themeMeta.setAttribute('content', prevTheme);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#FAFAFA] font-display text-slate-900 antialiased selection:bg-primary-500/20">
      {/* Мини-шапка: логотип → главная, «Войти» справа (как на /tarify, /voprosy) */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex min-h-[44px] items-center">
            <img
              src="/logo.png"
              alt="Autexa"
              width={116}
              height={28}
              loading="eager"
              decoding="async"
              className="h-7 w-auto"
            />
          </Link>
          <Link
            to="/login"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900"
          >
            Войти
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-lg flex-col px-4 pb-16 pt-8 sm:px-6 sm:pt-14">
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          На главную
        </Link>

        <div className="mt-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl text-balance">
            Подключить автосервис
          </h1>
          <p className="mt-2 text-base text-slate-600">
            Первые 14 дней — бесплатно, все возможности. Оставьте заявку — после одобрения войдёте под своим телефоном.
          </p>
        </div>

        {/* Карточка формы — общий RegisterForm со стилем приложения (input / btn-*) */}
        <div className="mt-6 rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm sm:p-8">
          <RegisterForm
            footerSecondary={
              <Link to="/" className="btn-secondary">
                Отмена
              </Link>
            }
            successActions={
              <div className="w-full space-y-3">
                <Link to="/login" className="btn-primary w-full">
                  Перейти ко входу
                </Link>
                <Link
                  to="/"
                  className="inline-flex min-h-[44px] w-full items-center justify-center text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
                >
                  Вернуться на главную
                </Link>
              </div>
            }
          />
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-semibold text-primary-600 transition-colors hover:text-primary-700">
            Войти
          </Link>
        </p>
      </main>
    </div>
  );
}
