import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { storageCellsApi } from '../../api/services';
import { storageCellErrorMessage, useStorageCells } from '../../hooks/useStorageCells';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Select, type SelectOption } from '../../ui/Select';
import { normalizeCellCode } from '../../../../shared/utils/storageCells';

/** Ячеек больше — над списком появляется поле поиска по коду (нативный select на сотнях пунктов не листается). */
const FILTER_FROM = 12;

interface CurrentCell {
  id: string;
  code: string;
  name?: string | null;
}

interface StorageCellSelectProps {
  /** Склад товара: ячейки берём только его. */
  warehouseId: string | null | undefined;
  /** id выбранной ячейки; '' — без ячейки. */
  value: string;
  onChange: (cellId: string) => void;
  /** Можно ли заводить ячейки здесь же («+ Создать ячейку») — право управления складом. */
  canCreate?: boolean;
  /** Текущая ячейка товара: остаётся в списке, пока склад ещё не ответил или её убрали из кеша. */
  currentCell?: CurrentCell | null;
  id?: string;
  label?: string;
  emptyLabel?: string;
  /** Ячейка, которую нельзя выбрать (перенос товаров из удаляемой ячейки). */
  excludeId?: string;
}

const optionLabel = (code: string, name?: string | null) => (name ? `${code} · ${name}` : code);

/**
 * Поле «Ячейка» для товара. Пока на складе нет ячеек, показывает только кнопку
 * «+ Создать ячейку» (менеджеру) — остальная форма выглядит как раньше.
 */
export default function StorageCellSelect({
  warehouseId,
  value,
  onChange,
  canCreate = false,
  currentCell = null,
  id,
  label = 'Ячейка',
  emptyLabel = 'Без ячейки',
  excludeId,
}: StorageCellSelectProps) {
  const { cells: allCells, isLoading, upsert, invalidateCells } = useStorageCells(warehouseId);
  const cells = useMemo(
    () => (excludeId ? allCells.filter((c) => c.id !== excludeId) : allCells),
    [allCells, excludeId],
  );
  const hasCells = cells.length > 0;
  const autoId = useId();
  const selectId = id ?? `${autoId}-storage-cell`;

  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Склад сменился — ячейка старого склада тут недействительна (сервер всё равно ответил бы 400).
  const prevWarehouseRef = useRef(warehouseId);
  useEffect(() => {
    if (prevWarehouseRef.current === warehouseId) return;
    prevWarehouseRef.current = warehouseId;
    setFilter('');
    setCreating(false);
    if (value) onChange('');
  }, [warehouseId, value, onChange]);

  useEffect(() => {
    if (creating) codeInputRef.current?.focus();
  }, [creating]);

  const options = useMemo<SelectOption[]>(() => {
    const q = normalizeCellCode(filter);
    const list = cells.filter(
      (c) => !q || c.id === value || normalizeCellCode(c.code).includes(q) || (c.name ?? '').toUpperCase().includes(q),
    );
    const out = list.map((c) => ({ value: c.id, label: optionLabel(c.code, c.name) }));
    // Выбранная ячейка не пришла в списке склада (грузится или удалена) — показываем её, а не молча «Без ячейки».
    if (value && !cells.some((c) => c.id === value)) {
      out.unshift({
        value,
        label: currentCell?.id === value ? optionLabel(currentCell.code, currentCell.name) : 'Ячейка не найдена',
      });
    }
    return out;
  }, [cells, filter, value, currentCell]);

  const cancelCreate = useCallback(() => {
    setCreating(false);
    setNewCode('');
    setError(null);
  }, []);

  const create = useCallback(async () => {
    if (!warehouseId || busy) return;
    const code = normalizeCellCode(newCode);
    if (!code) {
      setError('Введите код ячейки, например A-01-03');
      return;
    }
    if (cells.some((c) => normalizeCellCode(c.code) === code)) {
      setError('Ячейка с таким кодом уже есть на этом складе');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: created } = await storageCellsApi.create({ warehouseId, code });
      upsert(created);
      invalidateCells();
      onChange(created.id);
      setCreating(false);
      setNewCode('');
      toast.success(`Ячейка ${created.code} создана`);
    } catch (err) {
      setError(storageCellErrorMessage(err, 'Не удалось создать ячейку'));
    } finally {
      setBusy(false);
    }
  }, [warehouseId, busy, newCode, cells, upsert, invalidateCells, onChange]);

  // Enter внутри формы товара сохранил бы саму форму, Esc закрыл бы всё окно — гасим оба.
  const handleCodeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void create();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelCreate();
    }
  };

  const handleFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  if (!warehouseId) return null;
  const showSelect = hasCells || !!value;
  // Пока склад отвечает, кнопку «Создать» не показываем: у склада с ячейками она мигнула бы и сдвинула форму.
  if (!showSelect && !canCreate) return null;
  if (!showSelect && isLoading) return null;

  const createControls = canCreate ? (
    creating ? (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input
            ref={codeInputRef}
            size="sm"
            value={newCode}
            onChange={(e) => {
              setNewCode(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleCodeKeyDown}
            placeholder="Например, A-01-03"
            aria-label="Код новой ячейки"
            aria-describedby={error ? `${selectId}-create-error` : undefined}
            invalid={!!error}
            maxLength={64}
            autoComplete="off"
            disabled={busy}
            className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
          />
        </div>
        <Button size="sm" loading={busy} disabled={!newCode.trim()} onClick={() => void create()}>
          Создать
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={cancelCreate}>
          Отмена
        </Button>
      </div>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        onClick={() => {
          setCreating(true);
          setError(null);
        }}
        className="-ml-1"
      >
        Создать ячейку
      </Button>
    )
  ) : null;

  const errorText = error ? (
    <p id={`${selectId}-create-error`} role="alert" className="text-xs text-bad-text">
      {error}
    </p>
  ) : null;

  if (!showSelect) {
    return (
      <div className="space-y-1.5">
        {createControls}
        {errorText}
      </div>
    );
  }

  return (
    <Field label={label} htmlFor={selectId}>
      <div className="space-y-2">
        {cells.length > FILTER_FROM && (
          <Input
            size="sm"
            leftIcon={Search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            placeholder="Найти ячейку по коду…"
            aria-label="Найти ячейку по коду"
            autoComplete="off"
          />
        )}
        <Select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={emptyLabel}
          options={options}
        />
        {createControls}
        {errorText}
      </div>
    </Field>
  );
}
