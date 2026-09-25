import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  CreditCard,
  ExternalLink,
  Link2,
  MessageSquareText,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { installmentsApi, marketingApi } from '../../api/services';
import type {
  CarReadyNotificationSettings,
  InstallmentReminderSettings,
  ReminderSettings,
  ReviewPlatformLink,
  ReviewSettings,
} from '../../types';
import ConfirmDialog from '../ConfirmDialog';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { InfoNote, LoadingBlock, SaveButton, SectionCard, SectionError, Toggle, VarChips } from './marketingKit';

// Deep-link anchors — auto-mailings & reputation jump here.
export type SettingsSection = 'platforms' | 'review' | 'installments' | 'service' | 'car-ready';

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      {children}
    </div>
  );
}

/** Строка «подпись + тумблер» внутри карточки настроек. */
function ToggleRow({
  title,
  description,
  checked,
  onChange,
  label,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="text-xs text-ink-3">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

// ─── Площадки для отзывов ───────────────────────────────────────────
const PLATFORM_LABELS: Record<string, string> = {
  google: 'Google Maps',
  yandex: 'Яндекс',
  '2gis': '2ГИС',
  avito: 'Авито',
};
const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }));

function PlatformLinksCard() {
  const qc = useQueryClient();
  const {
    data: links = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'platform-links'],
    queryFn: () => marketingApi.getPlatformLinks().then((r) => r.data),
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ platform: 'google', url: '' });
  const [toRemove, setToRemove] = useState<ReviewPlatformLink | null>(null);

  const upsert = useMutation({
    mutationFn: (data: { platform: string; url: string }) => marketingApi.upsertPlatformLink(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'platform-links'], fresh);
      setShowForm(false);
      setForm({ platform: 'google', url: '' });
      toast.success('Ссылка сохранена');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => marketingApi.removePlatformLink(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<ReviewPlatformLink[]>(['marketing', 'platform-links'], (prev) =>
        (prev ?? []).filter((l) => l.id !== id),
      );
      toast.success('Удалено');
    },
    onError: () => toast.error('Ошибка удаления'),
  });

  return (
    <SectionCard
      icon={Link2}
      iconTone="accent"
      title="Площадки для отзывов"
      subtitle="Куда ведём довольных клиентов оставить отзыв"
      right={
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          aria-expanded={showForm}
          onClick={() => setShowForm((v) => !v)}
        >
          Добавить
        </Button>
      }
    >
      {showForm && (
        <form
          className="mb-4 space-y-3 rounded-lg border border-line bg-surface-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.url.trim()) upsert.mutate({ platform: form.platform, url: form.url.trim() });
          }}
        >
          <Field label="Площадка" htmlFor="platform-kind">
            <Select
              id="platform-kind"
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
              options={PLATFORM_OPTIONS}
            />
          </Field>
          <Field label="Ссылка" htmlFor="platform-url">
            <Input
              id="platform-url"
              type="url"
              inputMode="url"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>
              Отмена
            </Button>
            <Button type="submit" size="sm" loading={upsert.isPending} disabled={!form.url.trim()}>
              Сохранить
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <LoadingBlock lines={2} />
      ) : isError ? (
        <SectionError message="Не удалось загрузить площадки" onRetry={() => refetch()} loading={isFetching} />
      ) : links.length === 0 && !showForm ? (
        <p className="py-2 text-sm text-ink-3">Добавьте ссылки на площадки для отзывов</p>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge outline>{PLATFORM_LABELS[l.platform] || l.platform}</Badge>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'inline-flex min-w-0 items-center gap-1 truncate text-xs text-accent-text hover:underline',
                    focusRing,
                  )}
                >
                  <span className="truncate">{l.url}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                </a>
              </div>
              <IconButton
                label="Удалить ссылку"
                icon={Trash2}
                size="sm"
                variant="danger"
                onClick={() => setToRemove(l)}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && remove.mutate(toRemove.id)}
        title="Удалить площадку"
        message={`Ссылка на ${toRemove ? PLATFORM_LABELS[toRemove.platform] || toRemove.platform : ''} будет удалена — клиентов туда больше не поведём. Продолжить?`}
        confirmText="Удалить"
        variant="danger"
      />
    </SectionCard>
  );
}

