import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, CreditCard, Link2, MessageSquareText, Plus, Star, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { installmentsApi, marketingApi } from '../../api/services';
import type {
  CarReadyNotificationSettings,
  InstallmentReminderSettings,
  ReminderSettings,
  ReviewPlatformLink,
  ReviewSettings,
} from '../../types';
import { LoadingBlock, SaveButton, SectionCard, Toggle, VarChips } from './marketingKit';

// Deep-link anchors — auto-mailings & reputation jump here.
export type SettingsSection = 'platforms' | 'review' | 'installments' | 'service' | 'car-ready';

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      {children}
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
const PLATFORM_BADGE: Record<string, string> = {
  google: 'bg-blue-50 text-blue-600',
  yandex: 'bg-red-50 text-red-600',
  '2gis': 'bg-green-50 text-green-600',
  avito: 'bg-emerald-50 text-emerald-600',
};

function PlatformLinksCard() {
  const qc = useQueryClient();
  const { data: links = [], isLoading } = useQuery({
    queryKey: ['marketing', 'platform-links'],
    queryFn: () => marketingApi.getPlatformLinks().then((r) => r.data),
  });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ platform: 'google', url: '' });

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
      iconClass="bg-primary-50 text-primary-600"
      title="Площадки для отзывов"
      subtitle="Куда ведём довольных клиентов оставить отзыв"
      right={
        <button
          onClick={() => setShowForm((v) => !v)}
          className="press-soft rounded-lg p-1 text-primary-600 hover:bg-primary-50"
          aria-label="Добавить"
        >
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      {showForm && (
        <div className="mb-4 space-y-3 rounded-xl bg-gray-50 p-3">
          <div>
            <label className="label">Площадка</label>
            <select
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
              className="input"
            >
              <option value="google">Google Maps</option>
              <option value="yandex">Яндекс</option>
              <option value="2gis">2ГИС</option>
              <option value="avito">Авито</option>
            </select>
          </div>
          <div>
            <label className="label">Ссылка</label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="input"
              placeholder="https://..."
            />
          </div>
          <button
            onClick={() => form.url.trim() && upsert.mutate({ platform: form.platform, url: form.url.trim() })}
            disabled={upsert.isPending}
            className="btn-primary btn-sm w-full"
          >
            Сохранить
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingBlock className="py-6" />
      ) : links.length === 0 && !showForm ? (
        <p className="py-4 text-center text-sm text-gray-400">Добавьте ссылки на площадки для отзывов</p>
      ) : (
        <div className="space-y-2">
          {links.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`badge ${PLATFORM_BADGE[l.platform] || 'bg-gray-100 text-gray-600'}`}>
                  {PLATFORM_LABELS[l.platform] || l.platform}
                </span>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-xs text-blue-500 hover:underline"
                >
                  {l.url}
                </a>
              </div>
              <button
                onClick={() => remove.mutate(l.id)}
                className="press-soft flex-shrink-0 p-1 text-gray-400 hover:text-red-500"
                aria-label="Удалить"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── По отзывам (запрос + автоотправка) ─────────────────────────────
function ReviewRequestCard() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
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
    <SectionCard
      icon={Star}
      iconClass="bg-amber-50 text-amber-600"
      title="Текст запроса отзыва"
      subtitle="Уходит клиенту после закрытия заказ-наряда"
    >
      {isLoading || !settings ? (
        <LoadingBlock className="py-6" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Автоотправка</p>
              <p className="text-xs text-gray-500">Отправлять запрос отзыва автоматически</p>
            </div>
            <Toggle
              checked={!!form.autoSendEnabled}
              onChange={(v) => set({ autoSendEnabled: v })}
              label="Автоотправка отзывов"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Время отправки</label>
              <input
                type="time"
                value={form.sendTime || '20:00'}
                onChange={(e) => set({ sendTime: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label">Задержка (часов)</label>
              <input
                type="number"
                min={0}
                max={48}
                value={form.feedbackDelayHours ?? 2}
                onChange={(e) => set({ feedbackDelayHours: parseInt(e.target.value) || 0 })}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Шаблон сообщения</label>
            <textarea
              rows={4}
              value={form.messageTemplate || ''}
              onChange={(e) => set({ messageTemplate: e.target.value })}
              className="input resize-none"
            />
            <div className="mt-2">
              <VarChips vars={['{clientName}', '{tenantName}', '{reviewLink}', '{motivation}']} />
            </div>
          </div>

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
function InstallmentReminderCard() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
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

  const modes: { key: InstallmentReminderSettings['mode']; label: string }[] = [
    { key: 'off', label: 'Выкл' },
    { key: 'auto', label: 'Авто' },
    { key: 'manual', label: 'Вручную' },
  ];

  return (
    <SectionCard
      icon={CreditCard}
      iconClass="bg-indigo-50 text-indigo-600"
      title="Напоминания по рассрочкам"
      subtitle="Клиенту о предстоящем платеже"
    >
      {isLoading || !settings ? (
        <LoadingBlock className="py-6" />
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Режим</label>
            <div className="flex gap-2">
              {modes.map((m) => (
                <button
                  key={m.key}
                  onClick={() => set({ mode: m.key })}
                  className={`press-soft flex-1 rounded-xl border py-2 text-xs font-semibold transition-colors ${
                    form.mode === m.key
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-transparent bg-gray-50 text-gray-500'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {form.mode !== 'off' && (
            <>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="label">За сколько дней напомнить</label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={form.daysBefore ?? 3}
                    onChange={(e) => set({ daysBefore: parseInt(e.target.value) || 0 })}
                    className="input"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-700">Напоминать в день платежа</p>
                <Toggle checked={!!form.onDue} onChange={(v) => set({ onDue: v })} label="В день платежа" />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-700">Напоминать по просрочке</p>
                <Toggle checked={!!form.onOverdue} onChange={(v) => set({ onOverdue: v })} label="По просрочке" />
              </div>
            </>
          )}

          <div>
            <label className="label">Шаблон сообщения</label>
            <textarea
              rows={3}
              value={form.template || ''}
              onChange={(e) => set({ template: e.target.value })}
              className="input resize-none"
            />
            <div className="mt-2">
              <VarChips vars={['{clientName}', '{amount}', '{date}']} />
            </div>
          </div>

          {dirty && <SaveButton onClick={() => save.mutate(form)} saving={save.isPending} />}
        </div>
      )}
    </SectionCard>
  );
}

// ─── По записям / визитам (ТО-напоминание) ──────────────────────────
function ServiceReminderCard() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
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
      iconClass="bg-sky-50 text-sky-600"
      title="Напоминание о визите"
      subtitle="Приглашаем на плановое ТО тех, кто давно не приезжал"
      right={<Toggle checked={!!form.enabled} onChange={(v) => set({ enabled: v })} label="Напоминание о визите" />}
    >
      {isLoading || !settings ? (
        <LoadingBlock className="py-6" />
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Интервал (месяцев)</label>
            <input
              type="number"
              min={1}
              max={36}
              value={form.monthsInterval ?? 6}
              onChange={(e) => set({ monthsInterval: parseInt(e.target.value) || 1 })}
              className="input"
            />
            <p className="mt-1 text-xs text-gray-400">Через сколько месяцев после последнего визита напомнить</p>
          </div>
          <div>
            <label className="label">Шаблон сообщения</label>
            <textarea
              rows={3}
              value={form.messageTemplate || ''}
              onChange={(e) => set({ messageTemplate: e.target.value })}
              className="input resize-none"
            />
            <div className="mt-2">
              <VarChips vars={['{name}', '{months}']} />
            </div>
          </div>
          {dirty && <SaveButton onClick={() => save.mutate(form)} saving={save.isPending} />}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Готовность авто ────────────────────────────────────────────────
function CarReadyCard() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
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
      iconClass="bg-emerald-50 text-emerald-600"
      title="Уведомление «Машина готова»"
      subtitle="Уходит клиенту, когда заказ-наряд переходит в статус «Готов»"
      right={<Toggle checked={form.enabled} onChange={(v) => set({ enabled: v })} label="Уведомление о готовности" />}
    >
      {isLoading || !settings ? (
        <LoadingBlock className="py-6" />
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">Шаблон сообщения</label>
            <textarea
              rows={3}
              value={form.messageTemplate}
              onChange={(e) => set({ messageTemplate: e.target.value })}
              placeholder="Здравствуйте, {clientName}! Ваш автомобиль {car} по заказу {number} готов к выдаче."
              className="input resize-none"
            />
            <div className="mt-2">
              <VarChips vars={['{number}', '{car}', '{clientName}']} />
            </div>
          </div>
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
      <div className="flex items-start gap-2 rounded-xl bg-gray-50 px-3.5 py-3">
        <MessageSquareText className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
        <p className="text-xs text-gray-500">
          Здесь — площадки для отзывов и тексты всех автоматических сообщений. Сами каналы (WhatsApp, SMS, Telegram)
          подключаются в разделе «Интеграции».
        </p>
      </div>

      <Anchor id="settings-platforms">
        <PlatformLinksCard />
      </Anchor>
      <Anchor id="settings-review">
        <ReviewRequestCard />
      </Anchor>
      <Anchor id="settings-installments">
        <InstallmentReminderCard />
      </Anchor>
      <Anchor id="settings-service">
        <ServiceReminderCard />
      </Anchor>
      <Anchor id="settings-car-ready">
        <CarReadyCard />
      </Anchor>
    </div>
  );
}
