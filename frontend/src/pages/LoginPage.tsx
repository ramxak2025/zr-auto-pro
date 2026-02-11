import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Wrench, Eye, EyeOff, LogIn, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { user, isLoading: authLoading, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      toast.error('Введите логин и пароль');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(trimmedUsername, password);
      toast.success('Добро пожаловать!');
    } catch (err: any) {
      const message =
        err?.response?.data?.message || 'Неверный логин или пароль';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 via-gray-50 to-blue-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-600 text-white mb-4 shadow-lg">
            <Wrench className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            ZR Auto Pro
          </h1>
          <p className="mt-1 text-gray-500 text-sm">CRM для автосервиса</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">
            Вход в систему
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Логин
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Введите логин"
                disabled={isSubmitting}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400
                  focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none
                  disabled:bg-gray-50 disabled:text-gray-500 transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Пароль
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль"
                  disabled={isSubmitting}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-11 text-gray-900 placeholder-gray-400
                    focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none
                    disabled:bg-gray-50 disabled:text-gray-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white
                hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <LogIn className="h-5 w-5" />
              )}
              {isSubmitting ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          ZR Auto Pro &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
