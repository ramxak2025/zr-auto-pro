import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2, AlertTriangle, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../api/services';
import { UserRole } from '../types';
import Modal from './Modal';

/**
 * In-app account deletion (Apple Guideline 5.1.1(v) / Google Play data-deletion).
 *
 * Rendered in the «Ещё» settings area next to «Выйти». Self-contained: owns the
 * danger-zone trigger, the destructive confirmation modal, password re-entry and
 * the call to `POST /account/delete`.
 *
 * Branches mirror the backend (account.service.ts):
 *   • director           → closes the whole tenant (access revoked now, residual
 *                          data physically purged after a 30-day grace window).
 *   • admin / master     → own account anonymized + retired immediately.
 *   • superadmin         → NOT shown: the platform-operator account is not
 *                          deletable from the app (backend returns 403).
 *
 * On success we reuse the exact «Выйти» path (`logout()` from AuthContext) which
 * clears the token + every cache layer; the router then redirects to /login.
 */
export default function DeleteAccountSection() {
  const { logout, isRole } = useAuth();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => authApi.deleteAccount({ password, confirm: true }),
    onSuccess: () => {
      // Same off-boarding path as «Выйти»: clears token + all caches; the route
      // guard in App.tsx then redirects to /login. Don't duplicate that logic.
      logout();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string } } };
      const status = e?.response?.status;
      if (status === 401) {
        setError('Неверный пароль. Проверьте и попробуйте снова.');
      } else if (status === 403) {
        setError(e?.response?.data?.message || 'Этот аккаунт нельзя удалить из приложения.');
      } else {
        setError('Не удалось удалить аккаунт. Попробуйте позже.');
      }
    },
  });

  // Platform operator account is not deletable in-app — hide the action entirely
  // rather than show a button that always 403s. (After all hooks, per
  // rules-of-hooks.)
  if (isRole(UserRole.SUPERADMIN)) return null;

  // Director owns the tenant; everyone else (admin / master) removes only their
  // own employee record.
  const isOwner = isRole(UserRole.DIRECTOR);

  const reset = () => {
    setPassword('');
    setShowPassword(false);
    setError(null);
  };

  const close = () => {
    if (mutation.isPending) return;
    setOpen(false);
    reset();
  };

  const handleSubmit = () => {
    if (!password.trim() || mutation.isPending) return;
    setError(null);
    mutation.mutate();
  };

  return (
    <>
      {/* Danger zone */}
      <div className="rounded-2xl border border-red-100 bg-red-50/40 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-100">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Удаление аккаунта</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {isOwner
                ? 'Закрытие аккаунта компании. Доступ прекращается сразу, все данные удаляются безвозвратно через 30 дней.'
                : 'Удаление вашей учётной записи. Действие необратимо.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 active:bg-red-100"
        >
          <Trash2 className="h-4 w-4" />
          Удалить аккаунт
        </button>
      </div>

      {/* Confirmation + re-authentication */}
      <Modal isOpen={open} onClose={close} title="Удалить аккаунт?" size="sm">
        <div className="space-y-4">
          <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
            <p className="text-sm font-medium text-red-700">
              {isOwner ? 'Это закроет аккаунт всей компании.' : 'Это удалит вашу учётную запись.'}
            </p>
            {isOwner ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-600/90">
                <li>Доступ к приложению закроется немедленно для всех сотрудников.</li>
                <li>Чеки, склад, клиенты, касса и зарплаты будут удалены безвозвратно.</li>
                <li>Данные физически стираются через 30 дней — отменить будет нельзя.</li>
              </ul>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-600/90">
                <li>Ваша учётная запись будет удалена, доступ закроется сразу.</li>
                <li>Восстановить вход после удаления нельзя.</li>
              </ul>
            )}
          </div>

          <div>
            <label htmlFor="delete-account-password" className="mb-1 block text-xs font-medium text-gray-600">
              Подтвердите паролем
            </label>
            <div className="relative">
              <input
                id="delete-account-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
                placeholder="Ваш текущий пароль"
                disabled={mutation.isPending}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 pr-11 text-sm outline-none transition-all focus:border-red-300 focus:ring-1 focus:ring-red-200 disabled:opacity-60"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-600"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>
            {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={close} disabled={mutation.isPending} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!password.trim() || mutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isOwner ? 'Удалить компанию' : 'Удалить аккаунт'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
