import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Info,
  MessageSquare,
  MessageSquareText,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Trash2,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { marketingApi } from '../../api/services';
import type { MessagingIntegration } from '../../types';
import ConfirmDialog from '../ConfirmDialog';
import { Badge, StatusPill } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { cn } from '../../ui/cn';
import { InfoNote, LoadingBlock, SectionCard, SectionError, Toggle } from './marketingKit';

type ProviderType = MessagingIntegration['providerType'];

// Providers whose outbound message reaches the CLIENT's phone as an SMS — the
// only ones for which the independent «SMS клиентам» switch is meaningful.
// Telegram/email/whatsapp deliver elsewhere (owner chat / inbox / WA), so no SMS
// toggle is shown for them.
const CLIENT_SMS_TYPES: ProviderType[] = ['moizvonki', 'smsru', 'sms'];

// Backend sentinel (UpsertIntegrationDto): «keep the stored api_key». The upsert
// requires a non-empty apiKey AND rewrites sender/webhook/id columns from the
// DTO on every UPDATE, so a settings-preserving write must send this sentinel
// plus the integration's current routing fields — never blank them.
const KEEP_API_KEY = '_existing_';

const PROVIDER_LABELS: Record<string, string> = {
  moizvonki: 'Мои Звонки',
  smsru: 'SMS.RU',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  email: 'Email',
};

const TELEPHONY_TYPES: ProviderType[] = ['moizvonki'];
const MESSAGING_TYPES: ProviderType[] = ['whatsapp', 'smsru', 'telegram', 'sms', 'email'];
// Каналы, которые можно СОЗДАТЬ. 'sms' (обобщённый шлюз) и 'email' исключены:
// у них нет реального транспорта на сервере (адаптеры-заглушки) и с раунда 12
// сервер не выбирает их каналом — предлагать их как рабочие = фантомные
// «отправлено». Существующие legacy-строки этих типов остаются видимыми и
// удаляемыми (MESSAGING_TYPES выше фильтрует список), но новые не создаются.
const CREATABLE_MESSAGING_TYPES: ProviderType[] = ['whatsapp', 'smsru', 'telegram'];

const emptyForm = {
  providerType: 'whatsapp' as ProviderType,
  apiKey: '',
  senderName: '',
  senderPhone: '',
  webhookUrl: '',
  phoneNumberId: '',
  chatId: '',
};
type FormState = typeof emptyForm;

