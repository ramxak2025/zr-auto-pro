import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { storageCellsApi } from '../../api/services';
import { storageCellErrorMessage, useStorageCells } from '../../hooks/useStorageCells';
import Switch from '../Switch';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { cn } from '../../ui/cn';
import {
  MAX_BULK_CELLS,
  countCellCodes,
  expandRacks,
  generateCellCodes,
  normalizeCellCode,
  type CellGridParams,
} from '../../../../shared/utils/storageCells';
import { countLabel } from './format';

const SEPARATORS = [
  { key: 'dash', label: 'Дефис — A-1-2', value: '-' },
  { key: 'dot', label: 'Точка — A.1.2', value: '.' },
  { key: 'slash', label: 'Косая черта — A/1/2', value: '/' },
  { key: 'none', label: 'Без разделителя — A12', value: '' },
] as const;

/** Сколько кодов показываем в предпросмотре целиком; больше — начало, «…» и хвост. */
const PREVIEW_ALL = 14;
const PREVIEW_HEAD = 10;
const PREVIEW_TAIL = 3;

const CELLS_FORMS: [string, string, string] = ['ячейка', 'ячейки', 'ячеек'];
const CELLS_FORMS_ACC: [string, string, string] = ['ячейку', 'ячейки', 'ячеек'];

/** Только цифры и не длиннее 5 знаков: всё, что больше лимита в 2000, всё равно упрётся в предупреждение. */
const digitsOnly = (raw: string) => raw.replace(/\D/g, '').slice(0, 5);
const toCount = (text: string): number | undefined => (text ? Number(text) : undefined);
const formatTotal = (n: number) => (n > 1_000_000 ? 'более 1 000 000' : n.toLocaleString('ru-RU'));

interface CellGridCreatorProps {
  warehouseId: string;
  onCancel: () => void;
  onDone: () => void;
}

