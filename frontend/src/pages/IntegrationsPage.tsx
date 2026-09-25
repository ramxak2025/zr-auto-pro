import { ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, CreditCard, Info, Link2, PhoneCall, Plug, Receipt, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';

import { fiscalApi, paymentsApi, telephonyApi, walletApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  IconButton,
  Input,
  PageHeader,
  QueryState,
  Select,
  Switch,
  Tabs,
  Textarea,
} from '../ui';
import type { TabItem } from '../ui';
import { useUnsavedGuard } from '../components/company/StickySaveBar';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import type {
  FiscalSettings,
  FiscalSno,
  FiscalVat,
  PaymentIntegrationSettings,
  PaymentProviderName,
  TelephonySettings,
  WalletSettings,
} from '../types';

type IntegrationTab = 'acquiring' | 'fiscal' | 'telephony' | 'wallet';

const TAB_ITEMS: TabItem<IntegrationTab>[] = [
  { key: 'acquiring', label: 'Эквайринг', icon: CreditCard },
  { key: 'fiscal', label: 'Онлайн-касса', icon: Receipt },
  { key: 'telephony', label: 'Телефония', icon: PhoneCall },
  { key: 'wallet', label: 'Apple Wallet', icon: Wallet },
];

const HINT = 'Ключи — в личном кабинете провайдера; до ввода функция неактивна.';

/** Подсказка под заголовком карточки с иконкой. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-ink-3">
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Метка «ключ/сертификат сохранён» — тон по смыслу: есть → ok, нет → нейтрально. */
function StoredBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge tone={ok ? 'ok' : 'neutral'} dot size="sm">
      {label}
    </Badge>
  );
}