// ─── Add / edit form (provider-specific fields) ─────────────────────
function IntegrationForm({
  allowedTypes,
  editing,
  saving,
  onSave,
  onCancel,
}: {
  allowedTypes: ProviderType[];
  editing: MessagingIntegration | null;
  saving: boolean;
  onSave: (data: FormState & { id?: string }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (editing) {
      return {
        providerType: editing.providerType,
        apiKey: '', // write-only — never returned by the backend
        senderName: editing.senderName || '',
        senderPhone: editing.senderPhone || '',
        webhookUrl: editing.webhookUrl || '',
        phoneNumberId: editing.phoneNumberId || '',
        chatId: editing.chatId || '',
      };
    }
    return { ...emptyForm, providerType: allowedTypes[0] };
  });

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const uid = `int-${editing?.id ?? 'new'}`;

  // Legacy-строка типа вне creatable-списка ('sms'/'email'): при редактировании
  // добавляем её тип в options, иначе disabled-select показал бы пустоту.
  const typeOptions =
    editing && !allowedTypes.includes(editing.providerType) ? [...allowedTypes, editing.providerType] : allowedTypes;

  const secretPlaceholder = editing ? 'Оставьте пустым, чтобы не менять' : undefined;

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-line bg-surface-2 p-3">
      {typeOptions.length > 1 && (
        <Field label="Тип" htmlFor={`${uid}-type`}>
          <Select
            id={`${uid}-type`}
            value={form.providerType}
            onChange={(e) => set({ providerType: e.target.value as ProviderType })}
            disabled={!!editing}
            options={typeOptions.map((t) => ({
              value: t,
              label: t === 'sms' ? 'SMS (другой провайдер)' : PROVIDER_LABELS[t],
            }))}
          />
        </Field>
      )}

      {form.providerType === 'moizvonki' && (
        <>
          <Field
            label="Домен (поддомен в moizvonki.ru)"
            htmlFor={`${uid}-domain`}
            hint="Если адрес mycompany.moizvonki.ru — введите mycompany"
          >
            <Input
              id={`${uid}-domain`}
              value={form.webhookUrl}
              onChange={(e) => set({ webhookUrl: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="mycompany"
              autoComplete="off"
              rightSlot={<span className="text-xs text-ink-3">.moizvonki.ru</span>}
              className="pr-28"
            />
          </Field>
          <Field label="Email (логин в Мои Звонки)" htmlFor={`${uid}-email`}>
            <Input
              id={`${uid}-email`}
              type="email"
              autoComplete="off"
              value={form.senderName}
              onChange={(e) => set({ senderName: e.target.value })}
              placeholder="user@mail.ru"
            />
          </Field>
          <Field label="Ключ API" htmlFor={`${uid}-key`}>
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={secretPlaceholder ?? 'Настройки → Интеграция → Ключ API'}
            />
          </Field>
        </>
      )}

      {form.providerType === 'smsru' && (
        <>
          <Field label="API ID (из кабинета sms.ru)" htmlFor={`${uid}-key`}>
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={secretPlaceholder ?? 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX'}
            />
          </Field>
          <Field label="Имя отправителя" htmlFor={`${uid}-sender`} hint="Необязательно — одобренное в sms.ru">
            <Input
              id={`${uid}-sender`}
              value={form.senderName}
              onChange={(e) => set({ senderName: e.target.value })}
              placeholder="AUTEXA"
            />
          </Field>
        </>
      )}

      {form.providerType === 'whatsapp' && (
        <>
          <Field
            label="Access token (постоянный)"
            htmlFor={`${uid}-key`}
            hint="Хранится зашифрованно и не показывается повторно"
          >
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={secretPlaceholder ?? 'Bearer-токен WhatsApp Cloud API'}
            />
          </Field>
          <Field
            label="Phone number ID"
            htmlFor={`${uid}-pnid`}
            hint="Meta for Developers → WhatsApp → API Setup → Phone number ID"
          >
            <Input
              id={`${uid}-pnid`}
              inputMode="numeric"
              value={form.phoneNumberId}
              onChange={(e) => set({ phoneNumberId: e.target.value })}
              placeholder="напр. 123456789012345"
            />
          </Field>
        </>
      )}

      {form.providerType === 'telegram' && (
        <>
          <Field label="Токен бота" htmlFor={`${uid}-key`} hint="Получите у @BotFather. Хранится зашифрованно">
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={secretPlaceholder ?? '123456:ABC-DEF1234…'}
            />
          </Field>
          <Field label="Chat ID" htmlFor={`${uid}-chat`}>
            <Input
              id={`${uid}-chat`}
              value={form.chatId}
              onChange={(e) => set({ chatId: e.target.value })}
              placeholder="напр. -1001234567890"
            />
          </Field>
          <InfoNote icon={Info} tone="info">
            Telegram-бот не пишет клиенту на телефон — уведомление приходит в указанный чат владельца или сотрудников.
          </InfoNote>
        </>
      )}

      {(form.providerType === 'sms' || form.providerType === 'email') && (
        <>
          <Field label="API ключ" htmlFor={`${uid}-key`}>
            <Input
              id={`${uid}-key`}
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder={secretPlaceholder ?? 'Ваш API ключ'}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Имя отправителя" htmlFor={`${uid}-sender`}>
              <Input
                id={`${uid}-sender`}
                value={form.senderName}
                onChange={(e) => set({ senderName: e.target.value })}
              />
            </Field>
            <Field label="Телефон" htmlFor={`${uid}-phone`}>
              <Input
                id={`${uid}-phone`}
                type="tel"
                value={form.senderPhone}
                onChange={(e) => set({ senderPhone: e.target.value })}
              />
            </Field>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button size="sm" onClick={() => onSave(editing ? { ...form, id: editing.id } : form)} loading={saving}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

// ─── One provider row ───────────────────────────────────────────────
function ProviderRow({
  integration,
  smsPending,
  onEdit,
  onRemove,
  onToggleSms,
}: {
  integration: MessagingIntegration;
  smsPending: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggleSms: (next: boolean) => void;
}) {
  const showSmsToggle = CLIENT_SMS_TYPES.includes(integration.providerType);
  const smsOn = integration.smsNotificationsEnabled;
  const details = [
    integration.senderName ? integration.senderName : null,
    integration.providerType === 'whatsapp' && integration.phoneNumberId ? `ID ${integration.phoneNumberId}` : null,
    integration.providerType === 'telegram' && integration.chatId ? `чат ${integration.chatId}` : null,
  ].filter(Boolean);

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill tone={integration.isActive ? 'ok' : 'neutral'} size="sm">
            {integration.isActive ? 'Активен' : 'Отключён'}
          </StatusPill>
          <span className="truncate text-sm font-medium text-ink">
            {PROVIDER_LABELS[integration.providerType] || integration.providerType}
          </span>
          {details.length > 0 && <span className="truncate text-xs text-ink-3">· {details.join(' · ')}</span>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <IconButton label="Изменить" icon={Pencil} size="sm" onClick={onEdit} />
          <IconButton label="Удалить" icon={Trash2} size="sm" variant="danger" onClick={onRemove} />
        </div>
      </div>

      {showSmsToggle && (
        <div className="mt-2.5 flex items-start gap-3 border-t border-line pt-2.5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <MessageSquareText className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
              Отправлять SMS клиентам
            </p>
            <p className="mt-0.5 text-2xs leading-snug text-ink-3">
              {smsOn
                ? 'Клиенты получают SMS (готовность авто, напоминания, отзывы).'
                : integration.providerType === 'moizvonki'
                  ? 'SMS клиентам отключены. Интеграция подключена — звонки продолжают синхронизироваться.'
                  : 'SMS клиентам отключены. Интеграция остаётся подключённой.'}
            </p>
          </div>
          <Toggle checked={smsOn} onChange={onToggleSms} label="Отправлять SMS клиентам" disabled={smsPending} />
        </div>
      )}
    </li>
  );
}

// ─── A configurable group (telephony OR messaging) ──────────────────
function ConfigurableGroup({
  icon,
  title,
  subtitle,
  allowedTypes,
  creatableTypes,
  integrations,
  emptyLabel,
}: {
  icon: typeof Phone;
  title: string;
  subtitle: string;
  /** Типы, чьи СУЩЕСТВУЮЩИЕ строки показываются в этой группе. */
  allowedTypes: ProviderType[];
  /** Типы, доступные для создания (по умолчанию = allowedTypes). */
  creatableTypes?: ProviderType[];
  integrations: MessagingIntegration[];
  emptyLabel: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MessagingIntegration | null>(null);
  const [toRemove, setToRemove] = useState<MessagingIntegration | null>(null);

  const rows = integrations.filter((i) => allowedTypes.includes(i.providerType));

  const upsert = useMutation({
    mutationFn: (data: FormState & { id?: string }) => marketingApi.upsertIntegration(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'integrations'], fresh);
      setOpen(false);
      setEditing(null);
      toast.success('Провайдер сохранён');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => marketingApi.removeIntegration(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<MessagingIntegration[]>(['marketing', 'integrations'], (prev) =>
        (prev ?? []).filter((i) => i.id !== id),
      );
      toast.success('Удалено');
    },
    onError: () => toast.error('Ошибка удаления'),
  });

  // Independent «SMS клиентам» switch (127), decoupled from isActive. The upsert
  // rewrites every routing column from the DTO, so we echo the integration's
  // current sender/webhook/id fields back verbatim and use the KEEP_API_KEY
  // sentinel — toggling the SMS switch never touches the credential or the
  // «Мои Звонки» domain/login, so call sync keeps working regardless.
  const toggleSms = useMutation({
    mutationFn: (v: { integration: MessagingIntegration; next: boolean }) =>
      marketingApi
        .upsertIntegration({
          id: v.integration.id,
          providerType: v.integration.providerType,
          apiKey: KEEP_API_KEY,
          senderName: v.integration.senderName,
          senderPhone: v.integration.senderPhone,
          webhookUrl: v.integration.webhookUrl,
          phoneNumberId: v.integration.phoneNumberId,
          chatId: v.integration.chatId,
          isActive: v.integration.isActive,
          smsNotificationsEnabled: v.next,
        })
        .then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'integrations'], fresh);
    },
    onError: () => toast.error('Не удалось изменить отправку SMS'),
  });
  const togglingId = toggleSms.isPending ? toggleSms.variables?.integration.id : null;

  return (
    <SectionCard
      icon={icon}
      iconTone="accent"
      title={title}
      subtitle={subtitle}
      right={
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          aria-expanded={open && !editing}
          onClick={() => {
            setEditing(null);
            setOpen((v) => !v);
          }}
        >
          Добавить
        </Button>
      }
    >
      {open && (
        <IntegrationForm
          key={editing?.id ?? 'new'}
          allowedTypes={creatableTypes ?? allowedTypes}
          editing={editing}
          saving={upsert.isPending}
          onSave={(d) => upsert.mutate(d)}
          onCancel={() => {
            setOpen(false);
            setEditing(null);
          }}
        />
      )}

      {rows.length === 0 && !open ? (
        <p className="py-2 text-sm text-ink-3">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((i) => (
            <ProviderRow
              key={i.id}
              integration={i}
              smsPending={togglingId === i.id}
              onEdit={() => {
                setEditing(i);
                setOpen(true);
              }}
              onRemove={() => setToRemove(i)}
              onToggleSms={(next) => toggleSms.mutate({ integration: i, next })}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && remove.mutate(toRemove.id)}
        title="Удалить интеграцию"
        message={`«${toRemove ? PROVIDER_LABELS[toRemove.providerType] || toRemove.providerType : ''}» будет отключена, сообщения через неё перестанут уходить. Продолжить?`}
        confirmText="Удалить"
        variant="danger"
      />
    </SectionCard>
  );
}

// ─── Placeholder group (no backend yet — honest «по запросу») ───────
function PlannedGroup({
  icon: Icon,
  title,
  subtitle,
  body,
}: {
  icon: typeof Receipt;
  title: string;
  subtitle: string;
  body: string;
}) {
  return (
    <SectionCard icon={Icon} title={title} subtitle={subtitle} right={<Badge outline>по запросу</Badge>}>
      <p className="text-sm text-ink-2">{body}</p>
    </SectionCard>
  );
}

export default function IntegrationsView() {
  const {
    data: integrations,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'integrations'],
    queryFn: () => marketingApi.getIntegrations().then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <LoadingBlock lines={3} />
        <LoadingBlock lines={3} />
      </div>
    );
  }
  if (isError || !integrations) {
    return <SectionError message="Не удалось загрузить интеграции" onRetry={() => refetch()} loading={isFetching} />;
  }

  return (
    <div className="space-y-5">
      <div className={cn('grid gap-5 lg:grid-cols-2 lg:items-start')}>
        <ConfigurableGroup
          icon={Phone}
          title="Телефония"
          subtitle="Интеграция звонков — воронка обращений и пропущенные"
          allowedTypes={TELEPHONY_TYPES}
          integrations={integrations}
          emptyLabel="Мои Звонки не подключены"
        />

        <ConfigurableGroup
          icon={MessageSquare}
          title="Каналы рассылок"
          subtitle="Через что уходят сообщения клиентам — WhatsApp, SMS.RU, Telegram"
          allowedTypes={MESSAGING_TYPES}
          creatableTypes={CREATABLE_MESSAGING_TYPES}
          integrations={integrations}
          emptyLabel="Каналы рассылок не подключены"
        />

        <PlannedGroup
          icon={Receipt}
          title="Онлайн-касса (54-ФЗ)"
          subtitle="Фискализация чеков"
          body="Подключение фискального накопителя настраивается через поддержку. Напишите нам — поможем связать кассу с Autexa."
        />

        <PlannedGroup
          icon={CreditCard}
          title="Эквайринг"
          subtitle="Приём оплаты картой"
          body="Приём безналичной оплаты подключается индивидуально по вашему банку-эквайеру. Оставьте заявку в поддержке."
        />
      </div>

      <InfoNote icon={Zap}>
        Тексты сообщений и площадки для отзывов настраиваются в разделе «Настройки», а сами рассылки — в разделе
        «Рассылки».
      </InfoNote>
    </div>
  );
}
