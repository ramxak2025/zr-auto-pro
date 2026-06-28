import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone,
  Plus,
  Trash2,
  Loader2,
  Send,
  Link as LinkIcon,
  X,
  Eye,
  Ban,
  History,
  Filter,
  Users,
  Clock,
  CalendarClock,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { notificationsApi, plansApi } from '../../api/services';
import ConfirmDialog from '../../components/ConfirmDialog';
import type {
  BroadcastButton,
  BroadcastHistoryItem,
  BroadcastSegment,
  BroadcastSubscriptionStatus,
  Plan,
} from '../../types';

interface EditableButton {
  label: string;
  action: 'dismiss' | 'link';
  url: string;
}

type TargetMode = 'all' | 'segment';
type ScheduleMode = 'now' | 'later';
type ActivityMode = 'any' | 'active' | 'dormant';

const MAX_BUTTONS = 3;

const STATUS_OPTIONS: { value: BroadcastSubscriptionStatus; label: string }[] = [
  { value: 'trial', label: 'Триал' },
  { value: 'paid', label: 'Платящие' },
  { value: 'expired', label: 'Истёкшие' },
];

const STATUS_LABELS: Record<BroadcastSubscriptionStatus, string> = {
  trial: 'триал',
  paid: 'платящие',
  expired: 'истёкшие',
};

/** Human Russian summary of a segment for the composer preview and history rows. */
function describeSegment(segment: BroadcastSegment | null | undefined, plans: Plan[] | undefined): string {
  if (!segment) return 'Все владельцы';
  const parts: string[] = [];
  if (segment.planIds?.length) {
    const names = segment.planIds.map((id) => plans?.find((p) => p.id === id)?.name ?? 'тариф');
    parts.push(`тарифы: ${names.join(', ')}`);
  }
  if (segment.subscriptionStatuses?.length) {
    parts.push(`статус: ${segment.subscriptionStatuses.map((s) => STATUS_LABELS[s]).join(', ')}`);
  }
  if (segment.activity) {
    parts.push(`${segment.activity === 'active' ? 'активные' : 'спящие'} за ${segment.activityWindowDays ?? 30} дн.`);
  }
  if (segment.includeInactive) parts.push('включая отключённые');
  return parts.length ? parts.join(' · ') : 'Все владельцы';
}

