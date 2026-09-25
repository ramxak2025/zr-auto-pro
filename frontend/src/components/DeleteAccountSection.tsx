import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../api/services';
import { UserRole } from '../types';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { toneChip } from '../ui/tokens';
import Modal from './Modal';

/**
 * Удаление аккаунта из приложения (Apple Guideline 5.1.1(v) / Google Play).
 *
 * Живёт в разделе «Ещё» рядом с «Выйти». Самодостаточен: триггер опасной зоны,
 * подтверждение с повторным вводом пароля и вызов `POST /account/delete`.
 *
 * Ветки зеркалят бэкенд (account.service.ts):
 *   • director        → закрывает весь тенант (доступ отзывается сразу, данные
 *                       физически стираются через 30 дней);
 *   • admin / master  → собственная учётка анонимизируется и отключается сразу;
 *   • superadmin      → НЕ показывается: аккаунт оператора платформы из
 *                       приложения не удаляется (бэкенд ответит 403).
 *
 * При успехе — тот же путь, что «Выйти» (`logout()` из AuthContext): токен и
 * все кеши стираются, роутер уводит на /login.
 */
export default function DeleteAccountSection() {
  const { logout, isRole } = useAuth();
  const passwordId = useId();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => authApi.deleteAccount({ password, confirm: true }),
    onSuccess: () => {
      // Тот же off-boarding, что «Выйти»: токен + все кеши; App.tsx уводит на /login.
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

  // Аккаунт оператора платформы из приложения не удаляется — прячем действие
  // целиком, а не показываем кнопку, которая всегда отвечает 403.
  if (isRole(UserRole.SUPERADMIN)) return null;

  // Директор владеет тенантом; остальные (admin / master) удаляют только свою учётку.
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
      {/* Опасная зона */}
      <section aria-labelledby="delete-account-title" className="rounded-xl border border-bad/20 bg-bad-soft/40 p-5">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${toneChip.bad}`}>
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="delete-account-title" className="text-sm font-semibold text-ink">
              Удаление аккаунта
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              {isOwner
                ? 'Закрытие аккаунта компании. Доступ прекращается сразу, все данные удаляются безвозвратно через 30 дней.'
                : 'Удаление вашей учётной записи. Действие необратимо.'}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          icon={Trash2}
          fullWidth
          onClick={() => setOpen(true)}
          className="mt-4 text-bad-text hover:bg-bad-soft hover:text-bad-text"
        >
          Удалить аккаунт
        </Button>
      </section>

      {/* Подтверждение + повторная аутентификация */}
      <Modal
        isOpen={open}
        onClose={close}
        title="Удалить аккаунт?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
              Отмена
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={handleSubmit}
              disabled={!password.trim()}
              loading={mutation.isPending}
            >
              {isOwner ? 'Удалить компанию' : 'Удалить аккаунт'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-bad/20 bg-bad-soft p-4">
            <p className="text-sm font-medium text-bad-text">
              {isOwner ? 'Это закроет аккаунт всей компании.' : 'Это удалит вашу учётную запись.'}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-bad-text">
              {isOwner ? (
                <>
                  <li>Доступ к приложению закроется немедленно для всех сотрудников.</li>
                  <li>Чеки, склад, клиенты, касса и зарплаты будут удалены безвозвратно.</li>
                  <li>Данные физически стираются через 30 дней — отменить будет нельзя.</li>
                </>
              ) : (
                <>
                  <li>Ваша учётная запись будет удалена, доступ закроется сразу.</li>
                  <li>Восстановить вход после удаления нельзя.</li>
                </>
              )}
            </ul>
          </div>

          <Field label="Подтвердите паролем" htmlFor={passwordId} error={error}>
            <Input
              id={passwordId}
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
              invalid={!!error}
              aria-describedby={error ? `${passwordId}-error` : undefined}
              autoFocus
              rightSlot={
                <IconButton
                  label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  icon={showPassword ? EyeOff : Eye}
                  size="sm"
                  onClick={() => setShowPassword((v) => !v)}
                />
              }
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
