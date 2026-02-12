import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  Play,
  HardHat,
  Car,
  Warehouse,
  BarChart3,
  Users,
  Shield,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { demoUser, demoMasterUser } from '../demo/data';

export default function LoginPage() {
  const { user, isLoading: authLoading, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
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

  const handleDemoLogin = () => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('user', JSON.stringify(demoUser));
    toast.success('Добро пожаловать в демо-режим!');
    window.location.href = '/';
  };

  const handleDemoMasterLogin = () => {
    localStorage.setItem('demo', 'true');
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('user', JSON.stringify(demoMasterUser));
    toast.success('Демо-вход как мастер!');
    window.location.href = '/';
  };

  const features = [
    { icon: Car, title: 'Заказ-наряды', desc: 'Полный цикл обслуживания' },
    { icon: Users, title: 'CRM', desc: 'База клиентов и авто' },
    { icon: Warehouse, title: 'Склад', desc: 'Учёт запчастей' },
    { icon: BarChart3, title: 'Аналитика', desc: 'Финансы и KPI' },
    { icon: Shield, title: 'Контроль', desc: 'Роли и доступы' },
    { icon: Zap, title: 'Скорость', desc: 'Работает мгновенно' },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* ── Left: branding panel ── */}
      <div className="relative hidden lg:flex lg:w-[55%] flex-col justify-between bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-10 xl:p-14 overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl" />

        {/* Top: logo */}
        <div className="relative z-10">
          <img
            src="/logo-horizontal.png"
            alt="Autexa"
            className="h-12 object-contain brightness-0 invert"
          />
        </div>

        {/* Center: hero text + features */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight tracking-tight">
            Управляйте
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              автосервисом
            </span>
            <br />
            легко
          </h1>
          <p className="mt-5 text-lg text-gray-400 leading-relaxed max-w-md">
            Единая платформа для заказ-нарядов, склада, финансов и команды. Всё в одном месте.
          </p>

          {/* Feature pills */}
          <div className="mt-8 grid grid-cols-3 gap-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group flex flex-col items-center gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-4 backdrop-blur-sm hover:bg-white/[0.07] transition-colors"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                  <f.icon className="h-5 w-5" />
                </div>
                <p className="text-[13px] font-semibold text-white">{f.title}</p>
                <p className="text-[11px] text-gray-500 text-center leading-tight">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <p className="relative z-10 text-xs text-gray-600">
          Autexa &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* ── Right: login form ── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-10 lg:px-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-10 text-center lg:hidden">
            <img
              src="/logo-horizontal.png"
              alt="Autexa"
              className="h-10 mx-auto object-contain"
            />
            <p className="mt-2 text-sm text-gray-500">
              Система управления автосервисом
            </p>
          </div>

          {/* Welcome */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Войти в систему
            </h2>
            <p className="mt-1.5 text-sm text-gray-500">
              Введите данные для входа в аккаунт
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-[13px] font-medium text-gray-600 mb-2"
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
                className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-[15px] text-gray-900 placeholder-gray-400
                  focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:outline-none
                  disabled:bg-gray-100 disabled:text-gray-500 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-[13px] font-medium text-gray-600 mb-2"
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
                  className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 pr-12 text-[15px] text-gray-900 placeholder-gray-400
                    focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:outline-none
                    disabled:bg-gray-100 disabled:text-gray-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? (
                    <EyeOff className="h-[18px] w-[18px]" />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gray-900 px-4 py-3.5 text-[15px] font-semibold text-white
                hover:bg-gray-800 active:scale-[0.98]
                focus:outline-none focus:ring-4 focus:ring-gray-900/20
                disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Войти
                  <ArrowRight className="h-4.5 w-4.5" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-7">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-100" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-[12px] font-medium text-gray-400 uppercase tracking-wider">
                Демо-доступ
              </span>
            </div>
          </div>

          {/* Demo buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleDemoLogin}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-3.5 text-center
                hover:border-blue-200 hover:bg-blue-50/50 active:scale-[0.97]
                focus:outline-none transition-all group"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors">
                <Play className="h-4 w-4" />
              </div>
              <span className="text-[13px] font-semibold text-gray-900">Владелец</span>
              <span className="text-[11px] text-gray-400 leading-tight">Полный доступ</span>
            </button>
            <button
              type="button"
              onClick={handleDemoMasterLogin}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-3.5 text-center
                hover:border-green-200 hover:bg-green-50/50 active:scale-[0.97]
                focus:outline-none transition-all group"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-600 group-hover:bg-green-100 transition-colors">
                <HardHat className="h-4 w-4" />
              </div>
              <span className="text-[13px] font-semibold text-gray-900">Мастер</span>
              <span className="text-[11px] text-gray-400 leading-tight">Заказ-наряды</span>
            </button>
          </div>

          {/* Mobile footer */}
          <p className="text-center text-[11px] text-gray-400 mt-8 lg:hidden">
            Autexa &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
