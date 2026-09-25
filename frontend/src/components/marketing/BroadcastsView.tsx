import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  AlarmClock,
  Bell,
  CalendarClock,
  Car,
  CreditCard,
  Info,
  Send,
  ShieldCheck,
  Star,
  Users,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { bookingsApi, installmentsApi, marketingApi } from '../../api/services';
import ConfirmDialog from '../ConfirmDialog';
import { MiniStat } from '../dashboard/shared';
import type {
  AutoMailingOverview,
  BroadcastPreview,
  MessagingIntegration,
  SegmentBroadcastCriteria,
  SegmentBroadcastResult,
} from '../../types';
import type { SettingsSection } from './MarketingSettingsView';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { toneChip } from '../../ui/tokens';
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
  SectionCard,
  SectionError,
  Toggle,
  lastVisitLabel,
  plural,
} from './marketingKit';
import { newUuid } from '../../utils/uuid';

const PROVIDER_LABELS: Record<string, string> = {
  moizvonki: 'Мои Звонки',
  smsru: 'SMS.RU',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  email: 'Email',
};
// 'sms'/'email' исключены: адаптеры-заглушки без транспорта — сервер такие
// каналы больше не выбирает, предлагать их в селекте = обещать фантом.
const MESSAGING_TYPES = ['whatsapp', 'smsru', 'telegram'];

const WINBACK_PRESETS = [30, 60, 90, 180];
const DEFAULT_MESSAGE = 'Здравствуйте! Давно не виделись — будем рады видеть вас снова. Запишитесь на удобное время.';

type SegmentKind = 'winback' | 'source' | 'debt';

// ─── Auto-mailing registry (все 6 сценариев, живые тумблеры) ────────
// Единый реестр авто-отправок: каждый сценарий — тумблер (пишет своим
// существующим endpoint'ом), описание триггера и «Последняя отправка» из
// журнала sent_messages. Включение — только через подтверждение: владелец
// видит, ЧТО уйдёт клиенту, до того как включил. Выключение — мгновенно.
const AUTO_META: Record<
  AutoMailingOverview['type'],
  { label: string; icon: typeof Star; section: SettingsSection | null }
> = {
  review: { label: 'Запрос отзыва', icon: Star, section: 'review' },
  car_ready: { label: 'Машина готова', icon: Car, section: 'car-ready' },
  // Настройки записей (часы напоминания и т.п.) живут в мобильном разделе
  // «Записи» — на вебе управление сводится к тумблеру здесь.
  booking_confirm: { label: 'Подтверждение записи', icon: CalendarClock, section: null },
  booking_reminder: { label: 'Напоминание о записи', icon: AlarmClock, section: null },
  installment_reminder: { label: 'Оплата рассрочки', icon: CreditCard, section: 'installments' },
  service_reminder: { label: 'Давно не обслуживались', icon: Bell, section: 'service' },
};

function lastSentLabel(iso?: string | null): string {
  if (!iso) return 'Ещё не отправлялась';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Ещё не отправлялась';
  const now = new Date();
  const date = dt.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `Последняя отправка: ${date}, ${time}`;
}