/** Подвал карточки с кнопкой сохранения — появляется только при правках. */
function SaveFooter({
  dirty,
  saving,
  onSave,
  label,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  label: string;
}) {
  if (!dirty) return null;
  return (
    <CardFooter>
      <span className="text-xs text-ink-3">Изменения не сохранены</span>
      <Button onClick={onSave} loading={saving}>
        {label}
      </Button>
    </CardFooter>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Эквайринг (карта / СБП)
// ──────────────────────────────────────────────────────────────────────────

const PAYMENT_PROVIDERS: { value: PaymentProviderName; label: string }[] = [
  { value: 'yookassa', label: 'ЮKassa' },
  { value: 'tinkoff', label: 'Тинькофф' },
];

function AcquiringCard() {
  const queryClient = useQueryClient();
  const idBase = useId();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<PaymentIntegrationSettings>({
    queryKey: ['payments', 'settings'],
    queryFn: async () => (await paymentsApi.getSettings()).data,
  });

  const [form, setForm] = useState<{
    provider: PaymentProviderName;
    enabled: boolean;
    shopId: string;
    secretKey: string;
  }>({ provider: 'yookassa', enabled: false, shopId: '', secretKey: '' });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  useEffect(() => {
    if (settings) {
      setForm({
        provider: settings.provider,
        enabled: settings.enabled,
        shopId: settings.shopId ?? '',
        secretKey: '',
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { provider?: PaymentProviderName; enabled?: boolean; shopId?: string; secretKey?: string }) =>
      paymentsApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['payments', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['payments', 'settings'] });
      toast.success('Эквайринг сохранён');
      setDirty(false);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: { provider?: PaymentProviderName; enabled?: boolean; shopId?: string; secretKey?: string } = {
      provider: form.provider,
      enabled: form.enabled,
      shopId: form.shopId.trim(),
    };
    // Секрет отправляем только когда ввели новый — пустое поле значит «оставить
    // сохранённый ключ» (в поле всегда только маска).
    const secret = form.secretKey.trim();
    if (secret) payload.secretKey = secret;
    mutation.mutate(payload);
  };

  const keyPlaceholder =
    settings?.hasSecretKey && settings.secretKeyMask
      ? `${settings.secretKeyMask} — введите, чтобы заменить`
      : 'Секретный ключ магазина';

  return (
    <Card padding="none">
      <CardHeader
        icon={CreditCard}
        title="Эквайринг (карта / СБП)"
        subtitle="Приём онлайн-оплат по ссылке из заказ-наряда"
        actions={
          <Switch
            label="Эквайринг"
            checked={form.enabled}
            onChange={(v) => update({ enabled: v })}
            disabled={isLoading || isError || mutation.isPending}
          />
        }
      />
      <CardBody className="space-y-4">
        <Hint>{HINT}</Hint>
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          minHeight="py-6"
          errorTitle="Не удалось загрузить настройки"
          errorDescription="Форма скрыта, чтобы не перезаписать сохранённые ключи. Повторите загрузку."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Провайдер" htmlFor={`${idBase}-provider`}>
                <Select
                  id={`${idBase}-provider`}
                  value={form.provider}
                  onChange={(e) => update({ provider: e.target.value as PaymentProviderName })}
                  options={PAYMENT_PROVIDERS}
                />
              </Field>
              <Field label="Shop ID" htmlFor={`${idBase}-shop`}>
                <Input
                  id={`${idBase}-shop`}
                  value={form.shopId}
                  onChange={(e) => update({ shopId: e.target.value })}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field
              label="Секретный ключ"
              htmlFor={`${idBase}-secret`}
              hint={
                settings?.hasSecretKey
                  ? 'Ключ сохранён. Оставьте поле пустым, чтобы не менять его.'
                  : 'Ключ ещё не задан — эквайринг неактивен, пока он не введён.'
              }
            >
              <Input
                id={`${idBase}-secret`}
                type="password"
                autoComplete="new-password"
                value={form.secretKey}
                onChange={(e) => update({ secretKey: e.target.value })}
                placeholder={keyPlaceholder}
              />
            </Field>
          </div>
        </QueryState>
      </CardBody>
      <SaveFooter dirty={dirty} saving={mutation.isPending} onSave={handleSave} label="Сохранить эквайринг" />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Онлайн-касса 54-ФЗ (АТОЛ)
// ──────────────────────────────────────────────────────────────────────────

const SNO_OPTIONS: { value: FiscalSno; label: string }[] = [
  { value: 'osn', label: 'ОСН — общая' },
  { value: 'usn_income', label: 'УСН — доходы' },
  { value: 'usn_income_outcome', label: 'УСН — доходы минус расходы' },
  { value: 'envd', label: 'ЕНВД' },
  { value: 'esn', label: 'ЕСХН' },
  { value: 'patent', label: 'Патент' },
];

const VAT_OPTIONS: { value: FiscalVat; label: string }[] = [
  { value: 'none', label: 'Без НДС' },
  { value: 'vat0', label: 'НДС 0%' },
  { value: 'vat10', label: 'НДС 10%' },
  { value: 'vat20', label: 'НДС 20%' },
  { value: 'vat110', label: 'НДС 10/110' },
  { value: 'vat120', label: 'НДС 20/120' },
];

function FiscalCard() {
  const queryClient = useQueryClient();
  const idBase = useId();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<FiscalSettings>({
    queryKey: ['fiscal', 'settings'],
    queryFn: async () => (await fiscalApi.getSettings()).data,
  });

  const [form, setForm] = useState<{
    enabled: boolean;
    login: string;
    password: string;
    groupCode: string;
    sno: FiscalSno | '';
    inn: string;
    paymentAddress: string;
    companyEmail: string;
    vat: FiscalVat | '';
  }>({
    enabled: false,
    login: '',
    password: '',
    groupCode: '',
    sno: '',
    inn: '',
    paymentAddress: '',
    companyEmail: '',
    vat: '',
  });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  useEffect(() => {
    if (settings) {
      setForm({
        enabled: settings.enabled,
        login: settings.login ?? '',
        password: '',
        groupCode: settings.groupCode ?? '',
        sno: settings.sno ?? '',
        inn: settings.inn ?? '',
        paymentAddress: settings.paymentAddress ?? '',
        companyEmail: settings.companyEmail ?? '',
        vat: (settings.vat as FiscalVat) || '',
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: {
      enabled?: boolean;
      login?: string;
      password?: string;
      groupCode?: string;
      sno?: FiscalSno;
      inn?: string;
      paymentAddress?: string;
      companyEmail?: string;
      vat?: FiscalVat;
    }) => fiscalApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['fiscal', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['fiscal', 'settings'] });
      toast.success('Онлайн-касса сохранена');
      setDirty(false);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: {
      enabled?: boolean;
      login?: string;
      password?: string;
      groupCode?: string;
      sno?: FiscalSno;
      inn?: string;
      paymentAddress?: string;
      companyEmail?: string;
      vat?: FiscalVat;
    } = {
      enabled: form.enabled,
      login: form.login.trim(),
      groupCode: form.groupCode.trim(),
      inn: form.inn.trim(),
      paymentAddress: form.paymentAddress.trim(),
      companyEmail: form.companyEmail.trim(),
    };
    // Пароль отправляем только при повторном вводе — пустое поле сохраняет старый.
    const pwd = form.password.trim();
    if (pwd) payload.password = pwd;
    if (form.sno) payload.sno = form.sno;
    if (form.vat) payload.vat = form.vat;
    mutation.mutate(payload);
  };

  const pwdPlaceholder =
    settings?.hasPassword && settings.passwordMask
      ? `${settings.passwordMask} — введите, чтобы заменить`
      : 'Пароль АТОЛ';

  return (
    <Card padding="none">
      <CardHeader
        icon={Receipt}
        title="Онлайн-касса 54-ФЗ (АТОЛ)"
        subtitle="Фискализация чеков через АТОЛ Онлайн"
        actions={
          <Switch
            label="Онлайн-касса 54-ФЗ"
            checked={form.enabled}
            onChange={(v) => update({ enabled: v })}
            disabled={isLoading || isError || mutation.isPending}
          />
        }
      />
      <CardBody className="space-y-4">
        <Hint>{HINT}</Hint>
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          minHeight="py-6"
          errorTitle="Не удалось загрузить настройки"
          errorDescription="Форма скрыта, чтобы не перезаписать сохранённые данные. Повторите загрузку."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Логин" htmlFor={`${idBase}-login`}>
                <Input
                  id={`${idBase}-login`}
                  value={form.login}
                  onChange={(e) => update({ login: e.target.value })}
                  placeholder="Логин АТОЛ"
                  autoComplete="off"
                />
              </Field>
              <Field label="Пароль" htmlFor={`${idBase}-password`}>
                <Input
                  id={`${idBase}-password`}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => update({ password: e.target.value })}
                  placeholder={pwdPlaceholder}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Код группы" htmlFor={`${idBase}-group`}>
                <Input
                  id={`${idBase}-group`}
                  value={form.groupCode}
                  onChange={(e) => update({ groupCode: e.target.value })}
                  placeholder="group_code ККТ"
                  autoComplete="off"
                />
              </Field>
              <Field label="Система налогообложения" htmlFor={`${idBase}-sno`}>
                <Select
                  id={`${idBase}-sno`}
                  value={form.sno}
                  onChange={(e) => update({ sno: e.target.value as FiscalSno | '' })}
                  placeholder="Не выбрана"
                  options={SNO_OPTIONS}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ИНН" htmlFor={`${idBase}-inn`}>
                <Input
                  id={`${idBase}-inn`}
                  value={form.inn}
                  onChange={(e) => update({ inn: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                  placeholder="1234567890"
                  inputMode="numeric"
                  className="tabular-nums"
                />
              </Field>
              <Field label="НДС" htmlFor={`${idBase}-vat`}>
                <Select
                  id={`${idBase}-vat`}
                  value={form.vat}
                  onChange={(e) => update({ vat: e.target.value as FiscalVat | '' })}
                  placeholder="Не выбран"
                  options={VAT_OPTIONS}
                />
              </Field>
            </div>

            <Field label="Адрес расчётов" htmlFor={`${idBase}-address`}>
              <Input
                id={`${idBase}-address`}
                value={form.paymentAddress}
                onChange={(e) => update({ paymentAddress: e.target.value })}
                placeholder="г. Москва, ул. Примерная, д. 1"
                autoComplete="street-address"
              />
            </Field>

            <Field
              label="Email компании"
              htmlFor={`${idBase}-email`}
              hint="На этот адрес ОФД отправит электронный чек, если у клиента нет почты."
            >
              <Input
                id={`${idBase}-email`}
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={form.companyEmail}
                onChange={(e) => update({ companyEmail: e.target.value })}
                placeholder="info@autoservice.ru"
              />
            </Field>
          </div>
        </QueryState>
      </CardBody>
      <SaveFooter dirty={dirty} saving={mutation.isPending} onSave={handleSave} label="Сохранить онлайн-кассу" />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Телефония (Mango Office)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Публичный origin, куда Mango шлёт события звонков. Сам маршрут вебхука —
 * серверный (проверка подписи); здесь только ПОКАЗЫВАЕМ адрес, чтобы владелец
 * вставил его в панель Mango VPBX. Зеркалит резолв baseURL у axios:
 * абсолютный VITE_API_URL → его origin; относительный '/api' → origin страницы.
 */
function apiOrigin(): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
  try {
    return new URL(base).origin;
  } catch {
    return window.location.origin;
  }
}

function TelephonyCard() {
  const queryClient = useQueryClient();
  const idBase = useId();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<TelephonySettings>({
    queryKey: ['telephony', 'settings'],
    queryFn: async () => (await telephonyApi.getSettings()).data,
  });

  const [form, setForm] = useState<{ enabled: boolean; apiKey: string; apiSalt: string }>({
    enabled: false,
    apiKey: '',
    apiSalt: '',
  });
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  useUnsavedGuard(dirty);

  useEffect(() => {
    if (settings) {
      // Секреты write-only — поля всегда стартуют пустыми и показывают только маску.
      setForm({ enabled: settings.enabled, apiKey: '', apiSalt: '' });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { provider?: 'mango'; enabled?: boolean; apiKey?: string; apiSalt?: string }) =>
      telephonyApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['telephony', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['telephony', 'settings'] });
      toast.success('Телефония сохранена');
      setDirty(false);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: { provider?: 'mango'; enabled?: boolean; apiKey?: string; apiSalt?: string } = {
      provider: 'mango',
      enabled: form.enabled,
    };
    // Секреты отправляем только при повторном вводе — пустое поле сохраняет старое.
    const key = form.apiKey.trim();
    if (key) payload.apiKey = key;
    const salt = form.apiSalt.trim();
    if (salt) payload.apiSalt = salt;
    mutation.mutate(payload);
  };

  const keyPlaceholder =
    settings?.hasApiKey && settings.apiKeyMask
      ? `${settings.apiKeyMask} — введите, чтобы заменить`
      : 'API key (vpbx) из ЛК Mango';
  const saltPlaceholder =
    settings?.hasApiSalt && settings.apiSaltMask
      ? `${settings.apiSaltMask} — введите, чтобы заменить`
      : 'Соль для подписи (sign salt)';

  const webhookUrl = tenantId ? `${apiOrigin()}/api/telephony/webhook/${tenantId}` : '';

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Card padding="none">
      <CardHeader
        icon={PhoneCall}
        title="Телефония (Mango Office)"
        subtitle="Журнал звонков и уведомления о пропущенных"
        actions={
          <Switch
            label="Телефония"
            checked={form.enabled}
            onChange={(v) => update({ enabled: v })}
            disabled={isLoading || isError || mutation.isPending}
          />
        }
      />
      <CardBody className="space-y-4">
        <Hint>Ключи — в личном кабинете Mango; до ввода телефония неактивна.</Hint>
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          minHeight="py-6"
          errorTitle="Не удалось загрузить настройки"
          errorDescription="Форма скрыта, чтобы не перезаписать сохранённые ключи. Повторите загрузку."
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="API key (vpbx)" htmlFor={`${idBase}-key`}>
                <Input
                  id={`${idBase}-key`}
                  type="password"
                  autoComplete="new-password"
                  value={form.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder={keyPlaceholder}
                />
              </Field>
              <Field label="Соль для подписи" htmlFor={`${idBase}-salt`}>
                <Input
                  id={`${idBase}-salt`}
                  type="password"
                  autoComplete="new-password"
                  value={form.apiSalt}
                  onChange={(e) => update({ apiSalt: e.target.value })}
                  placeholder={saltPlaceholder}
                />
              </Field>
            </div>

            <p className="text-xs text-ink-3">
              {settings?.hasApiKey && settings?.hasApiSalt
                ? 'Ключи сохранены. Оставьте поля пустыми, чтобы не менять их.'
                : 'Ключи ещё не заданы — телефония неактивна, пока они не введены.'}
            </p>

            <Field
              label="Webhook для Mango VPBX"
              htmlFor={`${idBase}-webhook`}
              hint="Вставьте этот адрес в настройки событий Mango VPBX (входящий / пропущенный звонок), чтобы звонки попадали в раздел «Звонки» и приходили уведомления."
            >
              <div className="flex items-center gap-2">
                <Input
                  id={`${idBase}-webhook`}
                  readOnly
                  value={webhookUrl || 'Tenant не определён — обратитесь к администратору'}
                  onFocus={(e) => e.currentTarget.select()}
                  leftIcon={Link2}
                  className="font-mono text-xs"
                />
                <IconButton
                  label={copied ? 'Скопировано' : 'Скопировать ссылку'}
                  icon={copied ? Check : Copy}
                  variant="secondary"
                  onClick={copyWebhook}
                  disabled={!webhookUrl}
                  className={copied ? 'text-ok' : undefined}
                />
              </div>
            </Field>
          </div>
        </QueryState>
      </CardBody>
      <SaveFooter dirty={dirty} saving={mutation.isPending} onSave={handleSave} label="Сохранить телефонию" />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Apple Wallet (карта лояльности)
// ──────────────────────────────────────────────────────────────────────────

function WalletCard() {
  const queryClient = useQueryClient();
  const idBase = useId();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<WalletSettings>({
    queryKey: ['wallet', 'settings'],
    queryFn: async () => (await walletApi.getSettings()).data,
  });

  const [form, setForm] = useState<{
    enabled: boolean;
    passTypeId: string;
    teamId: string;
    organizationName: string;
    logoUrl: string;
    bgColor: string;
    certPem: string;
    certKeyPem: string;
    certKeyPassword: string;
    wwdrPem: string;
  }>({
    enabled: false,
    passTypeId: '',
    teamId: '',
    organizationName: '',
    logoUrl: '',
    bgColor: '',
    certPem: '',
    certKeyPem: '',
    certKeyPassword: '',
    wwdrPem: '',
  });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  useEffect(() => {
    if (settings) {
      // Сертификаты write-only — поля стартуют пустыми, форма показывает только
      // флаг «загружен», а не реальный PEM/пароль.
      setForm({
        enabled: settings.enabled,
        passTypeId: settings.passTypeId ?? '',
        teamId: settings.teamId ?? '',
        organizationName: settings.organizationName ?? '',
        logoUrl: settings.logoUrl ?? '',
        bgColor: settings.bgColor ?? '',
        certPem: '',
        certKeyPem: '',
        certKeyPassword: '',
        wwdrPem: '',
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: {
      enabled?: boolean;
      passTypeId?: string;
      teamId?: string;
      organizationName?: string;
      logoUrl?: string;
      bgColor?: string;
      certPem?: string;
      certKeyPem?: string;
      certKeyPassword?: string;
      wwdrPem?: string;
    }) => walletApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['wallet', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['wallet', 'settings'] });
      toast.success('Apple Wallet сохранён');
      setDirty(false);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: {
      enabled?: boolean;
      passTypeId?: string;
      teamId?: string;
      organizationName?: string;
      logoUrl?: string;
      bgColor?: string;
      certPem?: string;
      certKeyPem?: string;
      certKeyPassword?: string;
      wwdrPem?: string;
    } = {
      enabled: form.enabled,
      passTypeId: form.passTypeId.trim(),
      teamId: form.teamId.trim(),
      organizationName: form.organizationName.trim(),
      logoUrl: form.logoUrl.trim(),
      bgColor: form.bgColor.trim(),
    };
    // Сертификаты отправляем только при (повторном) вводе — пустое поле
    // сохраняет секрет нетронутым.
    const cert = form.certPem.trim();
    if (cert) payload.certPem = cert;
    const certKey = form.certKeyPem.trim();
    if (certKey) payload.certKeyPem = certKey;
    const certPwd = form.certKeyPassword.trim();
    if (certPwd) payload.certKeyPassword = certPwd;
    const wwdr = form.wwdrPem.trim();
    if (wwdr) payload.wwdrPem = wwdr;
    mutation.mutate(payload);
  };

  const certPlaceholder = settings?.hasCert
    ? 'Сертификат загружен — вставьте новый PEM, чтобы заменить'
    : '-----BEGIN CERTIFICATE-----';
  const certKeyPlaceholder = settings?.hasCertKey
    ? 'Ключ загружен — вставьте новый PEM, чтобы заменить'
    : '-----BEGIN PRIVATE KEY-----';
  const certPwdPlaceholder = settings?.hasCertKeyPassword
    ? 'Пароль загружен — введите, чтобы заменить'
    : 'Пароль приватного ключа (если задан)';
  const wwdrPlaceholder = settings?.hasWwdr
    ? 'Сертификат WWDR загружен — вставьте новый PEM, чтобы заменить'
    : '-----BEGIN CERTIFICATE-----';

  return (
    <Card padding="none">
      <CardHeader
        icon={Wallet}
        title="Apple Wallet (карта лояльности)"
        subtitle="Карта клиента в Wallet с балансом бонусов"
        actions={
          <Switch
            label="Apple Wallet"
            checked={form.enabled}
            onChange={(v) => update({ enabled: v })}
            disabled={isLoading || isError || mutation.isPending}
          />
        }
      />
      <CardBody className="space-y-4">
        <Hint>Сертификат Apple Pass Type ID — из Apple Developer. До загрузки карта недоступна.</Hint>
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          minHeight="py-6"
          errorTitle="Не удалось загрузить настройки"
          errorDescription="Форма скрыта, чтобы не перезаписать сохранённые сертификаты. Повторите загрузку."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <StoredBadge ok={!!settings?.hasCert} label="Сертификат" />
              <StoredBadge ok={!!settings?.hasCertKey} label="Ключ" />
              <StoredBadge ok={!!settings?.hasWwdr} label="WWDR" />
              <StoredBadge
                ok={!!settings?.configured}
                label={settings?.configured ? 'Готово к выдаче' : 'Не настроено'}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Pass Type ID" htmlFor={`${idBase}-pass`}>
                <Input
                  id={`${idBase}-pass`}
                  value={form.passTypeId}
                  onChange={(e) => update({ passTypeId: e.target.value })}
                  placeholder="pass.com.autexa.loyalty"
                  autoComplete="off"
                />
              </Field>
              <Field label="Team ID" htmlFor={`${idBase}-team`}>
                <Input
                  id={`${idBase}-team`}
                  value={form.teamId}
                  onChange={(e) => update({ teamId: e.target.value })}
                  placeholder="98SHYK65HQ"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field
              label="Название организации"
              htmlFor={`${idBase}-org`}
              hint="Печатается на карте. Если оставить пустым — подставится название компании."
            >
              <Input
                id={`${idBase}-org`}
                value={form.organizationName}
                onChange={(e) => update({ organizationName: e.target.value })}
                placeholder="Название автосервиса на карте"
                autoComplete="organization"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Логотип (URL)" htmlFor={`${idBase}-logo`}>
                <Input
                  id={`${idBase}-logo`}
                  value={form.logoUrl}
                  onChange={(e) => update({ logoUrl: e.target.value })}
                  placeholder="https://…/logo.png"
                  inputMode="url"
                  autoComplete="off"
                />
              </Field>
              <Field label="Цвет фона" htmlFor={`${idBase}-color`}>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${idBase}-color`}
                    value={form.bgColor}
                    onChange={(e) => update({ bgColor: e.target.value })}
                    placeholder="#1E88E5"
                    className="font-mono"
                  />
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(form.bgColor) ? form.bgColor : '#1E88E5'}
                    onChange={(e) => update({ bgColor: e.target.value })}
                    className="h-9 w-12 flex-shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface p-1 focus-ring"
                    aria-label="Выбрать цвет фона"
                  />
                </div>
              </Field>
            </div>

            <Field label="Certificate PEM" htmlFor={`${idBase}-cert`}>
              <Textarea
                id={`${idBase}-cert`}
                value={form.certPem}
                onChange={(e) => update({ certPem: e.target.value })}
                placeholder={certPlaceholder}
                autoComplete="off"
                spellCheck={false}
                rows={4}
                className="font-mono text-xs"
              />
            </Field>

            <Field label="Certificate key PEM" htmlFor={`${idBase}-certkey`}>
              <Textarea
                id={`${idBase}-certkey`}
                value={form.certKeyPem}
                onChange={(e) => update({ certKeyPem: e.target.value })}
                placeholder={certKeyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                rows={4}
                className="font-mono text-xs"
              />
            </Field>

            <Field label="Пароль ключа" htmlFor={`${idBase}-certpwd`}>
              <Input
                id={`${idBase}-certpwd`}
                type="password"
                autoComplete="new-password"
                value={form.certKeyPassword}
                onChange={(e) => update({ certKeyPassword: e.target.value })}
                placeholder={certPwdPlaceholder}
              />
            </Field>

            <Field
              label="WWDR PEM"
              htmlFor={`${idBase}-wwdr`}
              hint={
                settings?.hasCert && settings?.hasCertKey && settings?.hasWwdr
                  ? 'Сертификаты загружены. Оставьте поля пустыми, чтобы не менять их.'
                  : 'Apple WWDR (Worldwide Developer Relations) — промежуточный сертификат Apple для подписи карты.'
              }
            >
              <Textarea
                id={`${idBase}-wwdr`}
                value={form.wwdrPem}
                onChange={(e) => update({ wwdrPem: e.target.value })}
                placeholder={wwdrPlaceholder}
                autoComplete="off"
                spellCheck={false}
                rows={4}
                className="font-mono text-xs"
              />
            </Field>
          </div>
        </QueryState>
      </CardBody>
      <SaveFooter dirty={dirty} saving={mutation.isPending} onSave={handleSave} label="Сохранить Apple Wallet" />
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Страница
// ──────────────────────────────────────────────────────────────────────────

/**
 * Панель вкладки, которая НЕ размонтируется: все четыре карточки остаются в
 * дереве (как и раньше — четыре запроса на открытии страницы), поэтому
 * несохранённые правки одной интеграции переживают переключение на другую.
 */
function Panel({ active, tabKey, children }: { active: boolean; tabKey: IntegrationTab; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`integrations-panel-${tabKey}`}
      aria-labelledby={`integrations-tab-${tabKey}`}
      hidden={!active}
      tabIndex={0}
      className="outline-none"
    >
      {children}
    </div>
  );
}

export default function IntegrationsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  // Настройки интеграций (fiscal/payments/telephony/wallet) — settings_manage
  // (волна Битрикс24; так же гейтится backend PATCH */settings).
  const canManage = hasPermission('settings_manage');

  const requested = params.get('tab') as IntegrationTab | null;
  const tab: IntegrationTab = useMemo(
    () => (TAB_ITEMS.some((t) => t.key === requested) ? (requested as IntegrationTab) : 'acquiring'),
    [requested],
  );
  const setTab = (next: IntegrationTab) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'acquiring') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  };

  if (!canManage) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Интеграции"
        icon={Plug}
        subtitle="Онлайн-оплаты, фискализация чеков, телефония и Apple Wallet"
      />

      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} aria-label="Интеграции" idPrefix="integrations" />

      <div className="max-w-3xl">
        <Panel active={tab === 'acquiring'} tabKey="acquiring">
          <AcquiringCard />
        </Panel>
        <Panel active={tab === 'fiscal'} tabKey="fiscal">
          <FiscalCard />
        </Panel>
        <Panel active={tab === 'telephony'} tabKey="telephony">
          <TelephonyCard />
        </Panel>
        <Panel active={tab === 'wallet'} tabKey="wallet">
          <WalletCard />
        </Panel>
      </div>
    </div>
  );
}
