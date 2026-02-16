import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  Car,
  Warehouse,
  BarChart3,
  Users,
  Shield,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import PhoneInput, { isPhoneComplete, getPhoneRaw } from '../components/PhoneInput';

export default function LoginPage() {
  const { user, isLoading: authLoading, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !isPhoneComplete(username)) {
      toast.error('Введите телефон полностью');
      return;
    }
    if (!password) {
      toast.error('Введите пароль');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(getPhoneRaw(username), password);
      toast.success('Добро пожаловать!');
    } catch (err: any) {
      const status = err?.response?.status;
      const raw = err?.response?.data?.message;
      let message: string;
      if (!err?.response || status >= 502) {
        message = 'Сервер недоступен. Попробуйте позже.';
      } else {
        message = Array.isArray(raw) ? raw[0] : raw || 'Неверный телефон или пароль';
      }
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
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
    <div className="min-h-screen flex flex-col lg:flex-row bg-white">
      {/* Desktop left panel */}
      <div className="relative hidden lg:flex lg:w-[55%] flex-col justify-between bg-gradient-to-br from-gray-50 via-white to-gray-100 p-10 xl:p-14 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-primary-200/30 blur-3xl animate-float" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-indigo-200/20 blur-3xl" />
        <div className="absolute top-1/2 left-1/3 h-64 w-64 rounded-full bg-blue-100/20 blur-3xl" />

        <div className="relative z-10 animate-fade-in">
          <img src="/logo.png" alt="Autexa" className="h-16 xl:h-20 w-auto max-w-full object-contain drop-shadow-md" />
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-4xl xl:text-5xl font-extrabold text-gray-900 leading-tight tracking-tight animate-fade-in-up">
            Управляйте<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-indigo-600">автосервисом</span><br />
            легко
          </h1>
          <p className="mt-5 text-lg text-gray-500 leading-relaxed max-w-md animate-fade-in-up [animation-delay:150ms]">
            Единая платформа для заказ-нарядов, склада, финансов и команды. Всё в одном месте.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3">
            {features.map((f, i) => (
              <div key={f.title} className="group flex flex-col items-center gap-2 rounded-2xl bg-white/80 border border-gray-200/60 p-4 backdrop-blur-sm hover:bg-white hover:shadow-sm transition-all animate-fade-in-up" style={{ animationDelay: `${200 + i * 80}ms` }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600 group-hover:bg-primary-100 transition-colors">
                  <f.icon className="h-5 w-5" />
                </div>
                <p className="text-[13px] font-semibold text-gray-900">{f.title}</p>
                <p className="text-[11px] text-gray-500 text-center leading-tight">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-gray-400 animate-fade-in [animation-delay:600ms]">
          Autexa &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* Mobile: logo */}
      <div className="lg:hidden flex flex-col items-center justify-center bg-white pt-6 pb-2">
        <div className="animate-scale-in w-full flex justify-center px-4">
          <img src="/logo.png" alt="Autexa" className="h-12 w-auto max-w-[90vw] object-contain drop-shadow-md" />
        </div>
        <p className="mt-2 text-sm text-gray-400 font-medium tracking-wide animate-fade-in [animation-delay:300ms]">
          Система управления автосервисом
        </p>
      </div>

      {/* Mobile: form */}
      <div className="lg:hidden flex-1 relative">
        <div className="h-6 bg-gradient-to-b from-white to-gray-50" />
        <div className="bg-gray-50 px-6 pb-8">
          <div className="animate-fade-in-up [animation-delay:200ms] max-w-sm mx-auto bg-white rounded-2xl shadow-lg shadow-gray-200/60 border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Вход в систему</h2>
            <p className="mt-1 text-[13px] text-gray-500 mb-5">Введите телефон и пароль</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-[13px] font-medium text-gray-600 mb-1.5">Телефон</label>
                <PhoneInput
                  value={username}
                  onChange={setUsername}
                  className="block w-full rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-[15px] text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/10 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500 transition-all"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-[13px] font-medium text-gray-600 mb-1.5">Пароль</label>
                <div className="relative">
                  <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Введите пароль" disabled={isSubmitting}
                    className="block w-full rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 pr-12 text-[15px] text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/10 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500 transition-all" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-primary-600/25 hover:from-primary-500 hover:to-primary-600 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-primary-500/25 disabled:opacity-60 disabled:cursor-not-allowed transition-all">
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><ArrowRight className="h-[18px] w-[18px]" />Войти</>}
              </button>
            </form>
          </div>
          <p className="text-center text-[11px] text-gray-400 mt-6 animate-fade-in [animation-delay:600ms]">
            Autexa &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>

      {/* Desktop: login form */}
      <div className="hidden lg:flex flex-1 flex-col items-center justify-center bg-white px-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 animate-fade-in-down">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Войти в систему</h2>
            <p className="mt-1.5 text-sm text-gray-500">Введите телефон и пароль</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 animate-fade-in-up [animation-delay:100ms]">
            <div>
              <label htmlFor="username-desktop" className="block text-[13px] font-medium text-gray-600 mb-2">Телефон</label>
              <PhoneInput
                value={username}
                onChange={setUsername}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-[15px] text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/10 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="password-desktop" className="block text-[13px] font-medium text-gray-600 mb-2">Пароль</label>
              <div className="relative">
                <input id="password-desktop" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Введите пароль" disabled={isSubmitting}
                  className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 pr-12 text-[15px] text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/10 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500 transition-all" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-slate-800 to-slate-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-slate-900/20 hover:from-slate-700 hover:to-slate-800 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-slate-900/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all">
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><ArrowRight className="h-[18px] w-[18px]" />Войти</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
