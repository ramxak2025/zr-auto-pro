import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { LogIn, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

interface LoginFormData {
  username: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>();

  const onSubmit = async (data: LoginFormData) => {
    setSubmitting(true);
    try {
      await login(data.username, data.password);
      navigate('/', { replace: true });
    } catch (error: any) {
      const message =
        error?.response?.data?.message || 'Ошибка входа. Проверьте логин и пароль.';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800 px-4">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="card p-8 sm:p-10">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <img
              src="/logo.png"
              alt="Autexa"
              className="max-h-20 object-contain"
            />
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Autexa</h1>
            <p className="mt-2 text-sm text-gray-500">
              Система управления автосервисом
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Username */}
            <div>
              <label htmlFor="username" className="label">
                Имя пользователя
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="Введите логин"
                className={`input ${errors.username ? 'input-error' : ''}`}
                {...register('username', {
                  required: 'Введите имя пользователя',
                })}
              />
              {errors.username && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.username.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="label">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Введите пароль"
                className={`input ${errors.password ? 'input-error' : ''}`}
                {...register('password', {
                  required: 'Введите пароль',
                })}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.password.message}
                </p>
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
    </div>
  );
}