/** Local `Date` → `YYYY-MM-DDTHH:mm` for <input type="datetime-local">. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press-soft rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function AdminBroadcastPage() {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [buttons, setButtons] = useState<EditableButton[]>([]);

  // 096 — targeting
  const [targetMode, setTargetMode] = useState<TargetMode>('all');
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<BroadcastSubscriptionStatus[]>([]);
  const [activity, setActivity] = useState<ActivityMode>('any');
  const [activityWindowDays, setActivityWindowDays] = useState(30);
  const [includeInactive, setIncludeInactive] = useState(false);

  // 096 — scheduling
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const { data: plans } = useQuery({
    queryKey: ['admin-broadcast-plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => res.data as Plan[],
    staleTime: 5 * 60_000,
  });

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ['admin-broadcasts'],
    queryFn: () => notificationsApi.listBroadcasts(),
    select: (res) => res.data as BroadcastHistoryItem[],
  });

  const buildSegment = (): BroadcastSegment | undefined => {
    if (targetMode === 'all') return undefined;
    const seg: BroadcastSegment = {};
    if (planIds.length) seg.planIds = planIds;
    if (statuses.length) seg.subscriptionStatuses = statuses;
    if (activity !== 'any') {
      seg.activity = activity;
      seg.activityWindowDays = activityWindowDays;
    }
    if (includeInactive) seg.includeInactive = true;
    return Object.keys(seg).length > 0 ? seg : undefined;
  };

  const resetForm = () => {
    setTitle('');
    setBody('');
    setImageUrl('');
    setButtons([]);
    setTargetMode('all');
    setPlanIds([]);
    setStatuses([]);
    setActivity('any');
    setActivityWindowDays(30);
    setIncludeInactive(false);
    setScheduleMode('now');
    setScheduledAt('');
  };

  const sendMutation = useMutation({
    mutationFn: () => {
      const payloadButtons: BroadcastButton[] = buttons
        .filter((b) => b.label.trim())
        .map((b) =>
          b.action === 'link'
            ? { label: b.label.trim(), action: 'link', url: b.url.trim() }
            : { label: b.label.trim(), action: 'dismiss' },
        );
      const scheduledIso = scheduleMode === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
      return notificationsApi.createBroadcast({
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim() || undefined,
        buttons: payloadButtons.length ? payloadButtons : undefined,
        segment: buildSegment(),
        scheduledAt: scheduledIso,
      });
    },
    onSuccess: () => {
      toast.success(scheduleMode === 'later' ? 'Рассылка запланирована' : 'Рассылка отправлена');
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось отправить рассылку');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.cancelBroadcast(id),
    onSuccess: () => {
      toast.success('Рассылка отменена');
      queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось отменить рассылку');
    },
  });

  const addButton = () => {
    if (buttons.length >= MAX_BUTTONS) return;
    setButtons((prev) => [...prev, { label: '', action: 'dismiss', url: '' }]);
  };

  const updateButton = (index: number, patch: Partial<EditableButton>) => {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const removeButton = (index: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  };

  const togglePlan = (id: string) =>
    setPlanIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleStatus = (s: BroadcastSubscriptionStatus) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const linkButtonsValid = buttons.every((b) => b.action !== 'link' || b.url.trim().length > 0);
  const scheduleValid = scheduleMode === 'now' || (!!scheduledAt && new Date(scheduledAt).getTime() > Date.now());
  const canSend =
    title.trim().length > 0 && body.trim().length > 0 && linkButtonsValid && scheduleValid && !sendMutation.isPending;

  const previewSegment = buildSegment();
  const recipientsText = targetMode === 'all' ? 'Все владельцы автосервисов' : describeSegment(previewSegment, plans);
  const isScheduled = scheduleMode === 'later' && !!scheduledAt;
  const whenText = isScheduled ? format(new Date(scheduledAt), 'd MMM yyyy, HH:mm', { locale: ru }) : 'сейчас';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error('Заполните заголовок и текст');
      return;
    }
    if (!linkButtonsValid) {
      toast.error('У кнопок-ссылок укажите URL');
      return;
    }
    if (scheduleMode === 'later' && !scheduledAt) {
      toast.error('Выберите дату и время отправки');
      return;
    }
    if (scheduleMode === 'later' && new Date(scheduledAt).getTime() <= Date.now()) {
      toast.error('Время отправки должно быть в будущем');
      return;
    }
    setConfirmSendOpen(true);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Рассылка владельцам</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Composer */}
        <form onSubmit={handleSubmit} className="card card-body space-y-5 self-start">
          <div className="flex items-center gap-2 text-gray-500">
            <Megaphone className="w-5 h-5" />
            <span className="text-sm">Объявление получат директора выбранных автосервисов.</span>
          </div>

          <div>
            <label className="label">Заголовок</label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Обновление приложения"
              maxLength={120}
              required
            />
          </div>

          <div>
            <label className="label">Текст</label>
            <textarea
              className="input"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Что нового / что нужно сделать владельцам"
              maxLength={1000}
              required
            />
          </div>

          <div>
            <label className="label">Картинка (URL, необязательно)</label>
            <input
              type="url"
              className="input"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* Buttons editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Кнопки (до {MAX_BUTTONS})</label>
              <button
                type="button"
                onClick={addButton}
                disabled={buttons.length >= MAX_BUTTONS}
                className="btn-ghost btn-sm"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </button>
            </div>

            {buttons.length === 0 ? (
              <p className="text-xs text-gray-400">Без кнопок объявление можно будет только закрыть.</p>
            ) : (
              <div className="space-y-3">
                {buttons.map((btn, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="input"
                        value={btn.label}
                        onChange={(e) => updateButton(i, { label: e.target.value })}
                        placeholder="Текст кнопки"
                        maxLength={40}
                      />
                      <button
                        type="button"
                        onClick={() => removeButton(i)}
                        className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                        title="Удалить кнопку"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="input flex-shrink-0 w-36"
                        value={btn.action}
                        onChange={(e) => updateButton(i, { action: e.target.value as 'dismiss' | 'link' })}
                      >
                        <option value="dismiss">Закрыть</option>
                        <option value="link">Ссылка</option>
                      </select>
                      {btn.action === 'link' && (
                        <input
                          type="url"
                          className="input"
                          value={btn.url}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                          placeholder="https://..."
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Targeting (segments) ───────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-900">Кому отправить</span>
            </div>

            <Segmented<TargetMode>
              value={targetMode}
              onChange={setTargetMode}
              options={[
                { value: 'all', label: 'Всем' },
                { value: 'segment', label: 'По сегменту' },
              ]}
            />

            {targetMode === 'segment' && (
              <div className="space-y-4 pt-1">
                {/* Plans */}
                <div>
                  <p className="label">Тариф</p>
                  {plans && plans.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {plans.map((p) => (
                        <Chip key={p.id} active={planIds.includes(p.id)} onClick={() => togglePlan(p.id)}>
                          {p.name}
                        </Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">Тарифы загружаются…</p>
                  )}
                </div>

                {/* Subscription status */}
                <div>
                  <p className="label">Статус подписки</p>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((s) => (
                      <Chip key={s.value} active={statuses.includes(s.value)} onClick={() => toggleStatus(s.value)}>
                        {s.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                {/* Activity */}
                <div>
                  <p className="label">Активность</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Segmented<ActivityMode>
                      value={activity}
                      onChange={setActivity}
                      options={[
                        { value: 'any', label: 'Любая' },
                        { value: 'active', label: 'Активные' },
                        { value: 'dormant', label: 'Спящие' },
                      ]}
                    />
                    {activity !== 'any' && (
                      <label className="flex items-center gap-2 text-sm text-gray-600">
                        окно
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={activityWindowDays}
                          onChange={(e) =>
                            setActivityWindowDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))
                          }
                          className="input w-20 py-1.5"
                        />
                        дн.
                      </label>
                    )}
                  </div>
                </div>

                {/* Include inactive */}
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={(e) => setIncludeInactive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  Включить отключённые компании
                </label>
              </div>
            )}

            {/* Recipients summary */}
            <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
              <Users className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <span className="text-gray-500">Получатели: </span>
                <span className="font-medium text-gray-900">{recipientsText}</span>
                {targetMode === 'segment' && (
                  <p className="text-xs text-gray-400 mt-0.5">Точное число рассчитывается в момент отправки.</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Scheduling ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-900">Когда отправить</span>
            </div>

            <Segmented<ScheduleMode>
              value={scheduleMode}
              onChange={setScheduleMode}
              options={[
                { value: 'now', label: 'Сейчас' },
                { value: 'later', label: 'Запланировать' },
              ]}
            />

            {scheduleMode === 'later' && (
              <div>
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduledAt}
                  min={toLocalInputValue(new Date())}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                {scheduledAt && !scheduleValid && (
                  <p className="text-xs text-red-500 mt-1">Время отправки должно быть в будущем.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-gray-200">
            <p className="text-xs text-gray-400">{isScheduled ? `Отправится ${whenText}` : 'Отправится сразу'}</p>
            <button type="submit" disabled={!canSend} className="btn-primary">
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isScheduled ? 'Планирование…' : 'Отправка…'}
                </>
              ) : isScheduled ? (
                <>
                  <CalendarClock className="w-4 h-4" />
                  Запланировать
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Отправить
                </>
              )}
            </button>
          </div>
        </form>

        {/* Live preview — center card */}
        <div className="self-start">
          <p className="text-sm font-medium text-gray-500 mb-3">Предпросмотр</p>
          <div className="rounded-3xl bg-gray-100 p-6 flex items-center justify-center min-h-[320px]">
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden">
              {imageUrl.trim() && (
                <img
                  src={imageUrl.trim()}
                  alt=""
                  className="w-full h-40 object-cover bg-gray-100"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="p-5">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary-50 mx-auto mb-3">
                  <Megaphone className="w-6 h-6 text-primary-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 text-center">
                  {title.trim() || 'Заголовок объявления'}
                </h3>
                <p className="text-sm text-gray-600 text-center mt-2 whitespace-pre-line">
                  {body.trim() || 'Здесь будет текст вашего объявления для владельцев автосервисов.'}
                </p>

                <div className="mt-5 space-y-2">
                  {buttons.filter((b) => b.label.trim()).length === 0 ? (
                    <button
                      type="button"
                      disabled
                      className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white font-semibold py-2.5 rounded-xl"
                    >
                      <X className="w-4 h-4" />
                      Понятно
                    </button>
                  ) : (
                    buttons
                      .filter((b) => b.label.trim())
                      .map((b, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled
                          className={`w-full flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl ${
                            i === 0 ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {b.action === 'link' && <LinkIcon className="w-4 h-4" />}
                          {b.label.trim()}
                        </button>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Delivery summary chips under the preview */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="badge-gray inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {targetMode === 'all' ? 'Всем' : 'Сегмент'}
            </span>
            <span className="badge-blue inline-flex items-center gap-1">
              {isScheduled ? <CalendarClock className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              {isScheduled ? whenText : 'Сразу'}
            </span>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="mt-10">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">История рассылок</h2>
        </div>

        {historyLoading ? (
          <div className="card card-body flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="ml-2 text-sm">Загрузка...</span>
          </div>
        ) : historyError ? (
          <div className="card card-body text-center py-10">
            <p className="text-sm text-red-600">Не удалось загрузить историю рассылок.</p>
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] })}
              className="btn-secondary btn-sm mt-3"
            >
              Повторить
            </button>
          </div>
        ) : !history || history.length === 0 ? (
          <div className="card card-body text-center py-10 text-gray-400">
            <Megaphone className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Вы ещё не отправляли рассылок.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => {
              const isCancelled = item.cancelledAt !== null;
              const isScheduledPending = !isCancelled && item.sentAt === null && item.scheduledAt !== null;
              const isSent = !isCancelled && item.sentAt !== null;
              const isCancelling = cancelMutation.isPending && cancelMutation.variables === item.id;
              const segmentText = item.targetAll ? 'Всем' : describeSegment(item.segment, plans);
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3.5 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">{item.title}</span>
                      {isCancelled ? (
                        <span className="badge-red text-xs">Отменена</span>
                      ) : isScheduledPending ? (
                        <span className="badge-blue text-xs inline-flex items-center gap-1">
                          <CalendarClock className="w-3 h-3" />
                          Запланировано
                        </span>
                      ) : (
                        <span className="badge-green text-xs inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Отправлено
                        </span>
                      )}
                      <span className="badge-gray text-xs inline-flex items-center gap-1" title={segmentText}>
                        <Users className="w-3 h-3" />
                        <span className="max-w-[220px] truncate">{segmentText}</span>
                      </span>
                    </div>
                    {item.body && <p className="text-sm text-gray-600 mt-1 line-clamp-2">{item.body}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                      {isScheduledPending && item.scheduledAt ? (
                        <span className="inline-flex items-center gap-1 text-blue-600">
                          <Clock className="w-3.5 h-3.5" />
                          отправка {format(parseISO(item.scheduledAt), 'd MMM yyyy, HH:mm', { locale: ru })}
                        </span>
                      ) : isSent && item.sentAt ? (
                        <span>отправлено {format(parseISO(item.sentAt), 'd MMM yyyy, HH:mm', { locale: ru })}</span>
                      ) : (
                        <span>создано {format(parseISO(item.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })}</span>
                      )}
                      {isSent && item.recipientCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {item.recipientCount} {item.recipientCount === 1 ? 'получатель' : 'получателей'}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        {item.seenCount} {item.seenCount === 1 ? 'просмотр' : 'просмотров'}
                      </span>
                      {isCancelled && (
                        <span>
                          отменена {format(parseISO(item.cancelledAt as string), 'd MMM, HH:mm', { locale: ru })}
                        </span>
                      )}
                    </div>
                  </div>

                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => setCancelId(item.id)}
                      disabled={isCancelling}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-white border border-gray-200 hover:bg-red-50 hover:border-red-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                      Отменить
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm: send / schedule new broadcast */}
      <ConfirmDialog
        isOpen={confirmSendOpen}
        onClose={() => setConfirmSendOpen(false)}
        onConfirm={() => sendMutation.mutate()}
        title={isScheduled ? 'Запланировать рассылку' : 'Отправить рассылку'}
        message={`Получатели: ${recipientsText}. Время отправки: ${whenText}.`}
        confirmText={isScheduled ? 'Запланировать' : 'Отправить'}
        variant="primary"
      />

      {/* Confirm: cancel an active / scheduled broadcast */}
      <ConfirmDialog
        isOpen={!!cancelId}
        onClose={() => setCancelId(null)}
        onConfirm={() => {
          if (cancelId) cancelMutation.mutate(cancelId);
          setCancelId(null);
        }}
        title="Отменить рассылку"
        message="Объявление перестанет показываться владельцам (а запланированное — не отправится). Это действие нельзя отменить."
        confirmText="Отменить рассылку"
        variant="danger"
      />
    </div>
  );
}