/** Создание ячеек сеткой «стеллажи × полки × ячейки» с предпросмотром кодов до сохранения. */
export default function CellGridCreator({ warehouseId, onCancel, onDone }: CellGridCreatorProps) {
  const uid = useId();
  const { cells, invalidateCells } = useStorageCells(warehouseId);

  const [racksText, setRacksText] = useState('');
  const [shelvesText, setShelvesText] = useState('');
  const [cellsText, setCellsText] = useState('');
  const [separatorKey, setSeparatorKey] = useState<(typeof SEPARATORS)[number]['key']>('dash');
  const [zeroPad, setZeroPad] = useState(false);
  const [busy, setBusy] = useState(false);
  const racksRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    racksRef.current?.focus();
  }, []);

  const racks = useMemo(() => expandRacks(racksText), [racksText]);
  const racksInvalid = racksText.trim() !== '' && racks.length === 0;
  const shelves = toCount(shelvesText);
  const cellsPerShelf = toCount(cellsText);
  const separator = SEPARATORS.find((s) => s.key === separatorKey)?.value ?? '-';

  const params = useMemo<CellGridParams>(
    () => ({
      racks,
      shelves,
      cells: cellsPerShelf,
      separator,
      pad: zeroPad ? Math.max(2, String(Math.max(shelves ?? 0, cellsPerShelf ?? 0)).length) : undefined,
    }),
    [racks, shelves, cellsPerShelf, separator, zeroPad],
  );

  const total = useMemo(() => countCellCodes(params), [params]);
  const tooMany = total > MAX_BULK_CELLS;

  const codes = useMemo(() => {
    if (total === 0 || tooMany) return [];
    try {
      return generateCellCodes(params);
    } catch {
      return [];
    }
  }, [params, total, tooMany]);

  const existing = useMemo(() => new Set(cells.map((c) => normalizeCellCode(c.code))), [cells]);
  const newCount = useMemo(() => codes.filter((c) => !existing.has(c)).length, [codes, existing]);
  const skippedCount = codes.length - newCount;

  const preview = useMemo(() => {
    if (codes.length <= PREVIEW_ALL) return codes.map((code) => ({ code, gap: 0 }));
    const tail = codes.slice(-PREVIEW_TAIL).map((code) => ({ code, gap: 0 }));
    const head = codes.slice(0, PREVIEW_HEAD).map((code) => ({ code, gap: 0 }));
    return [...head, { code: '', gap: codes.length - PREVIEW_HEAD - PREVIEW_TAIL }, ...tail];
  }, [codes]);

  const canSubmit = !busy && !racksInvalid && !tooMany && newCount > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      // На сервер уходит весь список: существующие он пропустит сам и вернёт их в skipped.
      const { data } = await storageCellsApi.bulkCreate({ warehouseId, codes });
      const skipped = data.skipped.length;
      toast.success(
        skipped > 0 ? `Создано ${data.created}, пропущено ${skipped} (уже есть)` : `Создано ${data.created}`,
      );
      invalidateCells();
      onDone();
    } catch (err) {
      toast.error(storageCellErrorMessage(err, 'Не удалось создать ячейки'));
    } finally {
      setBusy(false);
    }
  };

  let summary: string;
  let summaryTone: 'muted' | 'ok' | 'bad' = 'muted';
  if (tooMany) {
    summary = `Слишком много ячеек: ${formatTotal(total)}. За один раз можно создать не больше ${MAX_BULK_CELLS}.`;
    summaryTone = 'bad';
  } else if (racksInvalid) {
    summary = 'Проверьте поле «Стеллажи» — предпросмотр появится, когда оно будет заполнено верно.';
  } else if (codes.length === 0) {
    summary = 'Заполните стеллажи, полки или ячейки — здесь появятся коды.';
  } else if (newCount === 0) {
    summary = `Все ${countLabel(codes.length, CELLS_FORMS)} уже есть на складе — создавать нечего.`;
  } else {
    summary = `Будет создано: ${countLabel(newCount, CELLS_FORMS)}`;
    if (skippedCount > 0) summary += `. Ещё ${skippedCount} уже есть на складе и будут пропущены`;
    summaryTone = 'ok';
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field
        label="Стеллажи"
        htmlFor={`${uid}-racks`}
        hint="Диапазон A-C или список A, B, C; можно цифрами: 1-5. Пусто — без стеллажа в коде."
        error={racksInvalid ? 'Не удалось разобрать. Примеры: A-C, 1-5, A, B, C' : undefined}
      >
        <Input
          id={`${uid}-racks`}
          ref={racksRef}
          value={racksText}
          onChange={(e) => setRacksText(e.target.value)}
          placeholder="A-C"
          invalid={racksInvalid}
          aria-describedby={racksInvalid ? `${uid}-racks-error` : `${uid}-racks-hint`}
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Полок на стеллаже" htmlFor={`${uid}-shelves`}>
          <Input
            id={`${uid}-shelves`}
            inputMode="numeric"
            value={shelvesText}
            onChange={(e) => setShelvesText(digitsOnly(e.target.value))}
            placeholder="3"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>
        <Field label="Ячеек на полке" htmlFor={`${uid}-cells`}>
          <Input
            id={`${uid}-cells`}
            inputMode="numeric"
            value={cellsText}
            onChange={(e) => setCellsText(digitsOnly(e.target.value))}
            placeholder="4"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 items-end gap-3">
        <Field label="Разделитель" htmlFor={`${uid}-sep`}>
          <Select
            id={`${uid}-sep`}
            value={separatorKey}
            onChange={(e) => setSeparatorKey(e.target.value as (typeof SEPARATORS)[number]['key'])}
            options={SEPARATORS.map((s) => ({ value: s.key, label: s.label }))}
          />
        </Field>
        <div className="flex h-9 items-center gap-3">
          <Switch id={`${uid}-pad`} checked={zeroPad} onChange={setZeroPad} label="Нули впереди (01, 02…)" />
          <label htmlFor={`${uid}-pad`} className="cursor-pointer text-sm font-medium text-ink-2">
            Нули впереди (01, 02…)
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <p
          aria-live="polite"
          className={cn(
            'text-sm',
            summaryTone === 'bad' && 'font-medium text-bad-text',
            summaryTone === 'ok' && 'font-medium text-ink',
            summaryTone === 'muted' && 'text-ink-3',
          )}
        >
          {summary}
        </p>
        {codes.length > 0 && (
          <ul aria-label="Предпросмотр кодов" className="mt-2.5 flex flex-wrap gap-1.5">
            {preview.map((item, i) =>
              item.gap > 0 ? (
                <li key={`gap-${i}`} className="self-center text-xs text-ink-3">
                  … ещё {item.gap}
                </li>
              ) : (
                <li key={`${i}-${item.code}`}>
                  <Badge
                    outline
                    size="sm"
                    title={existing.has(item.code) ? 'Уже есть на складе — будет пропущена' : undefined}
                    className={cn('font-mono tabular-nums', existing.has(item.code) && 'line-through opacity-50')}
                  >
                    {item.code}
                  </Badge>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Назад
        </Button>
        <Button type="submit" loading={busy} disabled={!canSubmit}>
          {newCount > 0 ? `Создать ${countLabel(newCount, CELLS_FORMS_ACC)}` : 'Создать ячейки'}
        </Button>
      </div>
    </form>
  );
}
