import { ReactNode, useId, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { registrationApi } from '../api/services';
import { formatPhone, isValidPhone } from '../../../shared/validation/phone';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';

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
  const uid = useId();
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
      <div className="flex flex-col items-center py-4 text-center" role="status">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ok-soft">
          <CheckCircle2 className="h-7 w-7 text-ok" aria-hidden="true" />
        </span>
        <h3 className="text-md font-semibold text-ink">Заявка отправлена</h3>
        <p className="mb-6 mt-1 max-w-xs text-sm text-ink-3">
          Менеджер свяжется с вами, подключит вашу организацию и передаст доступы для входа.
        </p>
        {successActions}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <p className="text-sm leading-relaxed text-ink-3">
        Autexa предоставляется автосервисам — юридическим лицам и ИП. Оставьте заявку: менеджер свяжется, подключит вашу
        организацию и передаст доступы. Это не самостоятельная регистрация — доступ выдаёт менеджер.
      </p>

      <Field label="Название организации (автосервиса)" htmlFor={`${uid}-company`} required error={errors.company}>
        <Input
          id={`${uid}-company`}
          name="organization"
          autoComplete="organization"
          value={companyName}
          onChange={(e) => {
            setCompanyName(e.target.value);
            setErrors((p) => ({ ...p, company: undefined }));
          }}
          placeholder="ООО «Автосервис на Ленина» / ИП Иванов"
          invalid={!!errors.company}
          required
        />
      </Field>

      <Field label="Имя владельца / руководителя" htmlFor={`${uid}-owner`} required error={errors.owner}>
        <Input
          id={`${uid}-owner`}
          name="name"
          autoComplete="name"
          value={ownerName}
          onChange={(e) => {
            setOwnerName(e.target.value);
            setErrors((p) => ({ ...p, owner: undefined }));
          }}
          placeholder="Иванов Иван Иванович"
          invalid={!!errors.owner}
          required
        />
      </Field>

      <Field label="Телефон для связи" htmlFor={`${uid}-phone`} required error={errors.phone}>
        <Input
          id={`${uid}-phone`}
          name="tel"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          className="tabular-nums"
          value={phone}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            setPhone(formatPhone(digits));
            setErrors((p) => ({ ...p, phone: undefined }));
          }}
          placeholder="+7 (___) ___-__-__"
          invalid={!!errors.phone}
          required
        />
      </Field>

      <Field
        label="Комментарий"
        htmlFor={`${uid}-comment`}
        hint="Необязательно: город, количество мастеров, пожелания."
      >
        <Textarea
          id={`${uid}-comment`}
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Например: Казань, 4 поста, нужен склад"
        />
      </Field>

      {/* Согласия (152-ФЗ): обязательное на обработку ПДн + добровольное на рассылку */}
      <div className="space-y-2.5 pt-1">
        <Checkbox
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          label={
            <span className="text-xs leading-relaxed text-ink-3">
              Я согласен на обработку персональных данных в соответствии с{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'rounded font-medium text-accent-text underline underline-offset-2 hover:text-accent',
                  focusRing,
                )}
              >
                политикой конфиденциальности
              </a>
              <span className="ml-0.5 text-bad" aria-hidden="true">
                *
              </span>
            </span>
          }
        />
        <Checkbox
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
          label={
            <span className="text-xs leading-relaxed text-ink-3">
              Согласен получать информационные сообщения (необязательно)
            </span>
          }
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        {footerSecondary}
        <Button type="submit" disabled={!consent} loading={submitting}>
          Отправить заявку
        </Button>
      </div>
    </form>
  );
}
