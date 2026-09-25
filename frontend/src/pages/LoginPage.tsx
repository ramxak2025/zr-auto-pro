import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, Eye, EyeOff, Lock, Package, Phone, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import type { LoginStepResult } from '../contexts/AuthContext';
import { formatPhone } from '../../../shared/validation/phone';
import RegisterModal from '../components/RegisterModal';
import LoginPointSelect from '../components/LoginPointSelect';
import {
  isSelectTokenExpired,
  resolveSelectPointFailure,
  SELECT_TOKEN_EXPIRED,
} from '../../../shared/utils/loginPointSelection';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';

/** Ожидающий выбор филиала — второй шаг входа (163). */
type PendingPointSelection = Extract<LoginStepResult, { status: 'point-required' }>;

// Что видит владелец слева от формы: не маркетинг, а карта того, куда он входит.
const PRODUCT_POINTS = [
  { icon: Receipt, title: 'Касса и заказ-наряды', text: 'Чек за минуту, отложенные работы, история по каждому авто.' },
  { icon: Package, title: 'Склад и закупки', text: 'Остатки, движения и заказы поставщикам — без тетрадей.' },
  { icon: Coins, title: 'Зарплата и отчёты', text: 'Проценты мастеров считаются сами; прибыль видна каждый день.' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithPoint, sessionEndedNotice, clearSessionEndedNotice } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // ── Второй шаг входа: выбор филиала (163) ────────────────────────────────
  // Пока здесь не null, страница показывает НЕ форму, а выбор филиала. Сессии
  // в этот момент ещё нет: на руках только промежуточный токен на пять минут.
  const [pendingPoints, setPendingPoints] = useState<PendingPointSelection | null>(null);
  const [submittingPointId, setSubmittingPointId] = useState<string | null>(null);

  // Сессию погасили не по истечению токена, а потому что филиал закрыли или
  // сняли доступ (163). Человек обязан узнать ПРИЧИНУ: иначе «меня выкинуло»
  // выглядит как поломка, и он звонит владельцу вместо того, чтобы войти в
  // доступный филиал. Показываем один раз и гасим.
  useEffect(() => {
    if (!sessionEndedNotice) return;
    toast.error(sessionEndedNotice, { duration: 10000 });
    clearSessionEndedNotice();
  }, [sessionEndedNotice, clearSessionEndedNotice]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, '');
    setPhone(formatPhone(digits));
    setPhoneError('');
  };

  /**
   * Разбор отказов ШАГА 1 — общий для «Войти» и для повторного запроса списка
   * филиалов (когда доступ сняли между шагами).
   */
  const showLoginError = (error: any) => {
    if (error.code === 'ERR_NETWORK' || !error.response) {
      toast.error('Сервер недоступен! Проверьте подключение.');
    } else if (error.response?.status === 401) {
      toast.error(error.response?.data?.message || 'Неверный телефон или пароль');
    } else {
      toast.error(`Ошибка сервера: ${error.response?.status}. Попробуйте позже.`);
    }
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
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(phone, password);
      // Доступен ровно один филиал (или филиалов нет вовсе) — сессия уже
      // создана, уходим на главную. Иначе показываем второй шаг.
      if (result.status === 'point-required') {
        setPendingPoints(result);
      } else {
        navigate('/', { replace: true });
      }
    } catch (error: any) {
      showLoginError(error);
    } finally {
      setSubmitting(false);
    }
  };

  /** Вернуться с выбора филиала к телефону и паролю: промежуточный токен бросаем. */
  const backToCredentials = () => {
    setPendingPoints(null);
    setSubmittingPointId(null);
  };

  /**
   * ШАГ 2: обменять выбранный филиал на сессию.
   *
   * Промежуточный токен ОДНОРАЗОВЫЙ, поэтому здесь ровно три исхода, и каждый
   * обязан вести человека дальше, а не оставлять его на экране с ошибкой:
   * начать вход заново, перевыбрать из обновлённого списка или повторить тот
   * же выбор. Правило — в shared/utils/loginPointSelection.ts.
   */
  const handleSelectPoint = async (pointId: string) => {
    const pending = pendingPoints;
    if (!pending || submittingPointId) return;

    // Токен уже мёртв по времени — не платим ожиданием за заведомо отказной
    // запрос, особенно на плохой связи.
    if (isSelectTokenExpired(pending.expiresAt)) {
      backToCredentials();
      toast.error(SELECT_TOKEN_EXPIRED.message, { duration: 8000 });
      return;
    }

    setSubmittingPointId(pointId);
    try {
      await loginWithPoint(pending.selectToken, pointId);
      navigate('/', { replace: true });
      return;
    } catch (error: any) {
      const failure = resolveSelectPointFailure(error);
      if (failure.action === 'restart') {
        backToCredentials();
        toast.error(failure.message, { duration: 8000 });
        return;
      }
      if (failure.action === 'refresh') {
        // Доступ к филиалу сняли между шагами. Промежуточный токен сервер при
        // этом НЕ гасит, но список филиалов устарел — перезапрашиваем его
        // шагом 1 (пароль ещё в поле), чтобы человек выбрал из оставшихся.
        try {
          const again = await login(phone, password);
          if (again.status === 'point-required') {
            setPendingPoints(again);
            toast.error(failure.message, { duration: 8000 });
          } else {
            // Остался ровно один доступный филиал — сервер сразу выдал сессию,
            // и говорить больше нечего: человек уже внутри.
            navigate('/', { replace: true });
          }
        } catch (retryError: any) {
          backToCredentials();
          showLoginError(retryError);
        }
        return;
      }
      // 'stay' — сеть или 5xx: токен цел, повтор тем же выбором законен.
      toast.error(failure.message, { duration: 8000 });
    } finally {
      setSubmittingPointId(null);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-canvas lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Левая панель — та же тёмная «рельса», что и боковая навигация внутри:
          вход выглядит как первый экран того же инструмента, а не как лендинг. */}
      <aside
        className="hidden flex-col justify-between bg-rail px-12 py-10 text-rail-text lg:flex"
        aria-label="О продукте"
      >
        <a
          href="https://autexa.pw"
          className={cn(
            'inline-flex w-fit items-center gap-2.5 rounded-lg',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-rail',
          )}
        >
          <img src="/logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg object-contain" />
          <span className="text-lg font-bold tracking-tight text-white">Autexa</span>
        </a>

        <div className="max-w-md">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-rail-muted">
            Система управления автосервисом
          </p>
          <h2 className="mt-3 text-3xl font-semibold leading-[1.15] tracking-[-0.015em] text-white">
            Касса, склад и зарплата — в одном окне
          </h2>
          <ul className="mt-8 space-y-5">
            {PRODUCT_POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex items-start gap-3.5">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{p.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-rail-text">{p.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-xs text-rail-muted">© 2026 Autexa · Autexa v2.1</p>
      </aside>

      {/* Правая часть — форма на холсте */}
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-[400px]">
          {/* Логотип показываем над карточкой там, где нет левой панели */}
          <div className="mb-6 flex justify-center lg:hidden">
            <img src="/logo.png" alt="Autexa" className="h-10 w-auto object-contain" />
          </div>

          <Card padding="none" className="px-6 py-7 sm:px-8 sm:py-8">
            {/* ШАГ 2 (163): пароль принят, но сессии ещё нет — сначала филиал.
                Форма при этом не размонтируется «в никуда»: телефон и пароль
                остаются в состоянии страницы, чтобы кнопка «Назад» вернула их
                заполненными, а повторный запрос списка филиалов (доступ сняли
                между шагами) прошёл без набора пароля заново. */}
            {pendingPoints ? (
              <LoginPointSelect
                points={pendingPoints.points}
                defaultPointId={pendingPoints.defaultPointId}
                submittingPointId={submittingPointId}
                onSelect={handleSelectPoint}
                onBack={backToCredentials}
              />
            ) : (
              <>
                <h1 className="text-title text-ink">Вход</h1>
                <p className="mt-1 text-sm text-ink-3">Телефон и пароль сотрудника автосервиса</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                  <Field label="Телефон" htmlFor="phone" error={phoneError || undefined}>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="+7 (___) ___-__-__"
                      value={phone}
                      onChange={handlePhoneChange}
                      leftIcon={Phone}
                      invalid={!!phoneError}
                      aria-describedby={phoneError ? 'phone-error' : undefined}
                      className="h-11 text-base tabular-nums"
                    />
                  </Field>

                  <Field label="Пароль" htmlFor="password" error={passwordError || undefined}>
                    <Input
                      id="password"
                      name="password"
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Введите пароль"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setPasswordError('');
                      }}
                      leftIcon={Lock}
                      invalid={!!passwordError}
                      aria-describedby={passwordError ? 'password-error' : undefined}
                      className="h-11 pr-12 text-base"
                      rightSlot={
                        <IconButton
                          label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                          icon={showPassword ? EyeOff : Eye}
                          size="sm"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-pressed={showPassword}
                          className="pointer-events-auto"
                        />
                      }
                    />
                  </Field>

                  <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-2">
                    Войти
                  </Button>
                </form>

                {/* Заявка на подключение — B2B, вторичное действие */}
                <p className="mt-6 text-center text-sm text-ink-3">
                  Подключить автосервис?{' '}
                  <button
                    type="button"
                    onClick={() => setRegisterOpen(true)}
                    className={cn('rounded font-medium text-accent-text hover:underline', focusRing)}
                  >
                    Оставить заявку
                  </button>
                </p>
              </>
            )}
          </Card>

          <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-3">
            <a
              href="https://autexa.pw/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className={cn('rounded hover:text-ink', focusRing)}
            >
              Политика конфиденциальности
            </a>
            <span className="text-ink-4" aria-hidden="true">
              ·
            </span>
            <a
              href="https://autexa.pw/terms"
              target="_blank"
              rel="noopener noreferrer"
              className={cn('rounded hover:text-ink', focusRing)}
            >
              Условия использования
            </a>
            <span className="w-full text-center text-ink-4 lg:hidden">Autexa v2.1 © 2026</span>
          </footer>
        </div>
      </main>

      <RegisterModal isOpen={registerOpen} onClose={() => setRegisterOpen(false)} />
    </div>
  );
}
