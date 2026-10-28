import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, CalendarRange, Check, ChevronRight, UserRound, UsersRound, X } from 'lucide-react';
import gsap from 'gsap';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import JournalPopover from './JournalPopover';
import { journalPeriodLabel } from './journalFormatting';
import { useJournalSelection } from './useJournalSelection';

type Values = { from: string; to: string; masterId: string };
type FilterPage = 'overview' | 'period' | 'master';

function PeriodPresets({ draft, onChange }: { draft: Values; onChange: (value: Partial<Values>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { today, weekStart, monthStart } = useTenantCalendar();
  const presets = [
    { value: 'today', from: today, label: 'Сегодня' },
    { value: 'week', from: weekStart, label: 'Неделя' },
    { value: 'month', from: monthStart, label: 'Месяц' },
  ];
  // On the first day of a week/month, one selected plate still represents the range.
  const active = presets.find((preset) => draft.from === preset.from && draft.to === today)?.value ?? '';
  useJournalSelection(ref, active);
  return (
    <div ref={ref} className="journal-presets" role="group" aria-label="Быстрый выбор периода">
      <span data-selection-backplate className="journal-selection-backplate" aria-hidden="true" />
      {presets.map((preset) => (
        <button
          key={preset.value}
          type="button"
          aria-pressed={active === preset.value}
          data-selection-active={active === preset.value}
          className={focusRing}
          onClick={() => onChange({ from: preset.from, to: today })}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

function MasterOptions({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useJournalSelection(ref, value);
  return (
    <div ref={ref} className="journal-master-options" role="group" aria-label="Выбор мастера">
      <span data-selection-backplate className="journal-selection-backplate" aria-hidden="true" />
      {[{ value: '', label: 'Все мастера' }, ...options.filter((option) => option.value)].map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-selection-active={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('journal-master-option', focusRing)}
        >
          <span className="journal-master-avatar" aria-hidden="true">
            {option.value ? (
              option.label
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
            ) : (
              <UsersRound size={18} />
            )}
          </span>
          <span className="journal-master-name">{option.label}</span>
          <span className="journal-choice-check" aria-hidden="true">
            {value === option.value && <Check size={14} />}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function JournalFilters({
  open,
  onClose,
  anchor,
  applied,
  options,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLButtonElement>;
  applied: Values;
  options: { value: string; label: string }[];
  onApply: (values: Values) => void;
}) {
  const id = useId();
  const { from, to, masterId } = applied;
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState('');
  const [page, setPage] = useState<FilterPage>('overview');
  const stage = useRef<HTMLDivElement>(null);
  const previousPage = useRef<FilterPage>(page);
  useEffect(() => {
    if (open) {
      setDraft({ from, to, masterId });
      setError('');
      previousPage.current = 'overview';
      setPage('overview');
    }
  }, [open, from, to, masterId]);
  useLayoutEffect(() => {
    if (!open || previousPage.current === page || !stage.current) return;
    const old = stage.current.querySelector<HTMLElement>(`[data-filter-page="${previousPage.current}"]`);
    const next = stage.current.querySelector<HTMLElement>(`[data-filter-page="${page}"]`);
    previousPage.current = page;
    if (!old || !next) return;
    const direction = page === 'overview' ? -1 : 1;
    const media = gsap.matchMedia();
    media.add(
      { reduced: '(prefers-reduced-motion: reduce)', regular: '(prefers-reduced-motion: no-preference)' },
      (context) => {
        const duration = context.conditions?.reduced ? 0 : 0.23;
        const distance = context.conditions?.reduced ? 0 : 28 * direction;
        gsap
          .timeline()
          .fromTo(
            stage.current,
            { height: old.offsetHeight },
            { height: next.scrollHeight, duration, ease: 'power3.out' },
            0,
          )
          .fromTo(
            old,
            { visibility: 'visible', opacity: 1, x: 0 },
            { opacity: 0, x: -distance, duration: duration * 0.85, ease: 'power3.out' },
            0,
          )
          .fromTo(
            next,
            { visibility: 'visible', opacity: 0, x: distance },
            { opacity: 1, x: 0, duration, ease: 'power3.out' },
            0,
          )
          .set(old, { visibility: 'hidden' })
          .set(stage.current, { height: 'auto' });
      },
      stage,
    );
    next.querySelector<HTMLElement>('[data-page-focus], input, button')?.focus({ preventScroll: true });
    return () => media.revert();
  }, [page, open]);

  const patch = (value: Partial<Values>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError('');
  };
  const masterLabel =
    options.find((option) => option.value === draft.masterId)?.label ??
    (draft.masterId ? 'Мастер выбран' : 'Все мастера');
  const count = Number(Boolean(draft.from || draft.to)) + Number(Boolean(draft.masterId));
  const apply = () => {
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('Дата начала должна быть раньше даты окончания');
      setPage('period');
      return;
    }
    onApply(draft);
    onClose();
  };
  const pane = (name: FilterPage) => ({
    'data-filter-page': name,
    'data-active': page === name,
    'aria-hidden': page !== name,
    ref: (node: HTMLDivElement | null) => {
      if (node) node.inert = page !== name;
    },
    className: 'journal-filter-pane',
  });
  return (
    <JournalPopover open={open} onClose={onClose} anchor={anchor} labelledBy={`${id}-title`}>
      <div className="journal-popover-heading">
        {page !== 'overview' && (
          <IconButton
            label="Назад к фильтрам"
            icon={ArrowLeft}
            onClick={() => setPage('overview')}
            className="journal-panel-action"
          />
        )}
        <h2 id={`${id}-title`}>{page === 'overview' ? 'Фильтры' : page === 'period' ? 'Период' : 'Мастер'}</h2>
        {page === 'overview' && count > 0 && <span className="journal-draft-count">{count}</span>}
        <IconButton
          label="Закрыть фильтры"
          icon={X}
          onClick={onClose}
          className="journal-panel-action journal-panel-close"
        />
      </div>
      <div className="journal-filter-body">
        <div ref={stage} className="journal-filter-stage">
          <div {...pane('overview')}>
            <div className="journal-filter-group">
              <button type="button" className={cn('journal-filter-row', focusRing)} onClick={() => setPage('period')}>
                <CalendarRange size={20} aria-hidden="true" />
                <span>
                  <strong>Период</strong>
                  <small>{journalPeriodLabel(draft.from, draft.to)}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <PeriodPresets draft={draft} onChange={patch} />
            </div>
            <div className="journal-filter-group">
              <button type="button" className={cn('journal-filter-row', focusRing)} onClick={() => setPage('master')}>
                <UserRound size={20} aria-hidden="true" />
                <span>
                  <strong>Мастер</strong>
                  <small>{masterLabel}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div {...pane('period')}>
            <PeriodPresets draft={draft} onChange={patch} />
            <div className="journal-date-range">
              <label htmlFor={`${id}-from`}>
                <span>С</span>
                <Input
                  data-page-focus
                  id={`${id}-from`}
                  type="date"
                  aria-label="Дата начала"
                  value={draft.from}
                  onChange={(event) => patch({ from: event.target.value })}
                  invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                />
              </label>
              <label htmlFor={`${id}-to`}>
                <span>По</span>
                <Input
                  id={`${id}-to`}
                  type="date"
                  aria-label="Дата окончания"
                  value={draft.to}
                  onChange={(event) => patch({ to: event.target.value })}
                  invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-error` : undefined}
                />
              </label>
            </div>
            <p className="journal-date-hint">Оба дня включены. Часовой пояс автосервиса.</p>
            {error && (
              <p id={`${id}-error`} role="alert" className="journal-filter-error">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => patch({ from: '', to: '' })}
              className={cn('journal-period-clear', focusRing)}
            >
              За всё время
            </button>
          </div>
          <div {...pane('master')}>
            <MasterOptions value={draft.masterId} options={options} onChange={(value) => patch({ masterId: value })} />
          </div>
        </div>
      </div>
      <div className="journal-filter-footer">
        <button
          type="button"
          className={cn('journal-reset', focusRing)}
          onClick={() => {
            setDraft({ from: '', to: '', masterId: '' });
            setError('');
          }}
        >
          Сбросить
        </button>
        <Button onClick={apply} className="journal-apply" iconRight={Check}>
          Применить
        </Button>
      </div>
    </JournalPopover>
  );
}
