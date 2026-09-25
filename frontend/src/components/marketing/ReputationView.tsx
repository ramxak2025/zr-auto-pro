import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gift,
  MessageSquare,
  Send,
  Settings2,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { marketingApi } from '../../api/services';
import type { ReviewAlert, ReviewResponse, ReviewSettings } from '../../types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { StatCard } from '../../ui/StatCard';
import { Textarea } from '../../ui/Textarea';
import { Toolbar, ToolbarGroup } from '../../ui/Toolbar';
import { cn } from '../../ui/cn';
import { focusRing, toneChip, toneSoft, toneText } from '../../ui/tokens';
import MasterLeaderboard, { ratingTone } from './MasterLeaderboard';
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
  SaveButton,
  SectionCard,
  SectionError,
  Stars,
  plural,
} from './marketingKit';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
type RatingFilter = 'all' | 'positive' | 'negative';
const RATING_FILTERS: RatingFilter[] = ['all', 'positive', 'negative'];

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Unread negative-review / churn alerts ──────────────────────────
function AlertsCard() {
  const qc = useQueryClient();
  const {
    data: alerts = [],
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'alerts'],
    queryFn: () => marketingApi.getAlerts().then((r) => r.data),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => marketingApi.markAlertRead(id),
    onMutate: (id: string) => {
      qc.setQueryData<ReviewAlert[]>(['marketing', 'alerts'], (prev) =>
        (prev ?? []).map((a) => (a.id === id ? { ...a, isRead: true } : a)),
      );
    },
    onError: () => toast.error('Не удалось отметить'),
  });

  if (isError) {
    return (
      <SectionError
        message="Не удалось загрузить оповещения по отзывам"
        onRetry={() => refetch()}
        loading={isFetching}
      />
    );
  }
  const unread = alerts.filter((a: ReviewAlert) => !a.isRead);
  if (unread.length === 0) return null;

  return (
    <SectionCard icon={Bell} iconTone="bad" title={`Требуют внимания (${unread.length})`} dense bodyPadding="sm">
      <ul className="space-y-2">
        {unread.slice(0, 6).map((a: ReviewAlert) => (
          <li key={a.id} className={cn('flex items-start gap-3 rounded-lg p-3', toneSoft.bad)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-bad" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {a.alertType === 'consecutive_negative'
                  ? `${a.employeeName ?? 'Мастер'}: 3 негативных отзыва подряд`
                  : `Риск ухода клиента: ${a.clientName ?? '—'}`}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">{new Date(a.createdAt).toLocaleDateString('ru-RU')}</p>
            </div>
            <IconButton
              label="Скрыть"
              icon={X}
              size="sm"
              onClick={() => markRead.mutate(a.id)}
              className="-mr-1 -mt-1"
            />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ─── «Подарок за отзыв» + запрос отзыва ─────────────────────────────
function MotivationCard({ onGoToSettings }: { onGoToSettings: () => void }) {
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

  const [motivation, setMotivation] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setMotivation(settings.motivationMessage ?? '');
      setDirty(false);
    }
  }, [settings]);

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
      icon={Gift}
      title="Подарок за отзыв"
      subtitle="Показывается клиенту на странице оценки и подставляется как {motivation} в запросе"
      dense
      bodyPadding="sm"
    >
      {isLoading ? (
        <LoadingBlock lines={2} />
      ) : isError ? (
        <SectionError message="Не удалось загрузить настройки отзывов" onRetry={() => refetch()} loading={isFetching} />
      ) : (
        <div className="space-y-3">
          <Textarea
            rows={2}
            value={motivation}
            aria-label="Текст подарка за отзыв"
            onChange={(e) => {
              setMotivation(e.target.value);
              setDirty(true);
            }}
            placeholder="Например: Замена воздушного фильтра в подарок за честный отзыв"
            className="resize-none"
          />

          <InfoNote icon={Send}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1">
                Запрос отзыва уходит клиенту{' '}
                {settings?.autoSendEnabled ? (
                  <span className="font-medium text-ok-text">автоматически</span>
                ) : (
                  <span className="font-medium">вручную (автоотправка выключена)</span>
                )}{' '}
                после закрытия заказ-наряда.
              </span>
              <Button variant="secondary" size="sm" icon={Settings2} onClick={onGoToSettings}>
                Настроить
              </Button>
            </div>
          </InfoNote>

          {dirty && (
            <SaveButton onClick={() => save.mutate({ motivationMessage: motivation })} saving={save.isPending}>
              Сохранить подарок
            </SaveButton>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Owner reputation hub ───────────────────────────────────────────
function OwnerReputation({ onGoToSettings }: { onGoToSettings: () => void }) {
  // Месяц и фильтр — в URL (?month=2026-09&rating=negative) рядом с вкладкой.
  const [params, setParams] = useSearchParams();
  const rawMonth = params.get('month');
  const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : currentMonthKey();
  const rawFilter = params.get('rating') as RatingFilter | null;
  const filter: RatingFilter = rawFilter && RATING_FILTERS.includes(rawFilter) ? rawFilter : 'all';

  const update = (next: { month?: string; rating?: RatingFilter }) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const m = next.month ?? month;
        const r = next.rating ?? filter;
        if (m === currentMonthKey()) p.delete('month');
        else p.set('month', m);
        if (r === 'all') p.delete('rating');
        else p.set('rating', r);
        return p;
      },
      { replace: true },
    );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedMasterId, setSelectedMasterId] = useState<string | null>(null);

  const {
    data: reviews = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'reviews', month],
    queryFn: () => marketingApi.getReviews({ month }).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-');
    const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [month]);

  const shiftMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    update({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  };

  const total = reviews.length;
  const avgRating = total > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
  const positiveCount = reviews.filter((r) => r.rating >= 4).length;
  const negativeCount = reviews.filter((r) => r.rating <= 3).length;

  const filteredReviews = reviews.filter((r) => {
    if (filter === 'positive') return r.rating >= 4;
    if (filter === 'negative') return r.rating <= 3;
    return true;
  });

  const employeeStats = useMemo(() => {
    const map: Record<string, { name: string; total: number; sum: number; negative: number }> = {};
    reviews.forEach((r: ReviewResponse) => {
      if (!r.employeeId || !r.employeeName) return;
      if (!map[r.employeeId]) map[r.employeeId] = { name: r.employeeName, total: 0, sum: 0, negative: 0 };
      map[r.employeeId].total++;
      map[r.employeeId].sum += r.rating;
      if (r.rating <= 3) map[r.employeeId].negative++;
    });
    return Object.entries(map)
      .map(([id, s]) => ({ id, name: s.name, count: s.total, avg: s.sum / s.total, negative: s.negative }))
      .sort((a, b) => b.avg - a.avg);
  }, [reviews]);

  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarGroup>
          <IconButton label="Предыдущий месяц" icon={ChevronLeft} variant="secondary" onClick={() => shiftMonth(-1)} />
          <span className="min-w-[10rem] text-center text-sm font-semibold text-ink" aria-live="polite">
            {monthLabel}
          </span>
          <IconButton label="Следующий месяц" icon={ChevronRight} variant="secondary" onClick={() => shiftMonth(1)} />
        </ToolbarGroup>
        {total > 0 && (
          <SegmentedControl
            aria-label="Фильтр отзывов"
            value={filter}
            onChange={(v) => update({ rating: v })}
            options={[
              { value: 'all', label: `Все · ${total}` },
              { value: 'positive', label: `Положительные · ${positiveCount}`, icon: ThumbsUp },
              { value: 'negative', label: `Отрицательные · ${negativeCount}`, icon: ThumbsDown },
            ]}
          />
        )}
      </Toolbar>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard compact label="Отзывов за месяц" value={total} icon={MessageSquare} loading={isLoading} />
        <StatCard
          compact
          label="Средняя оценка"
          value={total > 0 ? `${avgRating.toFixed(1).replace('.', ',')} ★` : '—'}
          icon={Star}
          tone={total > 0 ? ratingTone(avgRating) : 'neutral'}
          loading={isLoading}
        />
        <StatCard
          compact
          label="Положительных"
          value={total > 0 ? `${Math.round((positiveCount / total) * 100)}%` : '—'}
          icon={ThumbsUp}
          tone={total > 0 ? (positiveCount / total >= 0.8 ? 'ok' : 'warn') : 'neutral'}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        {/* ── Лента отзывов ── */}
        <div className="lg:col-span-2">
          <SectionCard
            icon={Star}
            iconTone="accent"
            title="Все отзывы"
            subtitle={`За ${monthLabel}`}
            bodyPadding="none"
          >
            {isLoading ? (
              <LoadingBlock className="px-4" lines={4} />
            ) : isError ? (
              <div className="p-4">
                <SectionError message="Не удалось загрузить отзывы" onRetry={() => refetch()} loading={isFetching} />
              </div>
            ) : total === 0 ? (
              <EmptyState
                icon={Star}
                title="Отзывов за этот месяц нет"
                hint="Выберите другой месяц или дождитесь оценок"
              />
            ) : filteredReviews.length === 0 ? (
              <EmptyState icon={Star} title="Нет отзывов под выбранным фильтром" />
            ) : (
              <ul className="divide-y divide-line">
                {filteredReviews.map((r) => {
                  const isGood = r.rating >= 4;
                  const isExpanded = expandedId === r.id;
                  const tone = isGood ? 'ok' : 'bad';
                  return (
                    <li key={r.id} className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums',
                            toneChip[tone],
                          )}
                          aria-label={`Оценка ${r.rating} из 5`}
                        >
                          {r.rating}
                        </span>
                        <div className="min-w-0 flex-1">
                          {r.clientId ? (
                            <Link
                              to={`/clients/${r.clientId}`}
                              className={cn(
                                'block truncate text-sm font-medium text-ink hover:text-accent-text',
                                focusRing,
                              )}
                            >
                              {r.clientName || 'Клиент'}
                            </Link>
                          ) : (
                            <p className="truncate text-sm font-medium text-ink">{r.clientName || 'Клиент'}</p>
                          )}
                          <p className="truncate text-xs text-ink-3">
                            {r.employeeName && `${r.employeeName} · `}
                            {r.carMakeModel && `${r.carMakeModel} · `}
                            {fmtDay(r.createdAt)}
                          </p>
                        </div>
                        {r.comment && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : r.id)}
                            aria-expanded={isExpanded}
                            className={cn(
                              'inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-surface-3 hover:text-ink',
                              focusRing,
                            )}
                          >
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Комментарий</span>
                            <ChevronDown
                              className={cn(
                                'h-3.5 w-3.5 transition-transform duration-150',
                                isExpanded && 'rotate-180',
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        )}
                      </div>
                      {isExpanded && r.comment && (
                        <p className={cn('ml-11 mt-2 rounded-lg px-3 py-2 text-sm', toneSoft[tone])}>{r.comment}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* ── Правая колонка ── */}
        <div className="space-y-5">
          <AlertsCard />

          {employeeStats.length > 0 && (
            <SectionCard icon={Trophy} iconTone="accent" title="Рейтинг мастеров" dense bodyPadding="none">
              <ul className="divide-y divide-line">
                {employeeStats.map((e, idx) => {
                  const avgRounded = Math.round(e.avg * 10) / 10;
                  const tone = ratingTone(avgRounded);
                  const isSelected = selectedMasterId === e.id;
                  const masterReviews = reviews.filter((r) => r.employeeId === e.id);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedMasterId(isSelected ? null : e.id)}
                        aria-expanded={isSelected}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2',
                          isSelected && 'bg-accent-soft/60',
                          focusRing,
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums',
                            idx < 3 ? toneChip.accent : toneChip.neutral,
                          )}
                          aria-label={`${idx + 1} место`}
                        >
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{e.name}</span>
                          <span className="mt-0.5 flex items-center gap-2">
                            <Stars rating={Math.round(e.avg)} label={`Средняя оценка ${avgRounded}`} />
                            <span className={cn('text-xs font-semibold tabular-nums', toneText[tone])}>
                              {avgRounded.toFixed(1).replace('.', ',')}
                            </span>
                          </span>
                        </span>
                        <span className="flex-shrink-0 text-right">
                          <span className="block text-sm font-semibold tabular-nums text-ink">{e.count}</span>
                          <span className="block text-2xs text-ink-3">
                            {plural(e.count, ['отзыв', 'отзыва', 'отзывов'])}
                          </span>
                        </span>
                        {e.negative > 0 && (
                          <AlertTriangle
                            className="h-4 w-4 flex-shrink-0 text-bad"
                            aria-label="Есть негативные отзывы"
                          />
                        )}
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 flex-shrink-0 text-ink-4 transition-transform duration-150',
                            isSelected && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </button>

                      {isSelected && (
                        <div className="space-y-2 border-t border-line bg-surface-2/60 px-4 py-3">
                          <div className="flex items-center gap-4 text-xs text-ink-3">
                            <span className="flex items-center gap-1">
                              <ThumbsUp className="h-3 w-3 text-ok" aria-hidden="true" />
                              {masterReviews.filter((r) => r.rating >= 4).length} положит.
                            </span>
                            <span className="flex items-center gap-1">
                              <ThumbsDown className="h-3 w-3 text-bad" aria-hidden="true" />
                              {e.negative} негатив.
                            </span>
                          </div>
                          {masterReviews.map((r) => {
                            const good = r.rating >= 4;
                            return (
                              <div key={r.id} className="rounded-lg border border-line bg-surface p-2.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-2xs font-semibold tabular-nums',
                                      toneChip[good ? 'ok' : 'bad'],
                                    )}
                                    aria-label={`Оценка ${r.rating} из 5`}
                                  >
                                    {r.rating}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    {r.clientId ? (
                                      <Link
                                        to={`/clients/${r.clientId}`}
                                        className={cn(
                                          'block truncate text-sm font-medium text-accent-text hover:underline',
                                          focusRing,
                                        )}
                                      >
                                        {r.clientName || 'Клиент'}
                                      </Link>
                                    ) : (
                                      <p className="truncate text-sm font-medium text-ink">
                                        {r.clientName || 'Клиент'}
                                      </p>
                                    )}
                                  </div>
                                  <span className="flex-shrink-0 text-2xs tabular-nums text-ink-3">
                                    {fmtDay(r.createdAt)}
                                  </span>
                                </div>
                                {(r.carMakeModel || r.carPlate) && (
                                  <p className="ml-8 mt-1 text-xs text-ink-3">
                                    {r.carMakeModel}
                                    {r.carPlate && ` · ${r.carPlate}`}
                                  </p>
                                )}
                                {r.comment && <p className="ml-8 mt-1 text-xs text-ink-2">{r.comment}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          )}

          <MotivationCard onGoToSettings={onGoToSettings} />
        </div>
      </div>
    </div>
  );
}

export default function ReputationView({
  isMaster,
  onGoToSettings,
}: {
  isMaster: boolean;
  onGoToSettings: () => void;
}) {
  if (isMaster) return <MasterLeaderboard />;
  return <OwnerReputation onGoToSettings={onGoToSettings} />;
}
