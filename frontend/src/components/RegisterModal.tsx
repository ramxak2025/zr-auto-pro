import { useState } from 'react';
import { Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { registrationApi } from '../api/services';
import { formatPhone, isValidPhone } from '../../../shared/validation/phone';

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FieldErrors {
  company?: string;
  owner?: string;
  phone?: string;
  password?: string;
}

/**
 * Self-service registration (migration 123). Opened from the login screen — the
 * prospective autoservice owner submits an UNAUTHENTICATED request. On success we
 * flip to a confirmation state (no auto-login: the account exists only after a
 * superadmin approves). Backend business errors (уже зарегистрирован / заявка уже
 * отправлена) surface via toast from `err.response.data.message`.
 */
export default function RegisterModal({ isOpen, onClose }: RegisterModalProps) {
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [comment, setComment] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const resetAll = () => {
    setCompanyName('');
    setOwnerName('');
    setPhone('');
    setPassword('');
    setComment('');
    setShowPassword(false);
    setSubmitting(false);
    setSubmitted(false);
    setErrors({});
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!companyName.trim()) next.company = 'Введите название автосервиса';
    if (!ownerName.trim()) next.owner = 'Введите имя владельца';
    if (!isValidPhone(phone)) next.phone = 'Введите корректный телефон';
    if (password.length < 8) next.password = 'Минимум 8 символов';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await registrationApi.submit({
        companyName: companyName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        password,
        comment: comment.trim() || undefined,
      });
      setSubmitted(true);
    } catch (error: any) {
      if (error.code === 'ERR_NETWORK' || !error.response) {
        toast.error('Сервер недоступен! Проверьте подключение.');
      } else {
        toast.error(error.response?.data?.message || 'Не удалось отправить заявку. Попробуйте позже.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={submitted ? 'Заявка отправлена' : 'Регистрация автосервиса'}
      size="md"
    >
      {submitted ? (
        <div className="flex flex-col items-center py-4 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-gray-900">Заявка отправлена</h3>
          <p className="mb-6 max-w-xs text-sm text-gray-500">
            После одобрения вы сможете войти под своим телефоном и паролем.
          </p>
          <button type="button" onClick={handleClose} className="btn-primary w-full">
            Вернуться ко входу
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Оставьте заявку — после одобрения вы получите доступ к системе под указанным телефоном.
          </p>

          {/* Company */}
          <div>
            <label className="label">Название автосервиса</label>
            <input
              type="text"
              className={`input ${errors.company ? 'input-error' : ''}`}
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                setErrors((p) => ({ ...p, company: undefined }));
              }}
              placeholder="Автосервис на Ленина"
            />
            {errors.company && <p className="mt-1 text-xs text-red-500">{errors.company}</p>}
          </div>

          {/* Owner */}
          <div>
            <label className="label">Имя владельца</label>
            <input
              type="text"
              className={`input ${errors.owner ? 'input-error' : ''}`}
              value={ownerName}
              onChange={(e) => {
                setOwnerName(e.target.value);
                setErrors((p) => ({ ...p, owner: undefined }));
              }}
              placeholder="Иванов Иван Иванович"
            />
            {errors.owner && <p className="mt-1 text-xs text-red-500">{errors.owner}</p>}
          </div>

          {/* Phone */}
          <div>
            <label className="label">Телефон (логин для входа)</label>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              className={`input tabular-nums ${errors.phone ? 'input-error' : ''}`}
              value={phone}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setPhone(formatPhone(digits));
                setErrors((p) => ({ ...p, phone: undefined }));
              }}
              placeholder="+7 (___) ___-__-__"
            />
            {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="label">Пароль</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`input pr-11 ${errors.password ? 'input-error' : ''}`}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((p) => ({ ...p, password: undefined }));
                }}
                placeholder="Минимум 8 символов"
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
            {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
          </div>

          {/* Comment (optional) */}
          <div>
            <label className="label">Комментарий (необязательно)</label>
            <textarea
              className="input"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Город, количество мастеров, пожелания…"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
            <button type="button" onClick={handleClose} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Отправка…
                </>
              ) : (
                'Отправить заявку'
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
