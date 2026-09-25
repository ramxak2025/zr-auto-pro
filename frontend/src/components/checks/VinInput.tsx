import { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { vinApi } from '../../api/services';
import type { VinDecodeResult } from '../../types';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { VIN_LENGTH, formatVin, isValidVin, normalizeVin } from '../../../../shared/utils/vin';
import { shouldAutofillMakeModel, vinCheckDigitWarning, vinCounter, vinDecodeCaption, vinSuggestion } from './vinUi';

/** Расшифровка неизменна — один VIN не расшифровываем дважды за сессию. */
const decodeCache = new Map<string, VinDecodeResult>();

export interface VinInputProps {
  /** Канонический VIN (normalizeVin), ≤ 17 символов. */
  value: string;
  onChange: (vin: string) => void;
  /** Текущее «Марка и модель» — решает: подставить молча или предложить чип «Заменить». */
  makeModel?: string;
  /** Подставить марку/модель из расшифровки (молча в пустое поле или по чипу «Заменить»). */
  onMakeModel?: (makeModel: string) => void;
  /** Полный результат расшифровки — если форме нужно больше (год, кузов). */
  onDecoded?: (result: VinDecodeResult) => void;
  /** Расшифровывать через vinApi.decode при 17 валидных символах. По умолчанию true. */
  decode?: boolean;
  /** Ошибка под полем — 409 VIN_DUPLICATE с именем клиента и т. п. */
  error?: string | null;
  label?: string;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Поле VIN-кода автомобиля (171). Рендерится ТОЛЬКО при включённой опции
 * тенанта — родитель не монтирует его, когда `useVinEnabled()` = false.
 *
 *   • нормализует ввод на лету: верхний регистр, кириллические двойники →
 *     латиница, I/O/Q → 1/0/0, мусор отбрасывается (`normalizeVin`), ≤ 17;
 *     наверх уходит канонический VIN — то, что хранит сервер;
 *   • показывает моноширинно с группировкой WMI VDS VIS (`formatVin`);
 *   • счётчик «12/17», галочка при 17 валидных символах, мягкое предупреждение
 *     о контрольной цифре для североамериканских VIN;
 *   • при 17 валидных символах (debounce 400 мс) — `vinApi.decode`: «Марка и
 *     модель» пусто → подставляет `makeModel` молча; заполнено — чип
 *     «По VIN: Kia Rio · Заменить». Подпись-источник под полем.
 *
 * Зеркало mobile/src/components/VinInput.tsx — поведение держим одинаковым.
 */
export default function VinInput({
  value,
  onChange,
  makeModel,
  onMakeModel,
  onDecoded,
  decode = true,
  error,
  label = 'VIN',
  id,
  autoFocus,
  disabled,
  placeholder = 'XTA 219010 K0123456',
  className,
}: VinInputProps) {
  const autoId = useId();
  const inputId = id ?? `vin-${autoId}`;

  // Колбэки и текущую марку держим в ref'ах: эффект расшифровки зависит только
  // от VIN, а не от каждой перерисовки родителя.
  const makeModelRef = useRef(makeModel);
  makeModelRef.current = makeModel;
  const onMakeModelRef = useRef(onMakeModel);
  onMakeModelRef.current = onMakeModel;
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<VinDecodeResult | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  // VIN, к которому относится `decoded` — чтобы не расшифровывать повторно и
  // не показывать подпись от предыдущего номера.
  const decodedVinRef = useRef<string | null>(null);

  useEffect(() => {
    if (!decode) return;
    if (!isValidVin(value)) {
      if (decodedVinRef.current !== null) {
        decodedVinRef.current = null;
        setDecoded(null);
      }
      setDecodeFailed(false);
      setDecoding(false);
      return;
    }
    if (decodedVinRef.current === value) return;
    if (decodedVinRef.current !== null) {
      decodedVinRef.current = null;
      setDecoded(null);
    }

    let cancelled = false;
    const apply = (res: VinDecodeResult) => {
      decodedVinRef.current = value;
      setDecoded(res);
      setDecodeFailed(false);
      onDecodedRef.current?.(res);
      if (shouldAutofillMakeModel(makeModelRef.current, res) && res.makeModel) {
        onMakeModelRef.current?.(res.makeModel);
      }
    };

    const cached = decodeCache.get(value);
    if (cached) {
      apply(cached);
      return;
    }

    setDecodeFailed(false);
    const timer = window.setTimeout(async () => {
      setDecoding(true);
      try {
        const res = (await vinApi.decode(value)).data;
        if (cancelled) return;
        decodeCache.set(value, res);
        apply(res);
      } catch {
        if (!cancelled) setDecodeFailed(true);
      } finally {
        if (!cancelled) setDecoding(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, decode, retryTick]);

  const complete = isValidVin(value);
  const caption = decoded && decodedVinRef.current === value ? vinDecodeCaption(decoded) : null;
  const suggestion = decoded && decodedVinRef.current === value ? vinSuggestion(makeModel, decoded) : null;
  const checkWarning = vinCheckDigitWarning(value);

  let hint: string | null = null;
  if (decoding) hint = 'Определяем марку по VIN…';
  else if (decodeFailed) hint = 'Не удалось расшифровать VIN — марку можно ввести вручную';
  else if (checkWarning) hint = checkWarning;
  else if (caption) hint = caption;
  else if (value.length > 0 && !complete)
    hint = `Ещё ${VIN_LENGTH - value.length} симв. — латиница и цифры, без I, O, Q`;

  return (
    <Field
      label={label}
      htmlFor={inputId}
      error={error ?? undefined}
      hint={
        hint || suggestion || decodeFailed ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {hint && (
              <span className={cn(checkWarning && !decoding && !caption ? 'text-warn-text' : undefined)}>{hint}</span>
            )}
            {decodeFailed && !decoding && (
              <Button
                variant="ghost"
                size="sm"
                icon={RefreshCw}
                className="-my-1 h-6 px-1.5"
                onClick={() => setRetryTick((t) => t + 1)}
              >
                Повторить
              </Button>
            )}
            {suggestion && onMakeModel && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-0.5 text-accent-text">
                По VIN: <span className="font-medium">{suggestion}</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  className="font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm"
                  onClick={() => onMakeModel(suggestion)}
                >
                  Заменить
                </button>
              </span>
            )}
          </span>
        ) : undefined
      }
      className={className}
    >
      <Input
        id={inputId}
        value={formatVin(value)}
        onChange={(e) => onChange(normalizeVin(e.target.value).slice(0, VIN_LENGTH))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        invalid={!!error}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={VIN_LENGTH + 2}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className="font-mono uppercase tracking-wider"
        rightSlot={
          <span className="flex items-center gap-1.5 text-2xs font-medium tabular-nums text-ink-3" aria-live="polite">
            {decoding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-label="Расшифровка" />
            ) : complete ? (
              <Check className="h-3.5 w-3.5 text-ok" aria-label="17 символов" />
            ) : null}
            {vinCounter(value)}
          </span>
        }
      />
    </Field>
  );
}
