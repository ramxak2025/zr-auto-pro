import { ReactNode, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { registrationApi } from '../api/services';
import { formatPhone, isValidPhone } from '../../../shared/validation/phone';

interface FieldErrors {
  company?: string;
  owner?: string;
  phone?: string;
}

interface RegisterFormProps {
  /**
   * Secondary action rendered to the left of «Отправить заявку» in the form
   * footer — the modal passes a «Отмена» button, the standalone page passes a
   * «На главную» link. Omit to render a submit-only footer.
   */
  footerSecondary?: ReactNode;
  /**
   * Actions block shown under the confirmation message after a successful
   * submit — the modal passes «Вернуться ко входу», the page passes a link to /.
   */
  successActions: ReactNode;
  /**
   * Notifies the wrapping surface when the form flips to its success state so a
   * chrome outside the form (e.g. the Modal header title) can react.
   */
  onSubmittedChange?: (submitted: boolean) => void;
}

/**
 * «Заявка на подключение» — a credential-free B2B SALES LEAD form shared by BOTH
 * the login screen entry (`RegisterModal`) and the standalone `/register` page
 * (`RegisterPage`). This is NOT self-serve consumer signup and NOT account
 * creation: Autexa is sold only to organisations (юрлица/ИП). A prospective
 * autoservice leaves org name + contact name + phone (+ optional comment); on
 * approval a manager contacts them and issues access — there is no public
 * password field and no instant login.
 *
 * The moderated backend endpoint (`registrationApi.submit`, POST
 * /registration-requests) is UNCHANGED and still requires a `password` string in
 * its contract (`shared/api/types.ts` / backend DTO, min 8 chars). Since we no
 * longer collect a password from the visitor — and must not ship a predictable
 * placeholder — we satisfy that required field with a high-entropy random secret
 * the user never sees or sets (`generateRequestSecret`). It is stored server-side
 * as a bcrypt hash like before; the manager resets/issues the real credentials
 * when they approve and contact the organisation. Business errors (уже
 * зарегистрирован / заявка уже отправлена) surface via toast.
 *
 * Only the surrounding chrome and the two action slots (`footerSecondary`,
 * `successActions`) differ between the modal and the page — the fields,
 * validation and submit live here once.
 */

/**
 * A throwaway high-entropy secret (NOT a user-facing password) generated purely
 * to satisfy the moderated endpoint's required `password` field without exposing
 * an account-creation UI. Never displayed; never reused; the manager issues the
 * real credentials on approval.
 */
function generateRequestSecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(28);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export default function RegisterForm({ footerSecondary, successActions, onSubmittedChange }: RegisterFormProps) {
  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // 152-ФЗ: обязательное согласие на обработку персональных данных. Без него
  // заявку отправить нельзя (кнопка задизейблена). Маркетинговое согласие —
  // отдельное, добровольное, отправку не блокирует.
  const [consent, setConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!companyName.trim()) next.company = 'Укажите название организации';
    if (!ownerName.trim()) next.owner = 'Укажите имя владельца или руководителя';
    if (!isValidPhone(phone)) next.phone = 'Введите корректный телефон';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    // 152-ФЗ: без согласия на обработку ПДн заявку не отправляем. Кнопка и так
    // задизейблена — это защита от отправки по Enter.
    if (!consent) return;

    setSubmitting(true);
    try {
      // `password` is a throwaway secret to satisfy the moderated endpoint's
      // contract — the visitor never sets or sees a password. Access is issued
      // by a manager after approval.
      //
      // Маркетинговое согласие передаём менеджеру через штатное поле комментария —
      // API-контракт (shared) при этом не трогаем.
      const marketingNote = marketingConsent ? 'Согласие на информационные сообщения: да' : '';
      const fullComment = [comment.trim(), marketingNote].filter(Boolean).join('\n') || undefined;
      await registrationApi.submit({
        companyName: companyName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        password: generateRequestSecret(),
        comment: fullComment,
      });
      setSubmitted(true);
      onSubmittedChange?.(true);
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

  if (submitted) {
    return (
      <div className="flex flex-col items-center py-4 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-gray-900">Заявка отправлена</h3>
        <p className="mb-6 max-w-xs text-sm text-gray-500">
          Менеджер свяжется с вами, подключит вашу организацию и передаст доступы для входа.
        </p>
        {successActions}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-500">
        Autexa предоставляется автосервисам — юридическим лицам и ИП. Оставьте заявку: менеджер свяжется, подключит вашу
        организацию и передаст доступы. Это не самостоятельная регистрация — доступ выдаёт менеджер.
      </p>

      {/* Company — обязательное, бизнес-поле */}
      <div>
        <label className="label">
          Название организации (автосервиса) <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          required
          className={`input ${errors.company ? 'input-error' : ''}`}
          value={companyName}
          onChange={(e) => {
            setCompanyName(e.target.value);
            setErrors((p) => ({ ...p, company: undefined }));
          }}
          placeholder="ООО «Автосервис на Ленина» / ИП Иванов"
        />
        {errors.company && <p className="mt-1 text-xs text-red-600">{errors.company}</p>}
      </div>

      {/* Owner */}
      <div>
        <label className="label">
          Имя владельца / руководителя <span className="text-red-600">*</span>
        </label>
        <input
          type="text"
          required
          className={`input ${errors.owner ? 'input-error' : ''}`}
          value={ownerName}
          onChange={(e) => {
            setOwnerName(e.target.value);
            setErrors((p) => ({ ...p, owner: undefined }));
          }}
          placeholder="Иванов Иван Иванович"
        />
        {errors.owner && <p className="mt-1 text-xs text-red-600">{errors.owner}</p>}
      </div>

      {/* Phone — контакт для связи менеджера */}
      <div>
        <label className="label">
          Телефон для связи <span className="text-red-600">*</span>
        </label>
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
        {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
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

      {/* Consent (152-ФЗ) — обязательное согласие на обработку ПДн + добровольное на рассылку */}
      <div className="space-y-2.5 pt-1">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-xs leading-relaxed text-gray-500">
            Я согласен на обработку персональных данных в соответствии с{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-600 underline decoration-primary-300 underline-offset-2 hover:text-primary-700"
            >
              политикой конфиденциальности
            </a>
            <span className="text-red-600"> *</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={(e) => setMarketingConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-xs leading-relaxed text-gray-500">
            Согласен получать информационные сообщения (необязательно)
          </span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
        {footerSecondary}
        <button type="submit" disabled={submitting || !consent} className="btn-primary">
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
  );
}
