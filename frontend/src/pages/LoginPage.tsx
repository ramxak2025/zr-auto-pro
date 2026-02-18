import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Loader2, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  // Normalize: replace leading 8 with 7 for Russian numbers
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

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
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
      const message =
        error?.response?.data?.message || 'Неверный номер телефона или пароль';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800 px-4">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="card p-8 sm:p-10">
          {/* Logo */}
          <div className="flex justify-center mb-4">
            <img
              src="/logo.png"
              alt="Autexa"
              className="max-h-24 object-contain"
            />
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <p className="text-sm text-gray-500">
              Система управления сервисом
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Phone */}
            <div>
              <label htmlFor="phone" className="label">
                Номер телефона
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="+7 (XXX) XXX-XX-XX"
                  value={phone}
                  onChange={handlePhoneChange}
                  className={`input pl-10 ${phoneError ? 'input-error' : ''}`}
                />
              </div>
              {phoneError && (
                <p className="mt-1 text-sm text-red-600">{phoneError}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="label">
                Пароль
              </label>
              <input
                id="password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError('');
                }}
                className={`input ${passwordError ? 'input-error' : ''}`}
              />
              {passwordError && (
                <p className="mt-1 text-sm text-red-600">{passwordError}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full btn-lg"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Вход...
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  Войти
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Copyright */}
      <p className="mt-6 text-sm text-white/60">
        Autexa &copy; 2026
      </p>
    </div>
  );
}