// ─── По отзывам (запрос + автоотправка) ─────────────────────────────
function ReviewRequestCard() {
  const qc = useQueryClient();
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'settings'],
    queryFn: () => marketingApi.getSettings().then((r) => r.data),
  });
  const [form, setForm] = useState<Partial<ReviewSettings>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);
  const set = (patch: Partial<ReviewSettings>) => {
    setForm((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (data: Partial<ReviewSettings>) => marketingApi.updateSettings(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'settings'], fresh);
      setDirty(false);
      toast.success('Сохранено');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <SectionCard icon={Star} title="Текст запроса отзыва" subtitle="Уходит клиенту после закрытия заказ-наряда">
      {isLoading ? (
        <LoadingBlock lines={3} />
      ) : isError || !settings ? (
        <SectionError message="Не удалось загрузить настройки отзывов" onRetry={() => refetch()} loading={isFetching} />
      ) : (
        <div className="space-y-4">
          <ToggleRow
            title="Автоотправка"
            description="Отправлять запрос отзыва автоматически"
            checked={!!form.autoSendEnabled}
            onChange={(v) => set({ autoSendEnabled: v })}
            label="Автоотправка отзывов"
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Время отправки" htmlFor="review-time">
              <Input
                id="review-time"
                type="time"
                value={form.sendTime || '20:00'}
                onChange={(e) => set({ sendTime: e.target.value })}
              />
            </Field>
            <Field label="Задержка после закрытия" htmlFor="review-delay">
              <Input
                id="review-delay"
                inputMode="numeric"
                value={form.feedbackDelayHours ?? 2}
                onChange={(e) => set({ feedbackDelayHours: Math.max(0, Math.min(48, parseInt(e.target.value) || 0)) })}
                rightSlot={<span className="text-sm text-ink-3">ч</span>}
              />
            </Field>
          </div>

          <Field label="Шаблон сообщения" htmlFor="review-template">
            <Textarea
              id="review-template"
              rows={4}
              value={form.messageTemplate || ''}
              onChange={(e) => set({ messageTemplate: e.target.value })}
            />
            <div className="mt-2">
              <VarChips vars={['{clientName}', '{tenantName}', '{reviewLink}', '{motivation}']} />
            </div>
          </Field>

          {dirty && (
            <SaveButton
              onClick={() =>
                save.mutate({
                  autoSendEnabled: form.autoSendEnabled,
                  sendTime: form.sendTime,
                  feedbackDelayHours: form.feedbackDelayHours,
                  messageTemplate: form.messageTemplate,
                })
              }
              saving={save.isPending}
            />
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── По рассрочкам ──────────────────────────────────────────────────
const INSTALLMENT_MODES: { value: InstallmentReminderSettings['mode']; label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'auto', label: 'Авто' },
  { value: 'manual', label: 'Вручную' },
];

function InstallmentReminderCard() {
  const qc = useQueryClient();
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['installments', 'reminder-settings'],
    queryFn: () => installmentsApi.getReminderSettings().then((r) => r.data),
  });
  const [form, setForm] = useState<Partial<InstallmentReminderSettings>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);
  const set = (patch: Partial<InstallmentReminderSettings>) => {
    setForm((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (data: Partial<InstallmentReminderSettings>) =>
      installmentsApi.updateReminderSettings(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['installments', 'reminder-settings'], fresh);
      setDirty(false);
      toast.success('Сохранено');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <SectionCard icon={CreditCard} title="Напоминания по рассрочкам" subtitle="Клиенту о предстоящем платеже">
      {isLoading ? (
        <LoadingBlock lines={3} />
      ) : isError || !settings ? (
        <SectionError
          message="Не удалось загрузить настройки напоминаний"
          onRetry={() => refetch()}
          loading={isFetching}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="label">Режим</p>
            <SegmentedControl
              aria-label="Режим напоминаний по рассрочкам"
              fullWidth
              value={form.mode ?? 'off'}
              onChange={(mode) => set({ mode })}
              options={INSTALLMENT_MODES}
            />
          </div>

          {form.mode !== 'off' && (
            <>
              <Field label="За сколько дней напомнить" htmlFor="inst-days">
                <Input
                  id="inst-days"
                  inputMode="numeric"
                  value={form.daysBefore ?? 3}
                  onChange={(e) => set({ daysBefore: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)) })}
                  rightSlot={<span className="text-sm text-ink-3">дн.</span>}
                />
              </Field>
              <ToggleRow
                title="Напоминать в день платежа"
                checked={!!form.onDue}
                onChange={(v) => set({ onDue: v })}
                label="В день платежа"
              />
              <ToggleRow
                title="Напоминать по просрочке"
                checked={!!form.onOverdue}
                onChange={(v) => set({ onOverdue: v })}
                label="По просрочке"
              />
            </>
          )}

          <Field label="Шаблон сообщения" htmlFor="inst-template">
            <Textarea
              id="inst-template"
              rows={3}
              value={form.template || ''}
              onChange={(e) => set({ template: e.target.value })}
            />
            <div className="mt-2">
              <VarChips vars={['{clientName}', '{amount}', '{date}']} />
            </div>
          </Field>

          {dirty && <SaveButton onClick={() => save.mutate(form)} saving={save.isPending} />}
        </div>
      )}
    </SectionCard>
  );
}

// ─── По записям / визитам (ТО-напоминание) ──────────────────────────
function ServiceReminderCard() {
  const qc = useQueryClient();
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'reminders'],
    queryFn: () => marketingApi.getReminderSettings().then((r) => r.data),
  });
  const [form, setForm] = useState<Partial<ReminderSettings>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);
  const set = (patch: Partial<ReminderSettings>) => {
    setForm((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (data: Partial<ReminderSettings>) => marketingApi.updateReminderSettings(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'reminders'], fresh);
      setDirty(false);
      toast.success('Сохранено');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <SectionCard
      icon={CalendarClock}
      title="Напоминание о визите"
      subtitle="Приглашаем на плановое ТО тех, кто давно не приезжал"
      right={
        settings ? (
          <Toggle checked={!!form.enabled} onChange={(v) => set({ enabled: v })} label="Напоминание о визите" />
        ) : undefined
      }
    >
      {isLoading ? (
        <LoadingBlock lines={3} />
      ) : isError || !settings ? (
        <SectionError
          message="Не удалось загрузить настройки напоминаний"
          onRetry={() => refetch()}
          loading={isFetching}
        />
      ) : (
        <div className="space-y-4">
          <Field
            label="Интервал"
            htmlFor="service-interval"
            hint="Через сколько месяцев после последнего визита напомнить"
          >
            <Input
              id="service-interval"
              inputMode="numeric"
              value={form.monthsInterval ?? 6}
              onChange={(e) => set({ monthsInterval: Math.max(1, Math.min(36, parseInt(e.target.value) || 1)) })}
              rightSlot={<span className="text-sm text-ink-3">мес.</span>}
            />
          </Field>
          <Field label="Шаблон сообщения" htmlFor="service-template">
            <Textarea
              id="service-template"
              rows={3}
              value={form.messageTemplate || ''}
              onChange={(e) => set({ messageTemplate: e.target.value })}
            />
            <div className="mt-2">
              <VarChips vars={['{name}', '{months}']} />
            </div>
          </Field>
          {dirty && <SaveButton onClick={() => save.mutate(form)} saving={save.isPending} />}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Готовность авто ────────────────────────────────────────────────
function CarReadyCard() {
  const qc = useQueryClient();
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'car-ready'],
    queryFn: () => marketingApi.getCarReadySettings().then((r) => r.data),
  });
  const [form, setForm] = useState<CarReadyNotificationSettings>({ enabled: false, messageTemplate: '' });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);
  const set = (patch: Partial<CarReadyNotificationSettings>) => {
    setForm((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (data: Partial<CarReadyNotificationSettings>) =>
      marketingApi.updateCarReadySettings(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'car-ready'], fresh);
      setDirty(false);
      toast.success('Сохранено');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <SectionCard
      icon={Bell}
      title="Уведомление «Машина готова»"
      subtitle="Уходит клиенту, когда заказ-наряд переходит в статус «Готов»"
      right={
        settings ? (
          <Toggle checked={form.enabled} onChange={(v) => set({ enabled: v })} label="Уведомление о готовности" />
        ) : undefined
      }
    >
      {isLoading ? (
        <LoadingBlock lines={2} />
      ) : isError || !settings ? (
        <SectionError
          message="Не удалось загрузить настройки уведомления"
          onRetry={() => refetch()}
          loading={isFetching}
        />
      ) : (
        <div className="space-y-3">
          <Field label="Шаблон сообщения" htmlFor="car-ready-template">
            <Textarea
              id="car-ready-template"
              rows={3}
              value={form.messageTemplate}
              onChange={(e) => set({ messageTemplate: e.target.value })}
              placeholder="Здравствуйте, {clientName}! Ваш автомобиль {car} по заказу {number} готов к выдаче."
            />
            <div className="mt-2">
              <VarChips vars={['{number}', '{car}', '{clientName}']} />
            </div>
          </Field>
          {dirty && <SaveButton onClick={() => save.mutate(form)} saving={save.isPending} />}
        </div>
      )}
    </SectionCard>
  );
}

export default function MarketingSettingsView({ focus }: { focus?: SettingsSection | null }) {
  useEffect(() => {
    if (!focus) return;
    const id = `settings-${focus}`;
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [focus]);

  return (
    <div className="space-y-5">
      <InfoNote icon={MessageSquareText}>
        Здесь — площадки для отзывов и тексты всех автоматических сообщений. Сами каналы (WhatsApp, SMS, Telegram)
        подключаются в разделе «Интеграции».
      </InfoNote>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-5">
          <Anchor id="settings-platforms">
            <PlatformLinksCard />
          </Anchor>
          <Anchor id="settings-review">
            <ReviewRequestCard />
          </Anchor>
          <Anchor id="settings-car-ready">
            <CarReadyCard />
          </Anchor>
        </div>
        <div className="space-y-5">
          <Anchor id="settings-installments">
            <InstallmentReminderCard />
          </Anchor>
          <Anchor id="settings-service">
            <ServiceReminderCard />
          </Anchor>
        </div>
      </div>
    </div>
  );
}
