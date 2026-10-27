import { useEffect, useId, useState } from 'react';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';

type Values = { from: string; to: string; masterId: string };
export default function JournalFilters({
  open,
  onClose,
  applied,
  options,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  applied: Values;
  options: { value: string; label: string }[];
  onApply: (values: Values) => void;
}) {
  const id = useId();
  const { from, to, masterId } = applied;
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState('');
  const { today, weekStart, monthStart } = useTenantCalendar();
  useEffect(() => {
    if (open) {
      setDraft({ from, to, masterId });
      setError('');
    }
  }, [open, from, to, masterId]); // Values are URL-owned.
  const patch = (value: Partial<Values>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError('');
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Фильтры журнала"
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ from: '', to: '', masterId: '' });
              setError('');
            }}
          >
            Сбросить
          </Button>
          <Button
            onClick={() => {
              if (draft.from && draft.to && draft.from > draft.to) {
                setError('Дата начала должна быть раньше даты окончания');
                return;
              }
              onApply(draft);
              onClose();
            }}
          >
            Применить
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold text-ink">Период</legend>
          <div className="flex flex-wrap gap-1.5">
            {[
              [today, 'Сегодня'],
              [weekStart, 'Неделя'],
              [monthStart, 'Месяц'],
            ].map(([from, label]) => {
              const selected = draft.from === from && draft.to === today;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ from, to: today })}
                  className={cn(
                    'min-h-11 rounded-lg px-3 text-sm font-medium',
                    focusRing,
                    selected ? 'bg-accent-soft text-accent-text' : 'bg-surface-3 text-ink-2',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor={`${id}-from`} className="space-y-1.5 text-xs font-medium text-ink-3">
              С
              <Input
                id={`${id}-from`}
                type="date"
                aria-label="Дата начала"
                value={draft.from}
                onChange={(event) => patch({ from: event.target.value })}
                className="h-11 min-w-0"
              />
            </label>
            <label htmlFor={`${id}-to`} className="space-y-1.5 text-xs font-medium text-ink-3">
              По
              <Input
                id={`${id}-to`}
                type="date"
                aria-label="Дата окончания"
                value={draft.to}
                onChange={(event) => patch({ to: event.target.value })}
                className="h-11 min-w-0"
              />
            </label>
          </div>
          <p className="text-xs text-ink-3">Оба дня включены. Часовой пояс автосервиса.</p>
          {error && (
            <p role="alert" className="text-sm text-bad-text">
              {error}
            </p>
          )}
        </fieldset>
        <label htmlFor={`${id}-master`} className="block space-y-2 text-sm font-semibold text-ink">
          Мастер
          <Select
            id={`${id}-master`}
            aria-label="Мастер"
            placeholder="Все мастера"
            options={options}
            value={draft.masterId}
            onChange={(event) => patch({ masterId: event.target.value })}
            className="h-11 font-normal"
          />
        </label>
      </div>
    </Drawer>
  );
}
