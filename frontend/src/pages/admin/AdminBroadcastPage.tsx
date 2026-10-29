import { useId, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  History,
  Link as LinkIcon,
  Megaphone,
  Plus,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { notificationsApi, plansApi } from '../../api/services';
import PageHeader from '../../components/PageHeader';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import { Badge, StatusPill } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Checkbox } from '../../ui/Checkbox';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { SkeletonText } from '../../ui/Skeleton';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { ToggleChip, formatDateRu } from '../../components/admin/adminUi';
import { pluralRu } from '../../components/knowledge/utils';
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

export default function AdminBroadcastPage() {
  const queryClient = useQueryClient();
  const uid = useId();
  const formId = `${uid}-broadcast-form`;

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
    refetch: refetchHistory,
    isFetching: historyFetching,
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

  const visibleButtons = buttons.filter((b) => b.label.trim());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Рассылка"
        icon={Megaphone}
        subtitle="Объявления владельцам автосервисов — с сегментами и планированием"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
        {/* Композер */}
        <Card padding="none">
          <CardHeader title="Новое объявление" subtitle="Получат директора выбранных автосервисов" />
          <form id={formId} onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
            <Field label="Заголовок" htmlFor={`${uid}-title`} required>
              <Input
                id={`${uid}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Обновление приложения"
                maxLength={120}
                required
              />
            </Field>

            <Field label="Текст" htmlFor={`${uid}-body`} required hint={`${body.length} / 1000`}>
              <Textarea
                id={`${uid}-body`}
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Что нового / что нужно сделать владельцам"
                maxLength={1000}
                required
              />
            </Field>

            <Field label="Картинка (URL, необязательно)" htmlFor={`${uid}-image`}>
              <Input
                id={`${uid}-image`}
                type="url"
                inputMode="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>

            {/* Кнопки объявления */}
            <fieldset>
              <div className="mb-2 flex items-center justify-between gap-2">
                <legend className="float-left text-sm font-medium text-ink-2">Кнопки (до {MAX_BUTTONS})</legend>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Plus}
                  onClick={addButton}
                  disabled={buttons.length >= MAX_BUTTONS}
                >
                  Добавить
                </Button>
              </div>

              {buttons.length === 0 ? (
                <p className="text-xs text-ink-3">Без кнопок объявление можно будет только закрыть.</p>
              ) : (
                <ul className="space-y-3">
                  {buttons.map((btn, i) => (
                    <li key={i} className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={btn.label}
                          onChange={(e) => updateButton(i, { label: e.target.value })}
                          placeholder="Текст кнопки"
                          aria-label={`Текст кнопки ${i + 1}`}
                          maxLength={40}
                        />
                        <IconButton
                          label={`Удалить кнопку ${i + 1}`}
                          icon={Trash2}
                          variant="danger"
                          onClick={() => removeButton(i)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          aria-label={`Действие кнопки ${i + 1}`}
                          className="w-36 flex-shrink-0"
                          value={btn.action}
                          onChange={(e) => updateButton(i, { action: e.target.value as 'dismiss' | 'link' })}
                        >
                          <option value="dismiss">Закрыть</option>
                          <option value="link">Ссылка</option>
                        </Select>
                        {btn.action === 'link' && (
                          <Input
                            type="url"
                            inputMode="url"
                            value={btn.url}
                            onChange={(e) => updateButton(i, { url: e.target.value })}
                            placeholder="https://…"
                            aria-label={`Ссылка кнопки ${i + 1}`}
                            invalid={btn.url.trim().length === 0}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            {/* ── Кому отправить ─────────────────────────────────────────── */}
            <fieldset className="space-y-4 rounded-lg border border-line p-4">
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-ink">
                <Filter className="h-4 w-4 text-ink-3" aria-hidden="true" />
                Кому отправить
              </legend>

              <SegmentedControl<TargetMode>
                aria-label="Получатели"
                value={targetMode}
                onChange={setTargetMode}
                options={[
                  { value: 'all', label: 'Всем' },
                  { value: 'segment', label: 'По сегменту' },
                ]}
              />

              {targetMode === 'segment' && (
                <div className="space-y-4">
                  <Field label="Тариф">
                    {plans && plans.length > 0 ? (
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Тарифы сегмента">
                        {plans.map((p) => (
                          <ToggleChip key={p.id} active={planIds.includes(p.id)} onClick={() => togglePlan(p.id)}>
                            {p.name}
                          </ToggleChip>
                        ))}
                      </div>
                    ) : (
                      <SkeletonText lines={1} className="max-w-xs" />
                    )}
                  </Field>

                  <Field label="Статус подписки">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Статусы подписки">
                      {STATUS_OPTIONS.map((s) => (
                        <ToggleChip
                          key={s.value}
                          active={statuses.includes(s.value)}
                          onClick={() => toggleStatus(s.value)}
                        >
                          {s.label}
                        </ToggleChip>
                      ))}
                    </div>
                  </Field>

                  <Field label="Активность">
                    <div className="flex flex-wrap items-center gap-3">
                      <SegmentedControl<ActivityMode>
                        aria-label="Активность"
                        value={activity}
                        onChange={setActivity}
                        options={[
                          { value: 'any', label: 'Любая' },
                          { value: 'active', label: 'Активные' },
                          { value: 'dormant', label: 'Спящие' },
                        ]}
                      />
                      {activity !== 'any' && (
                        <span className="flex items-center gap-2 text-sm text-ink-2">
                          окно
                          <Input
                            inputMode="numeric"
                            aria-label="Окно активности, дней"
                            value={String(activityWindowDays)}
                            onChange={(e) =>
                              setActivityWindowDays(
                                Math.max(1, Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 1)),
                              )
                            }
                            className="w-20 tabular-nums"
                          />
                          дн.
                        </span>
                      )}
                    </div>
                  </Field>

                  <Checkbox
                    label="Включить отключённые компании"
                    checked={includeInactive}
                    onChange={(e) => setIncludeInactive(e.target.checked)}
                  />
                </div>
              )}

              {/* Сводка по получателям */}
              <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
                <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                <p>
                  <span className="text-ink-3">Получатели: </span>
                  <span className="font-medium text-ink">{recipientsText}</span>
                  {targetMode === 'segment' && (
                    <span className="block text-xs text-ink-3">Точное число рассчитывается в момент отправки.</span>
                  )}
                </p>
              </div>
            </fieldset>

            {/* ── Когда отправить ───────────────────────────────────────── */}
            <fieldset className="space-y-3 rounded-lg border border-line p-4">
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-ink">
                <Clock className="h-4 w-4 text-ink-3" aria-hidden="true" />
                Когда отправить
              </legend>

              <SegmentedControl<ScheduleMode>
                aria-label="Время отправки"
                value={scheduleMode}
                onChange={setScheduleMode}
                options={[
                  { value: 'now', label: 'Сейчас' },
                  { value: 'later', label: 'Запланировать' },
                ]}
              />

              {scheduleMode === 'later' && (
                <Field
                  label="Дата и время"
                  htmlFor={`${uid}-when`}
                  error={scheduledAt && !scheduleValid ? 'Время отправки должно быть в будущем.' : undefined}
                  className="max-w-xs"
                >
                  <Input
                    id={`${uid}-when`}
                    type="datetime-local"
                    className="tabular-nums"
                    value={scheduledAt}
                    min={toLocalInputValue(new Date())}
                    invalid={!!scheduledAt && !scheduleValid}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </Field>
              )}
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-xs text-ink-3">
                {isScheduled ? `Отправится ${whenText}` : 'Отправится сразу после подтверждения'}
              </p>
              <Button
                type="submit"
                icon={isScheduled ? CalendarClock : Send}
                disabled={!canSend}
                loading={sendMutation.isPending}
              >
                {isScheduled ? 'Запланировать' : 'Отправить'}
              </Button>
            </div>
          </form>
        </Card>

        {/* Предпросмотр — прилипает при прокрутке длинного композера */}
        <div className="lg:sticky lg:top-0">
          <Card padding="none">
            <CardHeader as="h2" title="Предпросмотр" subtitle="Так объявление увидит владелец" dense />
            <div className="p-4">
              <div className="flex min-h-[300px] items-center justify-center rounded-lg bg-surface-3 p-5">
                <div
                  className="w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
                  aria-hidden="true"
                >
                  {imageUrl.trim() && (
                    <img
                      src={imageUrl.trim()}
                      alt=""
                      className="h-40 w-full bg-surface-2 object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="p-5">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <Megaphone className="h-6 w-6" />
                    </div>
                    <h3 className="text-center text-md font-semibold text-ink">
                      {title.trim() || 'Заголовок объявления'}
                    </h3>
                    <p className="mt-2 whitespace-pre-line text-center text-sm text-ink-2">
                      {body.trim() || 'Здесь будет текст вашего объявления для владельцев автосервисов.'}
                    </p>

                    <div className="mt-5 space-y-2">
                      {visibleButtons.length === 0 ? (
                        <span className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-white">
                          <X className="h-4 w-4" />
                          Понятно
                        </span>
                      ) : (
                        visibleButtons.map((b, i) => (
                          <span
                            key={i}
                            className={cn(
                              'flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold',
                              i === 0 ? 'bg-accent text-white' : 'bg-surface-3 text-ink',
                            )}
                          >
                            {b.action === 'link' && <LinkIcon className="h-4 w-4" />}
                            {b.label.trim()}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge icon={Users}>{targetMode === 'all' ? 'Всем' : 'Сегмент'}</Badge>
                <Badge tone="accent" icon={isScheduled ? CalendarClock : Send}>
                  {isScheduled ? whenText : 'Сразу'}
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* История */}
      <Card padding="none">
        <CardHeader
          icon={History}
          iconTone="neutral"
          title="История рассылок"
          subtitle={
            history ? `${history.length} ${pluralRu(history.length, 'рассылка', 'рассылки', 'рассылок')}` : undefined
          }
          divider={!!history && history.length > 0}
        />
        {historyLoading ? (
          <div className="space-y-4 px-5 pb-5" aria-busy="true">
            <SkeletonText lines={2} />
            <SkeletonText lines={2} />
          </div>
        ) : (
          <QueryState
            isLoading={false}
            isError={historyError}
            onRetry={refetchHistory}
            isFetching={historyFetching}
            errorTitle="Не удалось загрузить историю рассылок"
            isEmpty={!history || history.length === 0}
            empty={{ icon: Megaphone, title: 'Вы ещё не отправляли рассылок' }}
            minHeight="py-10"
          >
            <ul className="divide-y divide-line">
              {(history ?? []).map((item) => {
                const isCancelled = item.cancelledAt !== null;
                const isScheduledPending = !isCancelled && item.sentAt === null && item.scheduledAt !== null;
                const isSent = !isCancelled && item.sentAt !== null;
                const isCancelling = cancelMutation.isPending && cancelMutation.variables === item.id;
                const segmentText = item.targetAll ? 'Всем' : describeSegment(item.segment, plans);
                return (
                  <li key={item.id} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">{item.title}</h3>
                        {isCancelled ? (
                          <StatusPill tone="bad">Отменена</StatusPill>
                        ) : isScheduledPending ? (
                          <StatusPill tone="info">Запланирована</StatusPill>
                        ) : (
                          <StatusPill tone="ok">Отправлена</StatusPill>
                        )}
                        <Badge icon={Users} title={segmentText} className="max-w-[260px]">
                          {segmentText}
                        </Badge>
                      </div>
                      {item.body && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{item.body}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-3">
                        {isScheduledPending && item.scheduledAt ? (
                          <span className="inline-flex items-center gap-1 text-info-text">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            отправка {formatDateRu(item.scheduledAt)}
                          </span>
                        ) : isSent && item.sentAt ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
                            отправлено {formatDateRu(item.sentAt)}
                          </span>
                        ) : (
                          <span>создано {formatDateRu(item.createdAt)}</span>
                        )}
                        {isSent && item.recipientCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" aria-hidden="true" />
                            {item.recipientCount}{' '}
                            {pluralRu(item.recipientCount, 'получатель', 'получателя', 'получателей')}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          {item.seenCount} {pluralRu(item.seenCount, 'просмотр', 'просмотра', 'просмотров')}
                        </span>
                        {isCancelled && (
                          <span>отменена {formatDateRu(item.cancelledAt as string, 'd MMM, HH:mm')}</span>
                        )}
                      </p>
                    </div>

                    {!isCancelled && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Ban}
                        onClick={() => setCancelId(item.id)}
                        loading={isCancelling}
                        className="flex-shrink-0 text-bad-text"
                      >
                        Отменить
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </QueryState>
        )}
      </Card>

      {/* Подтверждение отправки / планирования */}
      <ConfirmDialog
        isOpen={confirmSendOpen}
        onClose={() => setConfirmSendOpen(false)}
        onConfirm={() => sendMutation.mutate()}
        title={isScheduled ? 'Запланировать рассылку' : 'Отправить рассылку'}
        message={`Получатели: ${recipientsText}. Время отправки: ${whenText}.`}
        confirmText={isScheduled ? 'Запланировать' : 'Отправить'}
        variant="primary"
      />

      {/* Подтверждение отмены активной / запланированной рассылки */}
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