function AutoMailings({ onGoToSettings }: { onGoToSettings: (s: SettingsSection) => void }) {
  const qc = useQueryClient();
  const [confirmItem, setConfirmItem] = useState<AutoMailingOverview | null>(null);

  const {
    data: mailings = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'auto-mailings'],
    queryFn: () => marketingApi.getAutoMailings().then((r) => r.data),
  });

  // Текущий шаблон запроса отзыва — для confirm-текста при включении.
  const { data: reviewSettings } = useQuery({
    queryKey: ['marketing', 'settings'],
    queryFn: () => marketingApi.getSettings().then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: async ({ type, next }: { type: AutoMailingOverview['type']; next: boolean }) => {
      switch (type) {
        case 'review':
          await marketingApi.updateSettings({ autoSendEnabled: next });
          break;
        case 'car_ready':
          await marketingApi.updateCarReadySettings({ enabled: next });
          break;
        case 'service_reminder':
          await marketingApi.updateReminderSettings({ enabled: next });
          break;
        case 'installment_reminder':
          await installmentsApi.updateReminderSettings({ mode: next ? 'auto' : 'off' });
          break;
        case 'booking_confirm':
          await bookingsApi.updateSettings({ notifyClientOnCreate: next });
          break;
        case 'booking_reminder':
          await bookingsApi.updateSettings({ reminderEnabled: next });
          break;
      }
    },
    onError: () => toast.error('Не удалось изменить настройку'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['marketing', 'auto-mailings'] });
      qc.invalidateQueries({ queryKey: ['marketing', 'settings'] });
    },
  });

  const requestToggle = (m: AutoMailingOverview) => {
    if (toggle.isPending) return;
    if (m.enabled) {
      toggle.mutate({ type: m.type, next: false });
      return;
    }
    setConfirmItem(m); // включение — через подтверждение
  };

  const confirmMessage = (m: AutoMailingOverview): string => {
    if (m.type === 'review') {
      const template =
        reviewSettings?.messageTemplate ||
        'Здравствуйте, {clientName}! Спасибо за визит в {tenantName}. Оцените качество обслуживания: {reviewLink}';
      return (
        `После каждого закрытого заказ-наряда клиент ОДИН раз получит сообщение: «${template}» ` +
        '({clientName} — имя клиента, {tenantName} — название сервиса, {reviewLink} — персональная ссылка на отзыв). ' +
        'Текст меняется в «Настройки» → «Запрос отзыва».'
      );
    }
    const meta = AUTO_META[m.type];
    return `${m.trigger ?? m.summary}. Каждая отправка проходит общий анти-спам-фильтр и видна в «Журнале» — сценарий «${m.humanTitle ?? meta.label}» не отправит клиенту ничего лишнего.`;
  };

  return (
    <SectionCard
      icon={Zap}
      iconTone="accent"
      title="Автоматические рассылки"
      subtitle="Все сценарии авто-отправки клиентам — других нет. Каждая отправка видна в «Журнале»"
      bodyPadding="sm"
    >
      {isLoading ? (
        <LoadingBlock lines={3} />
      ) : isError ? (
        <SectionError message="Не удалось загрузить сценарии рассылок" onRetry={() => refetch()} loading={isFetching} />
      ) : mailings.length === 0 ? (
        <EmptyState icon={Zap} title="Автоматические рассылки не настроены" />
      ) : (
        <ul className="divide-y divide-line">
          {mailings.map((m: AutoMailingOverview) => {
            const meta = AUTO_META[m.type];
            const Icon = meta?.icon ?? Zap;
            const title = m.humanTitle ?? meta?.label ?? m.type;
            return (
              <li key={m.type} className="py-3 first:pt-1 last:pb-1">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                      m.enabled ? toneChip.accent : toneChip.neutral,
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{title}</p>
                    <p className="truncate text-xs text-ink-3">{m.trigger ?? m.summary}</p>
                  </div>
                  <Toggle
                    checked={m.enabled}
                    onChange={() => requestToggle(m)}
                    label={title}
                    disabled={toggle.isPending}
                  />
                </div>
                <div className="ml-11 mt-1.5 flex items-center justify-between gap-2">
                  <p className="truncate text-2xs text-ink-3">{lastSentLabel(m.lastSentAt)}</p>
                  {meta?.section && (
                    <Button variant="ghost" size="sm" onClick={() => onGoToSettings(meta.section as SettingsSection)}>
                      Настроить текст
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Подтверждение включения сценария — видно, что уйдёт клиенту */}
      <ConfirmDialog
        isOpen={confirmItem != null}
        onClose={() => setConfirmItem(null)}
        onConfirm={() => {
          if (confirmItem) toggle.mutate({ type: confirmItem.type, next: true });
        }}
        title={`Включить «${confirmItem ? (confirmItem.humanTitle ?? AUTO_META[confirmItem.type]?.label ?? confirmItem.type) : ''}»?`}
        message={confirmItem ? confirmMessage(confirmItem) : ''}
        confirmText="Включить"
      />
    </SectionCard>
  );
}

// ─── Manual segment broadcast ───────────────────────────────────────
function ManualBroadcast() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SegmentKind>('winback');
  const [days, setDays] = useState(90);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [integrationId, setIntegrationId] = useState<string>('');
  const [result, setResult] = useState<SegmentBroadcastResult | null>(null);
  // Шаг подтверждения: dry-run preview (кому и через какой канал уйдёт) —
  // отправка возможна только после него. НИЧЕГО не отправляет.
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // newUuid, а не голый crypto.randomUUID(): вызов вычисляется в теле
  // компонента на каждом рендере, и там, где API нет (iOS < 15.4, любой
  // не-secure origin), TypeError падал прямо в рендер и подменял страницу
  // экраном ErrorBoundary.
  const idempotencyKey = useRef<string>(newUuid());

  // Connected messaging channels (telephony excluded).
  const { data: integrations = [] } = useQuery({
    queryKey: ['marketing', 'integrations'],
    queryFn: () => marketingApi.getIntegrations().then((r) => r.data),
  });
  const channels = integrations.filter(
    (i: MessagingIntegration) => MESSAGING_TYPES.includes(i.providerType) && i.isActive,
  );

  // Win-back is the only segment with a live preview endpoint.
  const winbackPreview = useQuery({
    queryKey: ['marketing', 'winback', days],
    queryFn: () => marketingApi.winback(days).then((r) => r.data),
    enabled: kind === 'winback',
    placeholderData: keepPreviousData,
  });
  const previewClients = kind === 'winback' ? (winbackPreview.data ?? []) : [];
  const previewTotal = previewClients.length;

  const criteria: SegmentBroadcastCriteria = useMemo(() => {
    if (kind === 'winback') return { lastVisitDays: days };
    if (kind === 'source') return source.trim() ? { source: source.trim() } : {};
    return { hasDebt: true };
  }, [kind, days, source]);

  // Любое изменение состава рассылки сбрасывает подтверждение — нельзя
  // подтвердить одно, а отправить другое.
  useEffect(() => {
    setPreview(null);
  }, [kind, days, source, message, integrationId]);

  const send = useMutation({
    mutationFn: () =>
      marketingApi
        .sendSegmentBroadcast({
          segment: criteria,
          message: message.trim(),
          integrationId: integrationId || undefined,
          idempotencyKey: idempotencyKey.current,
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      setResult(res);
      setPreview(null);
      idempotencyKey.current = newUuid(); // fresh key for the next distinct send
      qc.invalidateQueries({ queryKey: ['marketing', 'winback'] });
    },
    onError: () => toast.error('Не удалось отправить рассылку'),
  });

  /** Шаг 1: dry-run — сколько клиентов и какой канал. Ничего не отправляет. */
  const runPreview = async () => {
    setPreviewing(true);
    setResult(null);
    try {
      const { data: pv } = await marketingApi.previewBroadcast({
        segment: criteria,
        integrationId: integrationId || undefined,
      });
      if (!pv.channelConnected) {
        toast.error('Нет подключённого канала рассылок — подключите его в «Интеграции»');
        return;
      }
      if (pv.recipientsCount === 0) {
        toast.error('В выбранном сегменте нет клиентов с телефоном');
        return;
      }
      setPreview(pv);
    } catch {
      toast.error('Не удалось получить предпросмотр рассылки');
    } finally {
      setPreviewing(false);
    }
  };

  const trimmed = message.trim();
  const sourceMissing = kind === 'source' && !source.trim();
  const canSend = trimmed.length > 0 && !sourceMissing && !send.isPending && !previewing;

  return (
    <SectionCard
      icon={Send}
      iconTone="accent"
      title="Ручная рассылка по сегменту"
      subtitle="Выберите, кому и через какой канал отправить сообщение"
    >
      <div className="space-y-4">
        {/* Segment */}
        <div>
          <p className="label">Кому отправить</p>
          <SegmentedControl
            aria-label="Сегмент клиентов"
            fullWidth
            value={kind}
            onChange={(k) => {
              setKind(k);
              setResult(null);
            }}
            options={[
              { value: 'winback', label: 'Давно не приезжали' },
              { value: 'source', label: 'По источнику' },
              { value: 'debt', label: 'Есть долг' },
            ]}
          />
        </div>

        {kind === 'winback' && (
          <div>
            <p className="label">Не приезжали более</p>
            <SegmentedControl
              aria-label="Срок без визитов"
              fullWidth
              value={String(days)}
              onChange={(d) => {
                setDays(Number(d));
                setResult(null);
              }}
              options={WINBACK_PRESETS.map((d) => ({ value: String(d), label: `${d} дн.` }))}
            />
            <p className="mt-1.5 text-xs text-ink-3">
              Готовые сегменты для возврата клиентов: 30 / 60 / 90 / 180 дней.
            </p>
          </div>
        )}

        {kind === 'source' && (
          <Field
            label="Источник клиента"
            htmlFor="broadcast-source"
            hint="Точное значение поля «источник» в карточке клиента"
          >
            <Input
              id="broadcast-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Напр. Instagram, Авито, по рекомендации"
            />
          </Field>
        )}

        {/* Preview (win-back only) */}
        {kind === 'winback' && (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Users className="h-4 w-4 text-ink-4" aria-hidden="true" />
                Получатели
              </span>
              <span className="text-sm font-semibold tabular-nums text-accent-text">{previewTotal}</span>
            </div>
            {winbackPreview.isLoading ? (
              <LoadingBlock className="px-3" lines={3} />
            ) : winbackPreview.isError ? (
              <div className="p-3">
                <SectionError
                  message="Не удалось загрузить список получателей"
                  onRetry={() => winbackPreview.refetch()}
                  loading={winbackPreview.isFetching}
                />
              </div>
            ) : previewTotal === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">Нет клиентов, которые так давно не приезжали</p>
            ) : (
              <ul className="max-h-64 divide-y divide-line overflow-y-auto">
                {previewClients.map((c) => (
                  <li key={c.clientId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{c.name || 'Без имени'}</p>
                      <p className="truncate text-xs tabular-nums text-ink-3">{c.phone || '—'}</p>
                    </div>
                    <p className="flex-shrink-0 text-xs font-medium text-ink-2">{lastVisitLabel(c.lastVisit)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {kind !== 'winback' && (
          <InfoNote icon={Info} tone="info">
            Точное число получателей и результат покажем сразу после отправки — дубли отсеет анти-спам-фильтр.
          </InfoNote>
        )}

        {/* Channel */}
        <Field
          label="Канал"
          htmlFor="broadcast-channel"
          error={
            channels.length === 0 ? 'Нет активных каналов рассылок — подключите их в разделе «Интеграции»' : undefined
          }
        >
          <Select
            id="broadcast-channel"
            value={integrationId}
            onChange={(e) => setIntegrationId(e.target.value)}
            options={[
              { value: '', label: 'Канал по умолчанию' },
              ...channels.map((c: MessagingIntegration) => ({
                value: c.id,
                label: `${PROVIDER_LABELS[c.providerType] || c.providerType}${c.senderName ? ` · ${c.senderName}` : ''}`,
              })),
            ]}
          />
        </Field>

        {/* Message */}
        <Field label="Сообщение" htmlFor="broadcast-message">
          <Textarea
            id="broadcast-message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Текст сообщения для клиентов…"
          />
        </Field>

        {/* Шаг подтверждения: сначала dry-run предпросмотр, потом отправка */}
        {preview ? (
          <div className="space-y-3 rounded-lg border border-accent/30 bg-accent-soft p-4">
            <p className="text-sm font-semibold text-ink">
              Уйдёт {preview.recipientsCount} {plural(preview.recipientsCount, ['клиенту', 'клиентам', 'клиентам'])}{' '}
              через {preview.channel ? PROVIDER_LABELS[preview.channel] || preview.channel : 'канал по умолчанию'}
            </p>
            <p className="rounded-md bg-surface px-3 py-2 text-sm text-ink-2">«{trimmed}»</p>
            {preview.sample.length > 0 && (
              <p className="text-xs text-ink-3">
                Среди получателей: {preview.sample.map((s) => `${s.name} (${s.phone})`).join(', ')}
              </p>
            )}
            <p className="flex items-start gap-1.5 text-xs text-ink-3">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-ok" aria-hidden="true" />
              Не больше {preview.perClient24hCap} сообщений клиенту за 24 ч — часть может быть пропущена защитой от
              спама.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={send.isPending}>
                Отменить
              </Button>
              <Button icon={Send} onClick={() => send.mutate()} loading={send.isPending}>
                Отправить
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button icon={Send} onClick={runPreview} disabled={!canSend} loading={previewing}>
              Проверить и отправить{kind === 'winback' && previewTotal > 0 ? ` (${previewTotal})` : ''}
            </Button>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-lg border border-line p-4" role="status">
            <div className="grid grid-cols-4 gap-3">
              <MiniStat label="Отправлено" value={result.sent} tone="ok" align="center" size="sm" />
              <MiniStat
                label="Дубли"
                value={result.skippedDedup}
                tone={result.skippedDedup > 0 ? 'warn' : 'neutral'}
                align="center"
                size="sm"
              />
              <MiniStat
                label="Ошибок"
                value={result.failed}
                tone={result.failed > 0 ? 'bad' : 'neutral'}
                align="center"
                size="sm"
              />
              <MiniStat label="Всего" value={result.total} align="center" size="sm" />
            </div>
            {result.sent === 0 && result.total > 0 && result.skippedDedup === result.total && (
              <p className="mt-3 text-center text-xs text-ink-3">
                Все получатели уже получали это сообщение недавно — анти-спам-фильтр не отправил повторно.
              </p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export default function BroadcastsView({ onGoToSettings }: { onGoToSettings: (s: SettingsSection) => void }) {
  return (
    <div className="space-y-5">
      {/* Anti-spam reassurance */}
      <InfoNote icon={ShieldCheck} tone="ok">
        Защита от спама включена: одному клиенту не уйдёт одинаковое сообщение дважды за короткий срок. Повторы попадают
        в «Дубли» и не тратят деньги.
      </InfoNote>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <ManualBroadcast />
        <AutoMailings onGoToSettings={onGoToSettings} />
      </div>
    </div>
  );
}
