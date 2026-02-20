import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Phone, Lock, Eye, EyeOff, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';

function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 0 && digits[0] === '8') {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 0) return '';
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

type ApiStatus = 'checking' | 'ok' | 'error' | 'db_error';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [apiDetails, setApiDetails] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  // Проверяем доступность API при загрузке страницы
  useEffect(() => {
    const checkApi = async () => {
      try {
        const res = await api.get('/health/db');
        const data = res.data;
        if (data.db === 'OK' && data.users?.length > 0) {
          const adminOk = data.admin_check?.includes('OK');
          if (adminOk) {
            setApiStatus('ok');
            setApiDetails(`Сервер работает. Пользователей: ${data.users.length}`);
          } else {
            setApiStatus('db_error');
            setApiDetails(`Сервер работает, но проблема с паролями. Подробности: ${data.admin_check || 'нет данных'}`);
          }
        } else if (data.db === 'OK') {
          setApiStatus('db_error');
          setApiDetails('Сервер работает, но в базе нет пользователей. Seed не выполнился.');
        } else {
          setApiStatus('db_error');
          setApiDetails(`Проблема с базой данных: ${data.db}`);
        }
      } catch (err: any) {
        setApiStatus('error');
        if (err.code === 'ERR_NETWORK' || !err.response) {
          setApiDetails('Сервер недоступен. Бэкенд не запущен или nginx не проксирует /api.');
        } else {
          setApiDetails(`Ошибка API: ${err.response?.status} ${err.response?.statusText || ''}`);
        }
      }
    };
    checkApi();
  }, []);

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
            <img
              src="/logo.png"
              alt="Autexa"
              className="h-16 w-auto object-contain"
            />
          </div>

          {/* Subtitle */}
          <p className="text-center text-sm text-gray-400 mb-10 tracking-wide">
            Система управления сервисом
          </p>

          {/* API Status indicator */}
          {apiStatus !== 'ok' && (
            <div className={`mb-4 p-3 rounded-xl text-sm flex items-start gap-2 ${
              apiStatus === 'checking' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
              apiStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
              'bg-yellow-50 text-yellow-700 border border-yellow-200'
            }`}>
              {apiStatus === 'checking' ? (
                <Loader2 className="h-4 w-4 mt-0.5 animate-spin flex-shrink-0" />
              ) : apiStatus === 'error' ? (
                <WifiOff className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              )}
              <span>{apiStatus === 'checking' ? 'Проверяю сервер...' : apiDetails}</span>
            </div>
          )}

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
              {phoneError && (
                <p className="mt-1.5 text-xs text-red-500">{phoneError}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
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
                  {showPassword ? (
                    <EyeOff className="h-[18px] w-[18px]" />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" />
                  )}
                </button>
              </div>
              {passwordError && (
                <p className="mt-1.5 text-xs text-red-500">{passwordError}</p>
              )}
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

          {/* Demo access buttons */}
          <div className="mt-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">Демо-доступ</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    await login('+7 (000) 000-00-01', 'demo123');
                    navigate('/', { replace: true });
                  } catch (err: any) {
                    if (err.code === 'ERR_NETWORK' || !err.response) {
                      toast.error('Сервер недоступен!');
                    } else {
                      toast.error(`Ошибка демо-входа: ${err.response?.data?.message || err.response?.status}`);
                    }
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="flex-1 py-3 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 text-sm font-medium rounded-xl border border-emerald-200 transition-all duration-200 disabled:opacity-50"
              >
                Владелец
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    await login('+7 (000) 000-00-02', 'demo123');
                    navigate('/', { replace: true });
                  } catch (err: any) {
                    if (err.code === 'ERR_NETWORK' || !err.response) {
                      toast.error('Сервер недоступен!');
                    } else {
                      toast.error(`Ошибка демо-входа: ${err.response?.data?.message || err.response?.status}`);
                    }
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="flex-1 py-3 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 text-sm font-medium rounded-xl border border-blue-200 transition-all duration-200 disabled:opacity-50"
              >
                Мастер
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Copyright footer */}
      <div className="pb-8 pt-4">
        <p className="text-center text-xs text-gray-300">
          Autexa v1.1 &copy; 2026
        </p>
      </div>
    </div>
  );
}
