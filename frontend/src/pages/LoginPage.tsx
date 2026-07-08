import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Phone, Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { formatPhone } from '../../../shared/validation/phone';
import RegisterModal from '../components/RegisterModal';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, '');
    setPhone(formatPhone(digits));
    setPhoneError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError('');
    setPasswordError('');

    if (!phone.trim()) {
      setPhoneError('Введите номер телефона');
      return;
    }
    if (!password.trim()) {
      setPasswordError('Введите пароль');
      return;
    }

    setSubmitting(true);
    try {
      await login(phone, password);
      navigate('/', { replace: true });
    } catch (error: any) {
      if (error.code === 'ERR_NETWORK' || !error.response) {
        toast.error('Сервер недоступен! Проверьте подключение.');
      } else if (error.response?.status === 401) {
        toast.error(error.response?.data?.message || 'Неверный телефон или пароль');
      } else {
        toast.error(`Ошибка сервера: ${error.response?.status}. Попробуйте позже.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex justify-center mb-3">
            <img src="/logo.png" alt="Autexa" className="h-16 w-auto object-contain" />
          </div>

          {/* Subtitle */}
          <p className="text-center text-sm text-gray-400 mb-10 tracking-wide">Система управления сервисом</p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Телефон
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Phone className="h-[18px] w-[18px] text-gray-400" />
                </div>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="+7 (___) ___-__-__"
                  value={phone}
                  onChange={handlePhoneChange}
                  className={`w-full pl-11 pr-4 py-3.5 text-[15px] bg-gray-50 border rounded-xl text-gray-900 placeholder-gray-400 transition-all focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                    phoneError ? 'border-red-400 bg-red-50/50' : 'border-gray-200'
                  }`}
                />
              </div>
              {phoneError && <p className="mt-1.5 text-xs text-red-500">{phoneError}</p>}
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2"
              >
                Пароль
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-[18px] w-[18px] text-gray-400" />
                </div>
                <input
                  id="password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Введите пароль"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                  className={`w-full pl-11 pr-12 py-3.5 text-[15px] bg-gray-50 border rounded-xl text-gray-900 placeholder-gray-400 transition-all focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${
                    passwordError ? 'border-red-400 bg-red-50/50' : 'border-gray-200'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
              {passwordError && <p className="mt-1.5 text-xs text-red-500">{passwordError}</p>}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white text-[15px] font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Вход...</span>
                </>
              ) : (
                <span>Войти</span>
              )}
            </button>
          </form>

          {/* Registration entry point — secondary, unobtrusive */}
          <div className="mt-6 text-center">
            <span className="text-sm text-gray-400">Нет аккаунта? </span>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700"
            >
              Регистрация
            </button>
          </div>
        </div>
      </div>

      <RegisterModal isOpen={registerOpen} onClose={() => setRegisterOpen(false)} />

      {/* Copyright footer */}
      <div className="pb-8 pt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <a
            href="https://autexa.pw/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 transition-colors"
          >
            Политика конфиденциальности
          </a>
          <span className="text-gray-300">·</span>
          <a
            href="https://autexa.pw/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 transition-colors"
          >
            Условия использования
          </a>
        </div>
        <p className="text-center text-xs text-gray-300">Autexa v2.1 &copy; 2026</p>
      </div>
    </div>
  );
}
